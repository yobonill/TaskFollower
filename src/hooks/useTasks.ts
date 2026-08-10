import { useCallback, useEffect, useRef, useState } from "react";
import {
  get,
  onValue,
  ref,
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
  RecurrenceType,
  UserName,
} from "../models/task";
import { createDemoTasks } from "../services/demoTasks";
import { getAuthenticatedFirebaseServices } from "../services/firebase";
import { getNextDueDate, normalizeWeekdays } from "../utils/taskDates";
import { getAssigneeUserIds } from "../utils/taskAssignment";

const CACHE_PREFIX = "taskFollower.tasks.v2";
const LEGACY_CACHE_KEY = "taskFollower.tasks.v1";
const PENDING_KEY = "taskFollower.pendingOperations.v1";

const cacheKey = (userId: string): string => `${CACHE_PREFIX}.${userId}`;

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

const isRecurrenceType = (value: unknown): value is RecurrenceType =>
  value === "none" ||
  value === "daily" ||
  value === "weekly" ||
  value === "weekdays" ||
  value === "monthly";

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

  const requestedPrivate = task.isPrivate === true;
  const privateOwnerUserId = requestedPrivate
    ? task.privateOwnerUserId ||
      task.createdByUserId ||
      getAppUserByName(assignedBy).uid
    : undefined;
  const privateOwner = privateOwnerUserId
    ? getAppUserByUid(privateOwnerUserId)
    : undefined;

  let assignedTo: TaskAssignee;
  if (requestedPrivate && privateOwner) {
    assignedTo = privateOwner.name;
  } else if (
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
  const recurrenceType =
    dueDate && isRecurrenceType(recurrence.type) ? recurrence.type : "none";
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
    isPrivate: requestedPrivate,
    privateOwnerUserId: requestedPrivate ? privateOwnerUserId : undefined,
    lastModifiedByUserId:
      task.lastModifiedByUserId ||
      task.createdByUserId ||
      getAppUserByName(assignedBy).uid,
    status: task.status || "pending",
    recurrence: {
      type: recurrenceType,
      interval: Math.max(1, Number(recurrence.interval) || 1),
      weekdays:
        recurrenceType === "weekdays"
          ? normalizeWeekdays(recurrence.weekdays)
          : undefined,
      endDate:
        dueDate &&
        recurrenceType !== "none" &&
        typeof recurrence.endDate === "string" &&
        recurrence.endDate.trim()
          ? recurrence.endDate
          : undefined,
    },
    recurrenceSeriesId:
      dueDate && recurrenceType !== "none"
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

const normalizeTaskForUser = (
  taskValue: Task | LegacyTask,
  currentUser: AppUserDefinition,
  takePrivateOwnership = false,
): Task => {
  const normalized = normalizeTask(taskValue);
  if (!normalized.isPrivate) {
    return {
      ...normalized,
      isPrivate: false,
      privateOwnerUserId: undefined,
    };
  }

  const ownerUserId = takePrivateOwnership
    ? currentUser.uid
    : normalized.privateOwnerUserId || normalized.createdByUserId || currentUser.uid;
  const owner = getAppUserByUid(ownerUserId) || currentUser;

  return {
    ...normalized,
    isPrivate: true,
    privateOwnerUserId: owner.uid,
    assignedTo: owner.name,
    assignedToUserId: owner.uid,
    assignedToUserIds: [owner.uid],
  };
};

const isVisibleToUser = (
  task: Task,
  currentUser: AppUserDefinition,
): boolean =>
  !task.isPrivate || task.privateOwnerUserId === currentUser.uid;

const readCachedTasks = (currentUser: AppUserDefinition): Task[] => {
  try {
    const userStored = localStorage.getItem(cacheKey(currentUser.uid));
    const legacyStored = localStorage.getItem(LEGACY_CACHE_KEY);
    const stored = userStored || legacyStored;
    if (stored) {
      return (JSON.parse(stored) as Task[])
        .map((task) => normalizeTaskForUser(task, currentUser))
        .filter((task) => isVisibleToUser(task, currentUser));
    }
  } catch {
    // Ignore corrupted local cache and fall back to demo data.
  }

  return createDemoTasks()
    .map((task) => normalizeTaskForUser(task, currentUser))
    .filter((task) => isVisibleToUser(task, currentUser));
};

const storeCachedTasks = (
  tasks: Task[],
  currentUser: AppUserDefinition,
): void => {
  const visibleTasks = tasks.filter((task) => isVisibleToUser(task, currentUser));
  localStorage.setItem(cacheKey(currentUser.uid), JSON.stringify(visibleTasks));
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

const recordToTasks = (
  value: unknown,
  currentUser: AppUserDefinition,
  privateTasks = false,
): Task[] => {
  if (!value || typeof value !== "object") return [];
  return Object.values(value as Record<string, Task>)
    .filter((task): task is Task => Boolean(task?.id))
    .map((task) =>
      normalizeTaskForUser(
        privateTasks
          ? {
              ...task,
              isPrivate: true,
              privateOwnerUserId: currentUser.uid,
            }
          : task,
        currentUser,
      ),
    )
    .filter((task) => isVisibleToUser(task, currentUser));
};

const applyPendingOperations = (
  remoteTasks: Task[],
  operations: PendingOperation[],
  currentUser: AppUserDefinition,
): Task[] => {
  let map = new Map(remoteTasks.map((task) => [task.id, task]));

  for (const operation of operations) {
    if (operation.actorUserId && operation.actorUserId !== currentUser.uid) {
      continue;
    }

    if (operation.type === "replace") {
      map = new Map(
        operation.tasks
          .map((task) =>
            normalizeTaskForUser(
              task,
              currentUser,
              task.isPrivate === true,
            ),
          )
          .filter((task) => isVisibleToUser(task, currentUser))
          .map((task) => [task.id, task]),
      );
    } else if (operation.type === "upsert") {
      const task = normalizeTaskForUser(
        operation.task,
        currentUser,
        operation.task.isPrivate === true,
      );
      if (isVisibleToUser(task, currentUser)) map.set(task.id, task);
      else map.delete(task.id);
    } else {
      map.delete(operation.taskId);
    }
  }

  return [...map.values()].filter((task) => isVisibleToUser(task, currentUser));
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
  const [tasks, setTasks] = useState<Task[]>(() => readCachedTasks(currentUser));
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
  const publicRemoteRef = useRef<Task[]>([]);
  const privateRemoteRef = useRef<Task[]>([]);

  const updateLocalTasks = useCallback(
    (nextTasks: Task[]) => {
      const normalized = nextTasks
        .map((task) => normalizeTaskForUser(task, currentUser))
        .filter((task) => isVisibleToUser(task, currentUser));
      setTasks(normalized);
      storeCachedTasks(normalized, currentUser);
    },
    [currentUser],
  );

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
          const task = normalizeTaskForUser(
            operation.task,
            currentUser,
            operation.task.isPrivate === true,
          );
          if (task.isPrivate) {
            await update(ref(database), {
              [`privateTasks/${currentUser.uid}/${task.id}`]: stripUndefined(task),
              [`tasks/${task.id}`]: null,
            });
          } else {
            await update(ref(database), {
              [`tasks/${task.id}`]: stripUndefined(task),
              [`privateTasks/${currentUser.uid}/${task.id}`]: null,
            });
          }
        } else if (operation.type === "delete") {
          await update(ref(database), {
            [`tasks/${operation.taskId}`]: null,
            [`privateTasks/${currentUser.uid}/${operation.taskId}`]: null,
          });
        } else {
          const normalizedTasks = operation.tasks
            .map((task) =>
              normalizeTaskForUser(
                task,
                currentUser,
                task.isPrivate === true,
              ),
            )
            .filter((task) => isVisibleToUser(task, currentUser));
          const publicTasks = normalizedTasks.filter((task) => !task.isPrivate);
          const privateTasks = normalizedTasks.filter((task) => task.isPrivate);

          await set(ref(database, "tasks"), tasksToRecord(publicTasks));
          await set(
            ref(database, `privateTasks/${currentUser.uid}`),
            tasksToRecord(privateTasks),
          );
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
    [currentUser, removePendingOperation],
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
  }, [currentUser.uid, executeOperation]);

  const submitOperation = useCallback(
    (operation: PendingOperation) => {
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
      const normalized = normalizeTaskForUser(
        {
          ...task,
          lastModifiedByUserId: currentUser.uid,
        },
        currentUser,
        task.isPrivate === true,
      );
      const current = readCachedTasks(currentUser);
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
    [currentUser, submitOperation, updateLocalTasks],
  );

  const completeTask = useCallback(
    async (
      task: Task,
      completedBy: AppUserDefinition,
    ): Promise<CompletedTaskUndo> => {
      const timestamp = new Date().toISOString();
      const originalTask = normalizeTaskForUser(task, currentUser);
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
          timestamp,
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
    [currentUser, saveTask],
  );

  const deleteTask = useCallback(
    async (taskId: string) => {
      const next = readCachedTasks(currentUser).filter((task) => task.id !== taskId);
      updateLocalTasks(next);
      submitOperation({ id: crypto.randomUUID(), type: "delete", taskId });
    },
    [currentUser, submitOperation, updateLocalTasks],
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
      const normalized = nextTasks
        .map((task) =>
          normalizeTaskForUser(
            {
              ...task,
              source: task.source || "import",
              lastModifiedByUserId: currentUser.uid,
            },
            currentUser,
            task.isPrivate === true,
          ),
        )
        .filter((task) => isVisibleToUser(task, currentUser));
      updateLocalTasks(normalized);
      submitOperation({
        id: crypto.randomUUID(),
        type: "replace",
        tasks: normalized,
      });
    },
    [currentUser, submitOperation, updateLocalTasks],
  );

  const mergeTasks = useCallback(
    async (importedTasks: Task[]) => {
      const map = new Map(
        readCachedTasks(currentUser).map((task) => [task.id, task]),
      );
      importedTasks.forEach((task) => {
        const normalized = normalizeTaskForUser(
          {
            ...task,
            source: task.source || "import",
            lastModifiedByUserId: currentUser.uid,
          },
          currentUser,
          task.isPrivate === true,
        );
        if (isVisibleToUser(normalized, currentUser)) {
          map.set(normalized.id, normalized);
        }
      });
      await replaceTasks([...map.values()]);
    },
    [currentUser, replaceTasks],
  );

  useEffect(() => {
    mountedRef.current = true;
    migrationAttemptedRef.current = false;
    publicRemoteRef.current = [];
    privateRemoteRef.current = [];
    updateLocalTasks(readCachedTasks(currentUser));

    if (!isFirebaseConfigured()) return () => undefined;

    let unsubscribePublicTasks: Unsubscribe | undefined;
    let unsubscribePrivateTasks: Unsubscribe | undefined;
    let unsubscribeConnection: Unsubscribe | undefined;

    const refreshFromRemote = () => {
      if (!mountedRef.current) return;
      const eligiblePending = readPendingOperations().filter(
        (operation) =>
          !operation.actorUserId || operation.actorUserId === currentUser.uid,
      );
      const merged = applyPendingOperations(
        [...publicRemoteRef.current, ...privateRemoteRef.current],
        eligiblePending,
        currentUser,
      );
      updateLocalTasks(merged);

      if (!eligiblePending.length) {
        setSyncState("synced");
        setSyncMessage("Todos los cambios están sincronizados.");
      }
    };

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

        unsubscribePublicTasks = onValue(
          ref(database, "tasks"),
          (snapshot) => {
            if (!mountedRef.current) return;
            const rawRecord =
              snapshot.val() && typeof snapshot.val() === "object"
                ? (snapshot.val() as Record<string, Partial<Task>>)
                : {};
            publicRemoteRef.current = recordToTasks(
              rawRecord,
              currentUser,
              false,
            );
            refreshFromRemote();

            if (
              !migrationAttemptedRef.current &&
              !readPendingOperations().length
            ) {
              migrationAttemptedRef.current = true;
              const migratedEntries = publicRemoteRef.current.filter((task) =>
                needsIdentityMigration(rawRecord[task.id] || {}),
              );
              if (migratedEntries.length) {
                const migrationUpdate = Object.fromEntries(
                  migratedEntries.map((task) => [task.id, stripUndefined(task)]),
                );
                void update(ref(database, "tasks"), migrationUpdate).catch(() => {
                  migrationAttemptedRef.current = false;
                });
              }
            }
          },
          () => {
            if (!mountedRef.current) return;
            setSyncState("error");
            setSyncMessage("No se pudieron cargar las tareas compartidas.");
          },
        );

        unsubscribePrivateTasks = onValue(
          ref(database, `privateTasks/${currentUser.uid}`),
          (snapshot) => {
            if (!mountedRef.current) return;
            privateRemoteRef.current = recordToTasks(
              snapshot.val(),
              currentUser,
              true,
            );
            refreshFromRemote();
          },
          () => {
            if (!mountedRef.current) return;
            setSyncState("error");
            setSyncMessage("No se pudieron cargar tus tareas privadas.");
          },
        );

        await Promise.all([
          get(ref(database, "tasks")),
          get(ref(database, `privateTasks/${currentUser.uid}`)),
        ]);
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
      unsubscribePublicTasks?.();
      unsubscribePrivateTasks?.();
      unsubscribeConnection?.();
    };
  }, [currentUser, retrySync, updateLocalTasks]);

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
