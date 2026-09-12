import { useCallback, useEffect, useState } from "react";
import { onValue, ref, remove, set, type Unsubscribe } from "firebase/database";
import type { AppUserDefinition } from "../config/appUsers";
import { isFirebaseConfigured } from "../config/firebaseConfig";
import type { DependencyChain } from "../models/dependency";
import { getAuthenticatedFirebaseServices } from "../services/firebase";

const CACHE_KEY = "taskFollower.dependencyChains.v1";
const PENDING_KEY = "taskFollower.dependencyChains.pending.v1";

type PendingOperation =
  | { id: string; actorUserId: string; type: "upsert"; chain: DependencyChain }
  | { id: string; actorUserId: string; type: "delete"; chainId: string };

const readArray = <T,>(key: string): T[] => {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]") as unknown;
    return Array.isArray(value) ? value as T[] : [];
  } catch {
    return [];
  }
};

const storeChains = (chains: DependencyChain[]) =>
  localStorage.setItem(CACHE_KEY, JSON.stringify(chains));
const storePending = (operations: PendingOperation[]) =>
  localStorage.setItem(PENDING_KEY, JSON.stringify(operations));
const stripUndefined = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const recordToChains = (value: unknown): DependencyChain[] =>
  value && typeof value === "object"
    ? Object.values(value as Record<string, DependencyChain>).filter(
        (chain) => Boolean(chain?.id && chain?.name && chain.steps?.length >= 2),
      )
    : [];

const mergePending = (remote: DependencyChain[], operations: PendingOperation[], userId: string) => {
  const map = new Map(remote.map((chain) => [chain.id, chain]));
  operations.forEach((operation) => {
    if (operation.actorUserId !== userId) return;
    if (operation.type === "upsert") map.set(operation.chain.id, operation.chain);
    else map.delete(operation.chainId);
  });
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
};

export function useDependencyChains(currentUser: AppUserDefinition) {
  const [chains, setChains] = useState<DependencyChain[]>(() => readArray(CACHE_KEY));
  const [pendingCount, setPendingCount] = useState(() => readArray(PENDING_KEY).length);
  const [connected, setConnected] = useState(false);

  const updateLocal = useCallback((next: DependencyChain[]) => {
    const sorted = [...next].sort((a, b) => a.name.localeCompare(b.name, "es"));
    setChains(sorted);
    storeChains(sorted);
  }, []);

  const execute = useCallback(async (operation: PendingOperation) => {
    if (!isFirebaseConfigured() || !navigator.onLine || !connected) return false;
    try {
      const { auth, database } = getAuthenticatedFirebaseServices();
      if (auth.currentUser?.uid !== currentUser.uid) return false;
      if (operation.type === "upsert") {
        await set(ref(database, `dependencyChains/${operation.chain.id}`), stripUndefined(operation.chain));
      } else {
        await remove(ref(database, `dependencyChains/${operation.chainId}`));
      }
      const pending = readArray<PendingOperation>(PENDING_KEY).filter((item) => item.id !== operation.id);
      storePending(pending);
      setPendingCount(pending.length);
      return true;
    } catch {
      return false;
    }
  }, [connected, currentUser.uid]);

  const submit = useCallback((operation: PendingOperation) => {
    const pending = [...readArray<PendingOperation>(PENDING_KEY).filter((item) => item.id !== operation.id), operation];
    storePending(pending);
    setPendingCount(pending.length);
    void execute(operation);
  }, [execute]);

  const retrySync = useCallback(async () => {
    for (const operation of readArray<PendingOperation>(PENDING_KEY)) {
      if (operation.actorUserId === currentUser.uid && !(await execute(operation))) break;
    }
  }, [currentUser.uid, execute]);

  const saveChain = useCallback(async (chain: DependencyChain) => {
    const current = readArray<DependencyChain>(CACHE_KEY);
    updateLocal(current.some((item) => item.id === chain.id)
      ? current.map((item) => item.id === chain.id ? chain : item)
      : [...current, chain]);
    submit({ id: `upsert:${chain.id}`, actorUserId: currentUser.uid, type: "upsert", chain });
  }, [currentUser.uid, submit, updateLocal]);

  const deleteChain = useCallback(async (chainId: string) => {
    updateLocal(readArray<DependencyChain>(CACHE_KEY).filter((chain) => chain.id !== chainId));
    submit({ id: `delete:${chainId}`, actorUserId: currentUser.uid, type: "delete", chainId });
  }, [currentUser.uid, submit, updateLocal]);

  useEffect(() => {
    if (!isFirebaseConfigured()) return;
    const { database } = getAuthenticatedFirebaseServices();
    let unsubscribe: Unsubscribe | undefined;
    unsubscribe = onValue(ref(database, "dependencyChains"), (snapshot) => {
      setConnected(true);
      const next = mergePending(recordToChains(snapshot.val()), readArray(PENDING_KEY), currentUser.uid);
      updateLocal(next);
      void retrySync();
    }, () => setConnected(false));
    return () => unsubscribe?.();
  }, [currentUser.uid, retrySync, updateLocal]);

  return { chains, pendingCount, saveChain, deleteChain, retrySync };
}
