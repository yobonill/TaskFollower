import { useCallback, useEffect, useRef, useState } from "react";
import {
  get,
  onValue,
  ref,
  remove,
  set,
  type Unsubscribe,
} from "firebase/database";
import { isFirebaseConfigured } from "../config/firebaseConfig";
import type { SyncState, Task, UserName } from "../models/task";
import { createDemoTasks } from "../services/demoTasks";
import {
  ensureAnonymousAuthentication,
  getFirebaseServices,
} from "../services/firebase";
import { getNextDueDate } from "../utils/taskDates";

const CACHE_KEY = "taskFollower.tasks.v1";
const PENDING_KEY = "taskFollower.pendingOperations.v1";

type PendingOperation =
  | { id: string; type: "upsert"; task: Task }
  | { id: string; type: "delete"; taskId: string }
  | { id: string; type: "replace"; tasks: Task[] };

const readCachedTasks = (): Task[] => {
  try {
    const stored = localStorage.getItem(CACHE_KEY);
    if (stored) return JSON.parse(stored) as Task[];
  } catch {
    // Ignore corrupted local cache and fall back to demo data.
  }
  return createDemoTasks();
};

const storeCachedTasks = (tasks: Task[]): void => {
  localStorage.setItem(CACHE_KEY, JSON.stringify(tasks));
};

const readPendingOperations = (): PendingOperation[] => {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) || "[]") as PendingOperation[];
  } catch {
    return [];
  }
};

const storePendingOperations = (operations: PendingOperation[]): void => {
  localStorage.setItem(PENDING_KEY, JSON.stringify(operations));
};

const tasksToRecord = (tasks: Task[]): Record<string, Task> =>
  Object.fromEntries(tasks.map((task) => [task.id, task]));

const recordToTasks = (value: unknown): Task[] => {
  if (!value || typeof value !== "object") return [];
  return Object.values(value as Record<string, Task>).filter(
    (task): task is Task => Boolean(task?.id && task?.name),
  );
};

const applyPendingOperations = (
  remoteTasks: Task[],
  operations: PendingOperation[],
): Task[] => {
  let map = new Map(remoteTasks.map((task) => [task.id, task]));

  for (const operation of operations) {
    if (operation.type === "replace") {
      map = new Map(operation.tasks.map((task) => [task.id, task]));
    } else if (operation.type === "upsert") {
      map.set(operation.task.id, operation.task);
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
  completeTask: (task: Task, completedBy: UserName) => Promise<void>;
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

  const updateLocalTasks = useCallback((nextTasks: Task[]) => {
    setTasks(nextTasks);
    storeCachedTasks(nextTasks);
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
      if (!isFirebaseConfigured()) return false;

      try {
        setSyncState("saving");
        setSyncMessage("Guardando cambios…");
        const { database } = await ensureAnonymousAuthentication();

        if (operation.type === "upsert") {
          await set(ref(database, `tasks/${operation.task.id}`), operation.task);
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
      } catch (error) {
        if (mountedRef.current) {
          setSyncState(navigator.onLine ? "error" : "offline");
          setSyncMessage(
            error instanceof Error
              ? "Los cambios se guardaron en este dispositivo, pero no pudieron sincronizarse."
              : "Los cambios se guardaron en este dispositivo, pero no pudieron sincronizarse.",
          );
        }
        return false;
      }
    },
    [removePendingOperation],
  );

  const retrySync = useCallback(async () => {
    const operations = readPendingOperations();
    if (!operations.length) {
      setSyncState(isFirebaseConfigured() ? "synced" : "local");
      setSyncMessage(
        isFirebaseConfigured()
          ? "Todos los cambios están sincronizados."
          : "Vista local: agrega la configuración de Firebase para sincronizar los dispositivos.",
      );
      return;
    }

    for (const operation of operations) {
      const succeeded = await executeOperation(operation);
      if (!succeeded) break;
    }
  }, [executeOperation]);

  const submitOperation = useCallback(
    async (operation: PendingOperation) => {
      queueOperation(operation);
      await executeOperation(operation);
    },
    [executeOperation, queueOperation],
  );

  const saveTask = useCallback(
    async (task: Task) => {
      const current = readCachedTasks();
      const exists = current.some((item) => item.id === task.id);
      const next = exists
        ? current.map((item) => (item.id === task.id ? task : item))
        : [...current, task];
      updateLocalTasks(next);
      await submitOperation({ id: crypto.randomUUID(), type: "upsert", task });
    },
    [submitOperation, updateLocalTasks],
  );

  const completeTask = useCallback(
    async (task: Task, completedBy: UserName) => {
      const timestamp = new Date().toISOString();
      const completedTask: Task = {
        ...task,
        status: "done",
        completedAt: timestamp,
        completedBy,
        updatedAt: timestamp,
      };
      await saveTask(completedTask);

      if (task.recurrence.type !== "none") {
        const nextTask: Task = {
          ...task,
          id: crypto.randomUUID(),
          dueDate: getNextDueDate(task.dueDate, task.recurrence),
          status: "pending",
          completedAt: undefined,
          completedBy: undefined,
          recurrenceSeriesId: task.recurrenceSeriesId || task.id,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        await saveTask(nextTask);
      }
    },
    [saveTask],
  );

  const deleteTask = useCallback(
    async (taskId: string) => {
      const next = readCachedTasks().filter((task) => task.id !== taskId);
      updateLocalTasks(next);
      await submitOperation({ id: crypto.randomUUID(), type: "delete", taskId });
    },
    [submitOperation, updateLocalTasks],
  );

  const replaceTasks = useCallback(
    async (nextTasks: Task[]) => {
      updateLocalTasks(nextTasks);
      await submitOperation({
        id: crypto.randomUUID(),
        type: "replace",
        tasks: nextTasks,
      });
    },
    [submitOperation, updateLocalTasks],
  );

  const mergeTasks = useCallback(
    async (importedTasks: Task[]) => {
      const map = new Map(readCachedTasks().map((task) => [task.id, task]));
      importedTasks.forEach((task) => map.set(task.id, task));
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
          if (!connected) {
            setSyncState("offline");
            setSyncMessage("Sin conexión: los cambios permanecerán guardados en este dispositivo.");
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
          (error) => {
            if (!mountedRef.current) return;
            setSyncState("error");
            setSyncMessage("No se pudieron cargar las tareas compartidas.");
          },
        );

        // Trigger one read early so permission/config errors surface quickly.
        await get(ref(database, "tasks"));
      } catch (error) {
        if (!mountedRef.current) return;
        setSyncState("error");
        setSyncMessage(
          "No se pudo conectar con Firebase.",
        );
      }
    };

    void connect();

    return () => {
      mountedRef.current = false;
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
    deleteTask,
    replaceTasks,
    mergeTasks,
    retrySync,
  };
};
