import { useCallback, useEffect, useRef, useState } from "react";
import { get, onValue, ref, remove, set, type Unsubscribe } from "firebase/database";
import { isFirebaseConfigured } from "../config/firebaseConfig";
import type {
  CompletedTaskUndo,
  SyncState,
  Task,
  TaskPriority,
  UserName,
} from "../models/task";
import { createDemoTasks } from "../services/demoTasks";
import { ensureAnonymousAuthentication } from "../services/firebase";
import { getNextDueDate } from "../utils/taskDates";

const CACHE_KEY = "taskFollower.tasks.v1";
const PENDING_KEY = "taskFollower.pendingOperations.v1";

type PendingOperation =
  | { id: string; type: "upsert"; task: Task }
  | { id: string; type: "delete"; taskId: string }
  | { id: string; type: "replace"; tasks: Task[] };

type LegacyTask = Task & { urgency?: TaskPriority };

const normalizeTask = (task: Task): Task => {
  const legacyTask = task as LegacyTask;
  const { urgency: legacyUrgency, ...taskWithoutLegacyUrgency } = legacyTask;
  const dueDate =
    typeof task.dueDate === "string" && task.dueDate.trim()
      ? task.dueDate
      : undefined;

  return {
    ...taskWithoutLegacyUrgency,
    name: typeof task.name === "string" ? task.name : "",
    description: task.description || "",
    estimatedMinutes: Math.max(1, Number(task.estimatedMinutes) || 15),
    dueDate,
    dueTime: dueDate && task.dueTime ? task.dueTime : undefined,
    priority: task.priority || legacyUrgency || undefined,
    assignedBy: task.assignedBy || task.assignedTo || "Yorki",
    assignedTo: task.assignedTo || task.assignedBy || "Yorki",
    status: task.status || "pending",
    recurrence: task.recurrence || { type: "none", interval: 1 },
  };
};

const readCachedTasks = (): Task[] => {
  try {
    const stored = localStorage.getItem(CACHE_KEY);
    if (stored) return (JSON.parse(stored) as Task[]).map(normalizeTask);
  } catch {
    // Ignore corrupted local cache and fall back to demo data.
  }
  return createDemoTasks().map(normalizeTask);
};

const storeCachedTasks = (tasks: Task[]): void => {
  localStorage.setItem(CACHE_KEY, JSON.stringify(tasks));
};

const readPendingOperations = (): PendingOperation[] => {
  try {
    const operations = JSON.parse(
      localStorage.getItem(PENDING_KEY) || "[]",
    ) as PendingOperation[];
    return operations.map((operation) => {
      if (operation.type === "upsert") {
        return { ...operation, task: normalizeTask(operation.task) };
      }
      if (operation.type === "replace") {
        return { ...operation, tasks: operation.tasks.map(normalizeTask) };
      }
      return operation;
    });
  } catch {
    return [];
  }
};

const storePendingOperations = (operations: PendingOperation[]): void => {
  localStorage.setItem(PENDING_KEY, JSON.stringify(operations));
};

const stripUndefined = <T,>(value: T): T =>
  JSON.parse(JSON.stringify(value)) as T;

const tasksToRecord = (tasks: Task[]): Record<string, Task> =>
  Object.fromEntries(tasks.map((task) => [task.id, stripUndefined(task)]));

const recordToTasks = (value: unknown): Task[] => {
  if (!value || typeof value !== "object") return [];
  return Object.values(value as Record<string, Task>)
    .filter((task): task is Task => Boolean(task?.id))
    .map(normalizeTask);
};

const applyPendingOperations = (
  remoteTasks: Task[],
  operations: PendingOperation[],
): Task[] => {
  let map = new Map(remoteTasks.map((task) => [task.id, task]));

  for (const operation of operations) {
    if (operation.type === "replace") {
      map = new Map(operation.tasks.map((task) => [task.id, normalizeTask(task)]));
    } else if (operation.type === "upsert") {
      map.set(operation.task.id, normalizeTask(operation.task));
    } else {
      map.delete(operation.taskId);
    }
  }

  return [...map.values()];
};

export interface UseTasksResult {
  tasks: Task[];
  syncState: SyncState;
  syncMessage: string;
  pendingCount: number;
  saveTask: (task: Task) => Promise<void>;
  completeTask: (task: Task, completedBy: UserName) => Promise<CompletedTaskUndo>;
  undoComplete: (undo: CompletedTaskUndo) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  replaceTasks: (tasks: Task[]) => Promise<void>;
  mergeTasks: (tasks: Task[]) => Promise<void>;
  retrySync: () => Promise<void>;
}

export const useTasks = (): UseTasksResult => {
  const [tasks, setTasks] = useState<Task[]>(readCachedTasks);
  const [syncState, setSyncState] = useState<SyncState>(
    isFirebaseConfigured() ? "connecting" : "local",
  );
  const [syncMessage, setSyncMessage] = useState(
    isFirebaseConfigured()
      ? "Conectando con Firebase…"
      : "Vista local: agrega la configuración de Firebase para sincronizar los dispositivos.",
  );
  const [pendingCount, setPendingCount] = useState(readPendingOperations().length);
  const mountedRef = useRef(true);
  const firebaseConnectedRef = useRef(false);

  const updateLocalTasks = useCallback((nextTasks: Task[]) => {
    const normalized = nextTasks.map(normalizeTask);
    setTasks(normalized);
    storeCachedTasks(normalized);
  }, []);

  const queueOperation = useCallback((operation: PendingOperation) => {
    const next = [...readPendingOperations(), operation];
    storePendingOperations(next);
    setPendingCount(next.length);
  }, []);

  const removePendingOperation = useCallback((operationId: string) => {
    const next = readPendingOperations().filter(
      (operation) => operation.id !== operationId,
    );
    storePendingOperations(next);
    setPendingCount(next.length);
  }, []);

  const executeOperation = useCallback(
    async (operation: PendingOperation): Promise<boolean> => {
      if (
        !isFirebaseConfigured() ||
        !navigator.onLine ||
        !firebaseConnectedRef.current
      ) {
        return false;
      }

      try {
        setSyncState("saving");
        setSyncMessage("Guardando cambios…");
        const { database } = await ensureAnonymousAuthentication();

        if (operation.type === "upsert") {
          await set(
            ref(database, `tasks/${operation.task.id}`),
            stripUndefined(operation.task),
          );
        } else if (operation.type === "delete") {
          await remove(ref(database, `tasks/${operation.taskId}`));
        } else {
          await set(ref(database, "tasks"), tasksToRecord(operation.tasks));
        }

        removePendingOperation(operation.id);
        if (mountedRef.current) {
          setSyncState("synced");
          setSyncMessage("Todos los cambios están sincronizados.");
        }
        return true;
      } catch {
        if (mountedRef.current) {
          setSyncState(navigator.onLine ? "error" : "offline");
          setSyncMessage(
            "Los cambios se guardaron en este dispositivo, pero no pudieron sincronizarse.",
          );
        }
        return false;
      }
    },
    [removePendingOperation],
  );

  const retrySync = useCallback(async () => {
    const operations = readPendingOperations();

    if (!isFirebaseConfigured()) {
      setSyncState("local");
      setSyncMessage(
        "Vista local: agrega la configuración de Firebase para sincronizar los dispositivos.",
      );
      return;
    }

    if (!navigator.onLine || !firebaseConnectedRef.current) {
      setSyncState("offline");
      setSyncMessage(
        operations.length
          ? "Sin conexión: los cambios están guardados en este dispositivo y se sincronizarán después."
          : "Sin conexión: las tareas disponibles están guardadas en este dispositivo.",
      );
      return;
    }

    if (!operations.length) {
      setSyncState("synced");
      setSyncMessage("Todos los cambios están sincronizados.");
      return;
    }

    for (const operation of operations) {
      const succeeded = await executeOperation(operation);
      if (!succeeded) break;
    }
  }, [executeOperation]);

  const submitOperation = useCallback(
    (operation: PendingOperation) => {
      // Saving to the local cache and pending queue is the completion point for
      // the UI. Firebase synchronization runs in the background so an offline
      // write can never leave a form stuck on “Guardando…”.
      queueOperation(operation);

      if (!isFirebaseConfigured()) return;

      if (!navigator.onLine || !firebaseConnectedRef.current) {
        if (mountedRef.current) {
          setSyncState("offline");
          setSyncMessage(
            "Cambio guardado en este dispositivo. Se sincronizará cuando vuelva la conexión.",
          );
        }
        return;
      }

      void executeOperation(operation);
    },
    [executeOperation, queueOperation],
  );

  const saveTask = useCallback(
    async (task: Task) => {
      const normalized = normalizeTask(task);
      const current = readCachedTasks();
      const exists = current.some((item) => item.id === normalized.id);
      const next = exists
        ? current.map((item) => (item.id === normalized.id ? normalized : item))
        : [...current, normalized];
      updateLocalTasks(next);
      submitOperation({
        id: crypto.randomUUID(),
        type: "upsert",
        task: normalized,
      });
    },
    [submitOperation, updateLocalTasks],
  );

  const completeTask = useCallback(
    async (task: Task, completedBy: UserName): Promise<CompletedTaskUndo> => {
      const timestamp = new Date().toISOString();
      const originalTask = normalizeTask(task);
      const completedTask: Task = {
        ...originalTask,
        status: "done",
        completedAt: timestamp,
        completedBy,
        cancelledAt: undefined,
        cancelledBy: undefined,
        updatedAt: timestamp,
      };
      await saveTask(completedTask);

      let generatedTaskId: string | undefined;
      if (originalTask.recurrence.type !== "none" && originalTask.dueDate) {
        generatedTaskId = crypto.randomUUID();
        const nextTask: Task = {
          ...originalTask,
          id: generatedTaskId,
          dueDate: getNextDueDate(originalTask.dueDate, originalTask.recurrence),
          status: "pending",
          completedAt: undefined,
          completedBy: undefined,
          cancelledAt: undefined,
          cancelledBy: undefined,
          recurrenceSeriesId: originalTask.recurrenceSeriesId || originalTask.id,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        await saveTask(nextTask);
      }

      return { originalTask, generatedTaskId };
    },
    [saveTask],
  );

  const deleteTask = useCallback(
    async (taskId: string) => {
      const next = readCachedTasks().filter((task) => task.id !== taskId);
      updateLocalTasks(next);
      submitOperation({ id: crypto.randomUUID(), type: "delete", taskId });
    },
    [submitOperation, updateLocalTasks],
  );

  const undoComplete = useCallback(
    async ({ originalTask, generatedTaskId }: CompletedTaskUndo) => {
      const restoredTask: Task = {
        ...originalTask,
        status: "pending",
        completedAt: undefined,
        completedBy: undefined,
        cancelledAt: undefined,
        cancelledBy: undefined,
        updatedAt: new Date().toISOString(),
      };
      await saveTask(restoredTask);
      if (generatedTaskId) await deleteTask(generatedTaskId);
    },
    [deleteTask, saveTask],
  );

  const replaceTasks = useCallback(
    async (nextTasks: Task[]) => {
      const normalized = nextTasks.map(normalizeTask);
      updateLocalTasks(normalized);
      submitOperation({
        id: crypto.randomUUID(),
        type: "replace",
        tasks: normalized,
      });
    },
    [submitOperation, updateLocalTasks],
  );

  const mergeTasks = useCallback(
    async (importedTasks: Task[]) => {
      const map = new Map(readCachedTasks().map((task) => [task.id, task]));
      importedTasks.forEach((task) => map.set(task.id, normalizeTask(task)));
      await replaceTasks([...map.values()]);
    },
    [replaceTasks],
  );

  useEffect(() => {
    mountedRef.current = true;
    if (!isFirebaseConfigured()) return () => undefined;

    let unsubscribeTasks: Unsubscribe | undefined;
    let unsubscribeConnection: Unsubscribe | undefined;

    const connect = async () => {
      try {
        setSyncState("connecting");
        setSyncMessage("Conectando con Firebase…");
        const { database } = await ensureAnonymousAuthentication();

        unsubscribeConnection = onValue(ref(database, ".info/connected"), (snapshot) => {
          if (!mountedRef.current) return;
          const connected = snapshot.val() === true;
          firebaseConnectedRef.current = connected;
          if (!connected) {
            setSyncState("offline");
            setSyncMessage(
              "Sin conexión: los cambios permanecerán guardados en este dispositivo.",
            );
          } else {
            void retrySync();
          }
        });

        unsubscribeTasks = onValue(
          ref(database, "tasks"),
          (snapshot) => {
            if (!mountedRef.current) return;
            const remoteTasks = recordToTasks(snapshot.val());
            const merged = applyPendingOperations(
              remoteTasks,
              readPendingOperations(),
            );
            updateLocalTasks(merged);
            if (!readPendingOperations().length) {
              setSyncState("synced");
              setSyncMessage("Todos los cambios están sincronizados.");
            }
          },
          () => {
            if (!mountedRef.current) return;
            setSyncState("error");
            setSyncMessage("No se pudieron cargar las tareas compartidas.");
          },
        );

        await get(ref(database, "tasks"));
      } catch {
        firebaseConnectedRef.current = false;
        if (!mountedRef.current) return;
        setSyncState("error");
        setSyncMessage("No se pudo conectar con Firebase.");
      }
    };

    void connect();

    return () => {
      mountedRef.current = false;
      firebaseConnectedRef.current = false;
      unsubscribeTasks?.();
      unsubscribeConnection?.();
    };
  }, [retrySync, updateLocalTasks]);

  return {
    tasks,
    syncState,
    syncMessage,
    pendingCount,
    saveTask,
    completeTask,
    undoComplete,
    deleteTask,
    replaceTasks,
    mergeTasks,
    retrySync,
  };
};
