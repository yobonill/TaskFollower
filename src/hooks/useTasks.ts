import { useCallback, useEffect, useRef, useState } from "react";
import {
  get,
  onValue,
  ref,
  remove,
  set,
  update,
  type Unsubscribe,
} from "firebase/database";
import {
  getAppUserByName,
  getAppUserByUid,
  type AppUserDefinition,
} from "../config/appUsers";
import { isFirebaseConfigured } from "../config/firebaseConfig";
import type {
  CompletedTaskUndo,
  SyncState,
  Task,
  TaskPriority,
  TaskAssignee,
  UserName,
} from "../models/task";
import { createDemoTasks } from "../services/demoTasks";
import { getAuthenticatedFirebaseServices } from "../services/firebase";
import { getNextDueDate } from "../utils/taskDates";
import { getAssigneeUserIds } from "../utils/taskAssignment";

const CACHE_KEY = "taskFollower.tasks.v1";
const PENDING_KEY = "taskFollower.pendingOperations.v1";

type PendingOperation =
  | { id: string; actorUserId?: string; type: "upsert"; task: Task }
  | { id: string; actorUserId?: string; type: "delete"; taskId: string }
  | { id: string; actorUserId?: string; type: "replace"; tasks: Task[] };

type LegacyTask = Partial<Task> & {
  id: string;
  urgency?: TaskPriority;
};

const isUserName = (value: unknown): value is UserName =>
  value === "Yisel" || value === "Yorki";

const isTaskAssignee = (value: unknown): value is TaskAssignee =>
  isUserName(value) || value === "Ambos";

const normalizeTask = (taskValue: Task | LegacyTask): Task => {
  const task = taskValue as LegacyTask;
  const { urgency: legacyUrgency, ...taskWithoutLegacyUrgency } = task;

  const creatorFromUid = getAppUserByUid(task.createdByUserId);
  const completedByFromUid = getAppUserByUid(task.completedByUserId);
  const cancelledByFromUid = getAppUserByUid(task.cancelledByUserId);

  const uidAssignees = Array.isArray(task.assignedToUserIds)
    ? task.assignedToUserIds
        .map((uid) => getAppUserByUid(uid))
        .filter((user): user is AppUserDefinition => Boolean(user))
    : [];
  const assigneeFromLegacyUid = getAppUserByUid(task.assignedToUserId);

  const assignedBy: UserName =
    creatorFromUid?.name ||
    (isUserName(task.assignedBy) ? task.assignedBy : undefined) ||
    (isUserName(task.assignedTo) ? task.assignedTo : undefined) ||
    "Yorki";

  let assignedTo: TaskAssignee;
  if (
    task.assignedTo === "Ambos" ||
    new Set(uidAssignees.map((user) => user.name)).size > 1
  ) {
    assignedTo = "Ambos";
  } else {
    assignedTo =
      assigneeFromLegacyUid?.name ||
      uidAssignees[0]?.name ||
      (isTaskAssignee(task.assignedTo) ? task.assignedTo : undefined) ||
      assignedBy;
  }

  const assignedToUserIds = getAssigneeUserIds(assignedTo);
  const dueDate =
    typeof task.dueDate === "string" && task.dueDate.trim()
      ? task.dueDate
      : undefined;
  const recurrence = task.recurrence || { type: "none" as const, interval: 1 };
  const createdAt = task.createdAt || new Date().toISOString();
  const estimatedMinutes = Number(task.estimatedMinutes);

  return {
    ...taskWithoutLegacyUrgency,
    id: task.id,
    name: typeof task.name === "string" ? task.name : "",
    description: task.description || "",
    estimatedMinutes:
      Number.isFinite(estimatedMinutes) && estimatedMinutes > 0
        ? Math.max(1, estimatedMinutes)
        : undefined,
    dueDate,
    dueTime: dueDate && task.dueTime ? task.dueTime : undefined,
    priority: task.priority || legacyUrgency || undefined,
    assignedBy,
    assignedTo,
    createdByUserId:
      task.createdByUserId || getAppUserByName(assignedBy).uid,
    assignedToUserId:
      assignedTo === "Ambos" ? undefined : assignedToUserIds[0],
    assignedToUserIds,
    lastModifiedByUserId:
      task.lastModifiedByUserId ||
      task.createdByUserId ||
      getAppUserByName(assignedBy).uid,
    status: task.status || "pending",
    recurrence: {
      type: dueDate ? recurrence.type || "none" : "none",
      interval: Math.max(1, Number(recurrence.interval) || 1),
      endDate:
        dueDate &&
        recurrence.type !== "none" &&
        typeof recurrence.endDate === "string" &&
        recurrence.endDate.trim()
          ? recurrence.endDate
          : undefined,
    },
    recurrenceSeriesId:
      dueDate && recurrence.type !== "none"
        ? task.recurrenceSeriesId
        : undefined,
    source: task.source || "migration",
    createdAt,
    updatedAt: task.updatedAt || createdAt,
    completedAt: task.completedAt,
    completedBy:
      completedByFromUid?.name ||
      (isUserName(task.completedBy) ? task.completedBy : undefined),
    completedByUserId:
      task.completedByUserId ||
      (isUserName(task.completedBy)
        ? getAppUserByName(task.completedBy).uid
        : undefined),
    cancelledAt: task.cancelledAt,
    cancelledBy:
      cancelledByFromUid?.name ||
      (isUserName(task.cancelledBy) ? task.cancelledBy : undefined),
    cancelledByUserId:
      task.cancelledByUserId ||
      (isUserName(task.cancelledBy)
        ? getAppUserByName(task.cancelledBy).uid
        : undefined),
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

const needsIdentityMigration = (task: Partial<Task>): boolean => {
  if (!task.createdByUserId || !task.lastModifiedByUserId || !task.source) {
    return true;
  }

  const assignedTo = isTaskAssignee(task.assignedTo) ? task.assignedTo : undefined;
  const expectedIds = assignedTo ? getAssigneeUserIds(assignedTo) : [];
  const currentIds = Array.isArray(task.assignedToUserIds)
    ? [...task.assignedToUserIds].sort()
    : [];
  if (
    expectedIds.length !== currentIds.length ||
    expectedIds.some((uid) => !currentIds.includes(uid))
  ) {
    return true;
  }

  if (assignedTo !== "Ambos" && !task.assignedToUserId) return true;
  if (assignedTo === "Ambos" && task.assignedToUserId) return true;
  if (Boolean(task.completedBy) && !task.completedByUserId) return true;
  if (Boolean(task.cancelledBy) && !task.cancelledByUserId) return true;
  return false;
};

export interface UseTasksResult {
  tasks: Task[];
  syncState: SyncState;
  syncMessage: string;
  pendingCount: number;
  saveTask: (task: Task) => Promise<void>;
  completeTask: (
    task: Task,
    completedBy: AppUserDefinition,
  ) => Promise<CompletedTaskUndo>;
  undoComplete: (undo: CompletedTaskUndo) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  replaceTasks: (tasks: Task[]) => Promise<void>;
  mergeTasks: (tasks: Task[]) => Promise<void>;
  retrySync: () => Promise<void>;
}

export const useTasks = (
  currentUser: AppUserDefinition,
): UseTasksResult => {
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
  const migrationAttemptedRef = useRef(false);

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

      if (operation.actorUserId && operation.actorUserId !== currentUser.uid) {
        return false;
      }

      try {
        setSyncState("saving");
        setSyncMessage("Guardando cambios…");
        const { auth, database } = getAuthenticatedFirebaseServices();
        if (auth.currentUser?.uid !== currentUser.uid) {
          throw new Error("La sesión cambió antes de sincronizar.");
        }

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
    [currentUser.uid, removePendingOperation],
  );

  const retrySync = useCallback(async () => {
    const operations = readPendingOperations();
    const eligibleOperations = operations.filter(
      (operation) =>
        !operation.actorUserId || operation.actorUserId === currentUser.uid,
    );

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

    if (!eligibleOperations.length) {
      setSyncState("offline");
      setSyncMessage(
        "Hay cambios pendientes de otro usuario en este dispositivo. Se sincronizarán cuando esa persona inicie sesión.",
      );
      return;
    }

    for (const operation of eligibleOperations) {
      const succeeded = await executeOperation(operation);
      if (!succeeded) break;
    }
  }, [executeOperation]);

  const submitOperation = useCallback(
    (operation: PendingOperation) => {
      // Local persistence is the UI completion point. Firebase runs in the
      // background so an offline write never blocks the task form.
      const attributedOperation: PendingOperation = {
        ...operation,
        actorUserId: operation.actorUserId || currentUser.uid,
      };
      queueOperation(attributedOperation);

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

      void executeOperation(attributedOperation);
    },
    [currentUser.uid, executeOperation, queueOperation],
  );

  const saveTask = useCallback(
    async (task: Task) => {
      const normalized = normalizeTask({
        ...task,
        lastModifiedByUserId: currentUser.uid,
      });
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
    [currentUser.uid, submitOperation, updateLocalTasks],
  );

  const completeTask = useCallback(
    async (
      task: Task,
      completedBy: AppUserDefinition,
    ): Promise<CompletedTaskUndo> => {
      const timestamp = new Date().toISOString();
      const originalTask = normalizeTask(task);
      const completedTask: Task = {
        ...originalTask,
        status: "done",
        completedAt: timestamp,
        completedBy: completedBy.name,
        completedByUserId: completedBy.uid,
        cancelledAt: undefined,
        cancelledBy: undefined,
        cancelledByUserId: undefined,
        lastModifiedByUserId: completedBy.uid,
        updatedAt: timestamp,
      };
      await saveTask(completedTask);

      let generatedTaskId: string | undefined;
      if (originalTask.recurrence.type !== "none" && originalTask.dueDate) {
        const nextDueDate = getNextDueDate(
          originalTask.dueDate,
          originalTask.recurrence,
        );
        const mayCreateNext =
          !originalTask.recurrence.endDate ||
          nextDueDate <= originalTask.recurrence.endDate;

        if (mayCreateNext) {
          generatedTaskId = crypto.randomUUID();
          const nextTask: Task = {
            ...originalTask,
            id: generatedTaskId,
            dueDate: nextDueDate,
            status: "pending",
            source: "recurrence",
            completedAt: undefined,
            completedBy: undefined,
            completedByUserId: undefined,
            cancelledAt: undefined,
            cancelledBy: undefined,
            cancelledByUserId: undefined,
            lastModifiedByUserId: completedBy.uid,
            recurrenceSeriesId: originalTask.recurrenceSeriesId || originalTask.id,
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          await saveTask(nextTask);
        }
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
        completedByUserId: undefined,
        cancelledAt: undefined,
        cancelledBy: undefined,
        cancelledByUserId: undefined,
        lastModifiedByUserId: currentUser.uid,
        updatedAt: new Date().toISOString(),
      };
      await saveTask(restoredTask);
      if (generatedTaskId) await deleteTask(generatedTaskId);
    },
    [currentUser.uid, deleteTask, saveTask],
  );

  const replaceTasks = useCallback(
    async (nextTasks: Task[]) => {
      const normalized = nextTasks.map((task) =>
        normalizeTask({
          ...task,
          source: task.source || "import",
          lastModifiedByUserId: currentUser.uid,
        }),
      );
      updateLocalTasks(normalized);
      submitOperation({
        id: crypto.randomUUID(),
        type: "replace",
        tasks: normalized,
      });
    },
    [currentUser.uid, submitOperation, updateLocalTasks],
  );

  const mergeTasks = useCallback(
    async (importedTasks: Task[]) => {
      const map = new Map(readCachedTasks().map((task) => [task.id, task]));
      importedTasks.forEach((task) =>
        map.set(
          task.id,
          normalizeTask({
          ...task,
          source: task.source || "import",
          lastModifiedByUserId: currentUser.uid,
        }),
        ),
      );
      await replaceTasks([...map.values()]);
    },
    [currentUser.uid, replaceTasks],
  );

  useEffect(() => {
    mountedRef.current = true;
    migrationAttemptedRef.current = false;
    if (!isFirebaseConfigured()) return () => undefined;

    let unsubscribeTasks: Unsubscribe | undefined;
    let unsubscribeConnection: Unsubscribe | undefined;

    const connect = async () => {
      try {
        setSyncState("connecting");
        setSyncMessage("Conectando con Firebase…");
        const { auth, database } = getAuthenticatedFirebaseServices();
        if (auth.currentUser?.uid !== currentUser.uid) {
          throw new Error("La sesión activa no coincide con el usuario de la aplicación.");
        }

        unsubscribeConnection = onValue(
          ref(database, ".info/connected"),
          (snapshot) => {
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
          },
        );

        unsubscribeTasks = onValue(
          ref(database, "tasks"),
          (snapshot) => {
            if (!mountedRef.current) return;
            const rawRecord =
              snapshot.val() && typeof snapshot.val() === "object"
                ? (snapshot.val() as Record<string, Partial<Task>>)
                : {};
            const remoteTasks = recordToTasks(rawRecord);
            const merged = applyPendingOperations(
              remoteTasks,
              readPendingOperations(),
            );
            updateLocalTasks(merged);

            if (
              !migrationAttemptedRef.current &&
              !readPendingOperations().length
            ) {
              migrationAttemptedRef.current = true;
              const migratedEntries = remoteTasks.filter((task) =>
                needsIdentityMigration(rawRecord[task.id] || {}),
              );
              if (migratedEntries.length) {
                const migrationUpdate = Object.fromEntries(
                  migratedEntries.map((task) => [task.id, stripUndefined(task)]),
                );
                void update(ref(database, "tasks"), migrationUpdate).catch(() => {
                  // The application remains usable; migration retries on a later load.
                  migrationAttemptedRef.current = false;
                });
              }
            }

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
        setSyncMessage("No se pudo conectar con Firebase con esta sesión.");
      }
    };

    void connect();

    return () => {
      mountedRef.current = false;
      firebaseConnectedRef.current = false;
      unsubscribeTasks?.();
      unsubscribeConnection?.();
    };
  }, [currentUser.uid, retrySync, updateLocalTasks]);

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
