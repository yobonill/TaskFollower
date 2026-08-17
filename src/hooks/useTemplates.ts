import { useCallback, useEffect, useRef, useState } from "react";
import { get, onValue, ref, remove, set, type Unsubscribe } from "firebase/database";
import type { AppUserDefinition } from "../config/appUsers";
import { isFirebaseConfigured } from "../config/firebaseConfig";
import type { TaskTemplate } from "../models/template";
import type { RecurrenceType, TaskAssignee, TaskPriority, UserName } from "../models/task";
import { getAuthenticatedFirebaseServices } from "../services/firebase";
import { normalizeWeekdays } from "../utils/taskDates";

const CACHE_PREFIX = "taskFollower.templates.v3";
const LEGACY_CACHE_KEY = "taskFollower.templates.v2";
const OLDER_LEGACY_CACHE_KEY = "taskFollower.templates.v1";
const PENDING_KEY = "taskFollower.templates.pending.v3";
const LEGACY_PENDING_KEY = "taskFollower.templates.pending.v2";
const OLDER_LEGACY_PENDING_KEY = "taskFollower.templates.pending.v1";
const INITIALIZED_KEY = "taskFollower.templates.defaultsInitialized.v1";

const cacheKey = (userId: string): string => `${CACHE_PREFIX}.${userId}`;

type PendingOperation =
  | {
      id: string;
      actorUserId: string;
      type: "upsert";
      template: TaskTemplate;
    }
  | {
      id: string;
      actorUserId: string;
      type: "delete";
      templateId: string;
    };

type LegacyTemplate = Partial<TaskTemplate> & {
  id: string;
  name: string;
  priority?: TaskPriority;
  assignedTo?: TaskAssignee;
  recurrence?: Partial<TaskTemplate["recurrence"]>;
};

const isAssignee = (value: unknown): value is TaskAssignee =>
  value === "Yisel" || value === "Yorki" || value === "Ambos";

const isRecurrenceType = (value: unknown): value is RecurrenceType =>
  value === "none" ||
  value === "daily" ||
  value === "weekly" ||
  value === "weekdays" ||
  value === "monthly";

const normalizeTemplate = (
  value: LegacyTemplate,
  currentUser: AppUserDefinition,
  takePrivateOwnership = false,
): TaskTemplate => {
  const dueDate =
    typeof value.dueDate === "string" && value.dueDate.trim()
      ? value.dueDate
      : undefined;
  const recurrenceType =
    dueDate && isRecurrenceType(value.recurrence?.type)
      ? value.recurrence.type
      : "none";
  const estimatedMinutes = Number(value.estimatedMinutes);
  const createdAt = value.createdAt || new Date().toISOString();
  const isPrivate = value.isPrivate === true;
  const privateOwnerUserId = isPrivate
    ? takePrivateOwnership
      ? currentUser.uid
      : value.privateOwnerUserId || value.createdByUserId || currentUser.uid
    : undefined;
  const ownsPrivateTemplate = !isPrivate || privateOwnerUserId === currentUser.uid;

  return {
    id: value.id,
    name: typeof value.name === "string" ? value.name : "",
    description: value.description || "",
    estimatedMinutes:
      Number.isFinite(estimatedMinutes) && estimatedMinutes > 0
        ? Math.max(1, estimatedMinutes)
        : undefined,
    priority: value.priority,
    assignedTo:
      isPrivate && ownsPrivateTemplate
        ? currentUser.name
        : isAssignee(value.assignedTo)
          ? value.assignedTo
          : currentUser.name,
    isPrivate,
    privateOwnerUserId,
    dueDate,
    dueTime: dueDate && value.dueTime ? value.dueTime : undefined,
    recurrence: {
      type: recurrenceType,
      interval: Math.max(1, Number(value.recurrence?.interval) || 1),
      weekdays:
        recurrenceType === "weekdays"
          ? normalizeWeekdays(value.recurrence?.weekdays)
          : undefined,
      occurrencesPerDay:
        recurrenceType !== "none"
          ? Math.min(
              20,
              Math.max(1, Math.floor(Number(value.recurrence?.occurrencesPerDay) || 1)),
            )
          : undefined,
      endDate:
        dueDate &&
        recurrenceType !== "none" &&
        typeof value.recurrence?.endDate === "string" &&
        value.recurrence.endDate.trim()
          ? value.recurrence.endDate
          : undefined,
    },
    createdAt,
    updatedAt: value.updatedAt || createdAt,
    createdByUserId: value.createdByUserId || currentUser.uid,
  };
};

const defaultTemplates = (user: AppUserDefinition): TaskTemplate[] => {
  const timestamp = new Date().toISOString();
  const create = (
    id: string,
    name: string,
    estimatedMinutes: number,
    priority: TaskPriority,
  ): TaskTemplate => ({
    id,
    name,
    description: "",
    estimatedMinutes,
    priority,
    assignedTo: user.name,
    isPrivate: false,
    recurrence: { type: "none", interval: 1 },
    createdAt: timestamp,
    updatedAt: timestamp,
    createdByUserId: user.uid,
  });

  return [
    create("template-clean-house", "Limpiar la casa", 60, "normal"),
    create("template-groceries", "Comprar en el supermercado", 45, "normal"),
    create("template-bill", "Pagar factura", 10, "high"),
    create("template-trash", "Sacar la basura", 10, "normal"),
    create("template-laundry", "Lavar la ropa", 15, "normal"),
  ];
};

const readRawArray = <T,>(key: string): T[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]") as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
};

const readCachedTemplates = (currentUser: AppUserDefinition): TaskTemplate[] => {
  const userCache = readRawArray<LegacyTemplate>(cacheKey(currentUser.uid));
  const legacy = userCache.length
    ? userCache
    : readRawArray<LegacyTemplate>(LEGACY_CACHE_KEY).length
      ? readRawArray<LegacyTemplate>(LEGACY_CACHE_KEY)
      : readRawArray<LegacyTemplate>(OLDER_LEGACY_CACHE_KEY);

  return legacy
    .filter((item) => Boolean(item?.id && item?.name))
    .map((item) => normalizeTemplate(item, currentUser))
    .filter(
      (template) =>
        !template.isPrivate || template.privateOwnerUserId === currentUser.uid,
    );
};

const readPending = (currentUser: AppUserDefinition): PendingOperation[] => {
  const current = readRawArray<PendingOperation>(PENDING_KEY);
  const raw = current.length
    ? current
    : readRawArray<PendingOperation>(LEGACY_PENDING_KEY).length
      ? readRawArray<PendingOperation>(LEGACY_PENDING_KEY)
      : readRawArray<PendingOperation>(OLDER_LEGACY_PENDING_KEY);

  return raw.map((operation) =>
    operation.type === "upsert"
      ? {
          ...operation,
          template: normalizeTemplate(
            operation.template as LegacyTemplate,
            currentUser,
            operation.template.isPrivate === true,
          ),
        }
      : operation,
  );
};

const storeTemplates = (
  templates: TaskTemplate[],
  currentUser: AppUserDefinition,
): void => {
  const visible = templates.filter(
    (template) =>
      !template.isPrivate || template.privateOwnerUserId === currentUser.uid,
  );
  localStorage.setItem(cacheKey(currentUser.uid), JSON.stringify(visible));
};

const storePending = (operations: PendingOperation[]): void => {
  localStorage.setItem(PENDING_KEY, JSON.stringify(operations));
};

const stripUndefined = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const recordToTemplates = (
  value: unknown,
  currentUser: AppUserDefinition,
  privateTemplates = false,
): TaskTemplate[] => {
  if (!value || typeof value !== "object") return [];
  return Object.values(value as Record<string, LegacyTemplate>)
    .filter((item): item is LegacyTemplate => Boolean(item?.id && item?.name))
    .map((item) =>
      normalizeTemplate(
        {
          ...item,
          isPrivate: privateTemplates ? true : item.isPrivate,
          privateOwnerUserId: privateTemplates ? currentUser.uid : item.privateOwnerUserId,
        },
        currentUser,
      ),
    )
    .filter(
      (template) =>
        !template.isPrivate || template.privateOwnerUserId === currentUser.uid,
    );
};

const mergePending = (
  remote: TaskTemplate[],
  operations: PendingOperation[],
  currentUser: AppUserDefinition,
): TaskTemplate[] => {
  const map = new Map(remote.map((template) => [template.id, template]));
  for (const operation of operations) {
    if (operation.actorUserId !== currentUser.uid) continue;
    if (operation.type === "upsert") {
      map.set(
        operation.template.id,
        normalizeTemplate(operation.template, currentUser, operation.template.isPrivate === true),
      );
    } else {
      map.delete(operation.templateId);
    }
  }
  return [...map.values()].filter(
    (template) =>
      !template.isPrivate || template.privateOwnerUserId === currentUser.uid,
  );
};

export interface UseTemplatesResult {
  templates: TaskTemplate[];
  pendingCount: number;
  saveTemplate: (template: TaskTemplate) => Promise<void>;
  deleteTemplate: (templateId: string) => Promise<void>;
  retrySync: () => Promise<void>;
}

export const useTemplates = (
  currentUser: AppUserDefinition,
): UseTemplatesResult => {
  const [templates, setTemplates] = useState<TaskTemplate[]>(() =>
    readCachedTemplates(currentUser),
  );
  const [pendingCount, setPendingCount] = useState(
    () => readPending(currentUser).length,
  );
  const [firebaseConnected, setFirebaseConnected] = useState(false);
  const publicRemoteRef = useRef<TaskTemplate[]>([]);
  const privateRemoteRef = useRef<TaskTemplate[]>([]);

  const updateLocal = useCallback(
    (next: TaskTemplate[]) => {
      const visible = next.filter(
        (template) =>
          !template.isPrivate || template.privateOwnerUserId === currentUser.uid,
      );
      const sorted = [...visible].sort((a, b) => a.name.localeCompare(b.name, "es"));
      setTemplates(sorted);
      storeTemplates(sorted, currentUser);
    },
    [currentUser],
  );

  const queueOperation = useCallback((operation: PendingOperation) => {
    const next = [
      ...readPending(currentUser).filter((item) => item.id !== operation.id),
      operation,
    ];
    storePending(next);
    setPendingCount(next.length);
  }, [currentUser]);

  const removePending = useCallback((operationId: string) => {
    const next = readPending(currentUser).filter(
      (item) => item.id !== operationId,
    );
    storePending(next);
    setPendingCount(next.length);
  }, [currentUser]);

  const execute = useCallback(
    async (operation: PendingOperation): Promise<boolean> => {
      if (
        !isFirebaseConfigured() ||
        !navigator.onLine ||
        !firebaseConnected ||
        operation.actorUserId !== currentUser.uid
      ) {
        return false;
      }

      try {
        const { auth, database } = getAuthenticatedFirebaseServices();
        if (auth.currentUser?.uid !== currentUser.uid) return false;

        if (operation.type === "upsert") {
          const template = normalizeTemplate(
            operation.template,
            currentUser,
            operation.template.isPrivate === true,
          );

          if (template.isPrivate) {
            await set(
              ref(database, `privateTaskTemplates/${currentUser.uid}/items/${template.id}`),
              stripUndefined(template),
            );
            await remove(ref(database, `taskTemplates/items/${template.id}`));
          } else {
            await set(
              ref(database, `taskTemplates/items/${template.id}`),
              stripUndefined(template),
            );
            await remove(
              ref(database, `privateTaskTemplates/${currentUser.uid}/items/${template.id}`),
            );
          }
        } else {
          await Promise.all([
            remove(ref(database, `taskTemplates/items/${operation.templateId}`)),
            remove(
              ref(
                database,
                `privateTaskTemplates/${currentUser.uid}/items/${operation.templateId}`,
              ),
            ),
          ]);
        }

        removePending(operation.id);
        return true;
      } catch {
        return false;
      }
    },
    [currentUser, firebaseConnected, removePending],
  );

  const submit = useCallback(
    (operation: PendingOperation) => {
      queueOperation(operation);
      if (navigator.onLine && firebaseConnected && isFirebaseConfigured()) {
        void execute(operation);
      }
    },
    [execute, firebaseConnected, queueOperation],
  );

  const retrySync = useCallback(async () => {
    if (!navigator.onLine || !firebaseConnected) return;
    const eligible = readPending(currentUser).filter(
      (operation) => operation.actorUserId === currentUser.uid,
    );
    for (const operation of eligible) {
      const succeeded = await execute(operation);
      if (!succeeded) break;
    }
  }, [currentUser, execute, firebaseConnected]);

  const saveTemplate = useCallback(
    async (template: TaskTemplate) => {
      const normalized = normalizeTemplate(
        template,
        currentUser,
        template.isPrivate === true,
      );
      const current = readCachedTemplates(currentUser);
      const next = current.some((item) => item.id === normalized.id)
        ? current.map((item) => (item.id === normalized.id ? normalized : item))
        : [...current, normalized];
      updateLocal(next);
      submit({
        id: `template-upsert:${normalized.id}`,
        actorUserId: currentUser.uid,
        type: "upsert",
        template: normalized,
      });
    },
    [currentUser, submit, updateLocal],
  );

  const deleteTemplate = useCallback(
    async (templateId: string) => {
      updateLocal(
        readCachedTemplates(currentUser).filter(
          (item) => item.id !== templateId,
        ),
      );
      submit({
        id: `template-delete:${templateId}`,
        actorUserId: currentUser.uid,
        type: "delete",
        templateId,
      });
    },
    [currentUser, submit, updateLocal],
  );

  useEffect(() => {
    publicRemoteRef.current = [];
    privateRemoteRef.current = [];
    updateLocal(readCachedTemplates(currentUser));

    if (!isFirebaseConfigured()) {
      if (
        !readCachedTemplates(currentUser).length &&
        !localStorage.getItem(INITIALIZED_KEY)
      ) {
        const defaults = defaultTemplates(currentUser);
        updateLocal(defaults);
        localStorage.setItem(INITIALIZED_KEY, "1");
      }
      return () => undefined;
    }

    let unsubscribePublic: Unsubscribe | undefined;
    let unsubscribePrivate: Unsubscribe | undefined;
    let unsubscribeConnection: Unsubscribe | undefined;
    let disposed = false;

    const refreshFromRemote = () => {
      if (disposed) return;
      const pending = readPending(currentUser).filter(
        (operation) => operation.actorUserId === currentUser.uid,
      );
      updateLocal(
        mergePending(
          [...publicRemoteRef.current, ...privateRemoteRef.current],
          pending,
          currentUser,
        ),
      );
    };

    const connect = async () => {
      try {
        const { auth, database } = getAuthenticatedFirebaseServices();
        if (auth.currentUser?.uid !== currentUser.uid) return;

        unsubscribeConnection = onValue(
          ref(database, ".info/connected"),
          (snapshot) => {
            const connected = snapshot.val() === true;
            if (!disposed) setFirebaseConnected(connected);
          },
        );

        unsubscribePublic = onValue(
          ref(database, "taskTemplates/items"),
          (snapshot) => {
            if (disposed) return;
            publicRemoteRef.current = recordToTemplates(
              snapshot.val(),
              currentUser,
              false,
            );
            refreshFromRemote();
          },
        );

        unsubscribePrivate = onValue(
          ref(database, `privateTaskTemplates/${currentUser.uid}/items`),
          (snapshot) => {
            if (disposed) return;
            privateRemoteRef.current = recordToTemplates(
              snapshot.val(),
              currentUser,
              true,
            );
            refreshFromRemote();
          },
        );

        const initializedSnapshot = await get(
          ref(database, "taskTemplates/initialized"),
        );
        if (!initializedSnapshot.exists()) {
          const defaults = defaultTemplates(currentUser);
          for (const template of defaults) {
            await set(
              ref(database, `taskTemplates/items/${template.id}`),
              stripUndefined(template),
            );
          }
          await set(ref(database, "taskTemplates/initialized"), true);
          localStorage.setItem(INITIALIZED_KEY, "1");
        }
      } catch {
        setFirebaseConnected(false);
      }
    };

    void connect();
    return () => {
      disposed = true;
      unsubscribePublic?.();
      unsubscribePrivate?.();
      unsubscribeConnection?.();
    };
  }, [currentUser, updateLocal]);

  useEffect(() => {
    if (firebaseConnected) void retrySync();
  }, [firebaseConnected, retrySync]);

  return {
    templates,
    pendingCount,
    saveTemplate,
    deleteTemplate,
    retrySync,
  };
};
