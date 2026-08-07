import { useCallback, useEffect, useState } from "react";
import { get, onValue, ref, remove, set, type Unsubscribe } from "firebase/database";
import type { AppUserDefinition } from "../config/appUsers";
import { isFirebaseConfigured } from "../config/firebaseConfig";
import type { TaskTemplate } from "../models/template";
import { getAuthenticatedFirebaseServices } from "../services/firebase";

const CACHE_KEY = "taskFollower.templates.v1";
const PENDING_KEY = "taskFollower.templates.pending.v1";
const INITIALIZED_KEY = "taskFollower.templates.defaultsInitialized.v1";

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

const defaultTemplates = (createdByUserId: string): TaskTemplate[] => {
  const timestamp = new Date().toISOString();
  return [
    {
      id: "template-clean-house",
      name: "Limpiar la casa",
      description: "",
      estimatedMinutes: 60,
      priority: "normal",
      createdAt: timestamp,
      updatedAt: timestamp,
      createdByUserId,
    },
    {
      id: "template-groceries",
      name: "Comprar en el supermercado",
      description: "",
      estimatedMinutes: 45,
      priority: "normal",
      createdAt: timestamp,
      updatedAt: timestamp,
      createdByUserId,
    },
    {
      id: "template-bill",
      name: "Pagar factura",
      description: "",
      estimatedMinutes: 10,
      priority: "high",
      createdAt: timestamp,
      updatedAt: timestamp,
      createdByUserId,
    },
    {
      id: "template-trash",
      name: "Sacar la basura",
      description: "",
      estimatedMinutes: 10,
      priority: "normal",
      createdAt: timestamp,
      updatedAt: timestamp,
      createdByUserId,
    },
    {
      id: "template-laundry",
      name: "Lavar la ropa",
      description: "",
      estimatedMinutes: 15,
      priority: "normal",
      createdAt: timestamp,
      updatedAt: timestamp,
      createdByUserId,
    },
  ];
};

const readArray = <T,>(key: string): T[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]") as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
};

const readCachedTemplates = (): TaskTemplate[] => readArray<TaskTemplate>(CACHE_KEY);
const readPending = (): PendingOperation[] => readArray<PendingOperation>(PENDING_KEY);

const storeTemplates = (templates: TaskTemplate[]): void => {
  localStorage.setItem(CACHE_KEY, JSON.stringify(templates));
};

const storePending = (operations: PendingOperation[]): void => {
  localStorage.setItem(PENDING_KEY, JSON.stringify(operations));
};

const stripUndefined = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const recordToTemplates = (value: unknown): TaskTemplate[] => {
  if (!value || typeof value !== "object") return [];
  return Object.values(value as Record<string, TaskTemplate>).filter(
    (item): item is TaskTemplate => Boolean(item?.id && item.name),
  );
};

const mergePending = (
  remote: TaskTemplate[],
  operations: PendingOperation[],
): TaskTemplate[] => {
  const map = new Map(remote.map((template) => [template.id, template]));
  for (const operation of operations) {
    if (operation.type === "upsert") map.set(operation.template.id, operation.template);
    else map.delete(operation.templateId);
  }
  return [...map.values()];
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
  const [templates, setTemplates] = useState<TaskTemplate[]>(readCachedTemplates);
  const [pendingCount, setPendingCount] = useState(readPending().length);
  const [firebaseConnected, setFirebaseConnected] = useState(false);

  const updateLocal = useCallback((next: TaskTemplate[]) => {
    const sorted = [...next].sort((a, b) => a.name.localeCompare(b.name, "es"));
    setTemplates(sorted);
    storeTemplates(sorted);
  }, []);

  const queueOperation = useCallback((operation: PendingOperation) => {
    const next = [...readPending().filter((item) => item.id !== operation.id), operation];
    storePending(next);
    setPendingCount(next.length);
  }, []);

  const removePending = useCallback((operationId: string) => {
    const next = readPending().filter((item) => item.id !== operationId);
    storePending(next);
    setPendingCount(next.length);
  }, []);

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
          await set(
            ref(database, `taskTemplates/items/${operation.template.id}`),
            stripUndefined(operation.template),
          );
        } else {
          await remove(ref(database, `taskTemplates/items/${operation.templateId}`));
        }
        removePending(operation.id);
        return true;
      } catch {
        return false;
      }
    },
    [currentUser.uid, firebaseConnected, removePending],
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
    const eligible = readPending().filter(
      (operation) => operation.actorUserId === currentUser.uid,
    );
    for (const operation of eligible) {
      const succeeded = await execute(operation);
      if (!succeeded) break;
    }
  }, [currentUser.uid, execute, firebaseConnected]);

  const saveTemplate = useCallback(
    async (template: TaskTemplate) => {
      const current = readCachedTemplates();
      const next = current.some((item) => item.id === template.id)
        ? current.map((item) => (item.id === template.id ? template : item))
        : [...current, template];
      updateLocal(next);
      submit({
        id: `template-upsert:${template.id}`,
        actorUserId: currentUser.uid,
        type: "upsert",
        template,
      });
    },
    [currentUser.uid, submit, updateLocal],
  );

  const deleteTemplate = useCallback(
    async (templateId: string) => {
      updateLocal(readCachedTemplates().filter((item) => item.id !== templateId));
      submit({
        id: `template-delete:${templateId}`,
        actorUserId: currentUser.uid,
        type: "delete",
        templateId,
      });
    },
    [currentUser.uid, submit, updateLocal],
  );

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      if (!readCachedTemplates().length && !localStorage.getItem(INITIALIZED_KEY)) {
        const defaults = defaultTemplates(currentUser.uid);
        updateLocal(defaults);
        localStorage.setItem(INITIALIZED_KEY, "1");
      }
      return () => undefined;
    }

    let unsubscribeTemplates: Unsubscribe | undefined;
    let unsubscribeConnection: Unsubscribe | undefined;
    let disposed = false;

    const connect = async () => {
      try {
        const { auth, database } = getAuthenticatedFirebaseServices();
        if (auth.currentUser?.uid !== currentUser.uid) return;

        unsubscribeConnection = onValue(ref(database, ".info/connected"), (snapshot) => {
          const connected = snapshot.val() === true;
          if (!disposed) setFirebaseConnected(connected);
        });

        unsubscribeTemplates = onValue(ref(database, "taskTemplates/items"), (snapshot) => {
          if (disposed) return;
          updateLocal(mergePending(recordToTemplates(snapshot.val()), readPending()));
        });

        const initializedSnapshot = await get(ref(database, "taskTemplates/initialized"));
        if (!initializedSnapshot.exists()) {
          const defaults = defaultTemplates(currentUser.uid);
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
      unsubscribeTemplates?.();
      unsubscribeConnection?.();
    };
  }, [currentUser.uid, updateLocal]);

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
