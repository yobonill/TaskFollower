import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { onValue, ref, remove, set, type Unsubscribe } from "firebase/database";
import { APP_USERS, getAppUserByName, type AppUserDefinition } from "../config/appUsers";
import { isFirebaseConfigured } from "../config/firebaseConfig";
import type {
  PapipointsProfile,
  PapipointsReward,
  PapipointsTransaction,
} from "../models/gamification";
import type { Task } from "../models/task";
import { isTaskOverdue } from "../utils/taskDates";
import { getAuthenticatedFirebaseServices } from "../services/firebase";
import {
  COMPLETION_POINTS,
  EARLY_COMPLETION_BONUS,
  OVERDUE_PENALTY,
  TASK_CREATION_POINTS,
  getLevelFromPapipoints,
  getPapipointsBalance,
  getPapipointsProfile,
  isCompletedEarly,
  isEligibleForOverduePenalty,
} from "../utils/papipoints";

const TRANSACTIONS_CACHE_KEY = "taskFollower.papipoints.transactions.v1";
const REWARDS_CACHE_KEY = "taskFollower.papipoints.rewards.v1";
const PENDING_KEY = "taskFollower.papipoints.pending.v1";

const defaultRewards = (createdByUserId: string): PapipointsReward[] => {
  const timestamp = new Date().toISOString();
  return [
    {
      id: "reward-movie",
      name: "Elegir la película",
      description: "Elige la próxima película para ver juntos.",
      cost: 50,
      active: true,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdByUserId,
    },
    {
      id: "reward-dinner",
      name: "Elegir la cena",
      description: "Elige qué se preparará o comprará para la cena.",
      cost: 80,
      active: true,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdByUserId,
    },
    {
      id: "reward-free-hour",
      name: "Una hora libre",
      description: "Canjea una hora libre acordada entre ambos.",
      cost: 100,
      active: true,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdByUserId,
    },
  ];
};

type PendingOperation =
  | {
      id: string;
      actorUserId: string;
      type: "upsertTransaction";
      transaction: PapipointsTransaction;
    }
  | {
      id: string;
      actorUserId: string;
      type: "deleteTransaction";
      transactionId: string;
    }
  | {
      id: string;
      actorUserId: string;
      type: "upsertReward";
      reward: PapipointsReward;
    }
  | {
      id: string;
      actorUserId: string;
      type: "deleteReward";
      rewardId: string;
    };

const stripUndefined = <T,>(value: T): T =>
  JSON.parse(JSON.stringify(value)) as T;

const readJsonArray = <T,>(key: string): T[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]") as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
};

const readCachedTransactions = (): PapipointsTransaction[] =>
  readJsonArray<PapipointsTransaction>(TRANSACTIONS_CACHE_KEY);

const readCachedRewards = (): PapipointsReward[] =>
  readJsonArray<PapipointsReward>(REWARDS_CACHE_KEY);

const readPendingOperations = (): PendingOperation[] =>
  readJsonArray<PendingOperation>(PENDING_KEY);

const storeTransactions = (transactions: PapipointsTransaction[]): void =>
  localStorage.setItem(TRANSACTIONS_CACHE_KEY, JSON.stringify(transactions));

const storeRewards = (rewards: PapipointsReward[]): void =>
  localStorage.setItem(REWARDS_CACHE_KEY, JSON.stringify(rewards));

const storePendingOperations = (operations: PendingOperation[]): void =>
  localStorage.setItem(PENDING_KEY, JSON.stringify(operations));

const recordToArray = <T extends { id: string }>(value: unknown): T[] => {
  if (!value || typeof value !== "object") return [];
  return Object.values(value as Record<string, T>).filter(
    (item): item is T => Boolean(item?.id),
  );
};

const mergeTransactionsWithPending = (
  remote: PapipointsTransaction[],
  operations: PendingOperation[],
): PapipointsTransaction[] => {
  const map = new Map(remote.map((item) => [item.id, item]));
  for (const operation of operations) {
    if (operation.type === "upsertTransaction") {
      map.set(operation.transaction.id, operation.transaction);
    } else if (operation.type === "deleteTransaction") {
      map.delete(operation.transactionId);
    }
  }
  return [...map.values()];
};

const mergeRewardsWithPending = (
  remote: PapipointsReward[],
  operations: PendingOperation[],
): PapipointsReward[] => {
  const map = new Map(remote.map((item) => [item.id, item]));
  for (const operation of operations) {
    if (operation.type === "upsertReward") {
      map.set(operation.reward.id, operation.reward);
    } else if (operation.type === "deleteReward") {
      map.delete(operation.rewardId);
    }
  }
  return [...map.values()];
};

export interface RedeemResult {
  ok: boolean;
  message: string;
  previousLevel?: number;
  nextLevel?: number;
}

export interface UsePapipointsResult {
  transactions: PapipointsTransaction[];
  rewards: PapipointsReward[];
  profiles: Record<"Yisel" | "Yorki", PapipointsProfile>;
  pendingCount: number;
  awardTaskCreation: (task: Task) => Promise<number>;
  removeTaskCreationReward: (taskId: string) => Promise<number>;
  awardTaskCompletion: (
    task: Task,
    completedAt: string,
    completedBy: AppUserDefinition,
  ) => Promise<number>;
  removeTaskCompletionRewards: (taskId: string) => Promise<number>;
  removeAllTaskTransactions: (taskId: string) => Promise<number>;
  applyOverduePenalty: (task: Task, force?: boolean) => Promise<number>;
  saveReward: (reward: PapipointsReward) => Promise<void>;
  deleteReward: (rewardId: string) => Promise<void>;
  redeemReward: (reward: PapipointsReward) => Promise<RedeemResult>;
  retrySync: () => Promise<void>;
}

export const usePapipoints = (
  currentUser: AppUserDefinition,
): UsePapipointsResult => {
  const [transactions, setTransactions] = useState<PapipointsTransaction[]>(
    readCachedTransactions,
  );
  const [rewards, setRewards] = useState<PapipointsReward[]>(readCachedRewards);
  const [pendingCount, setPendingCount] = useState(readPendingOperations().length);
  const mountedRef = useRef(true);
  const firebaseConnectedRef = useRef(false);
  const defaultsInitializedRef = useRef(false);

  const updateTransactions = useCallback((next: PapipointsTransaction[]) => {
    const sorted = [...next].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    setTransactions(sorted);
    storeTransactions(sorted);
  }, []);

  const updateRewards = useCallback((next: PapipointsReward[]) => {
    const sorted = [...next].sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
    setRewards(sorted);
    storeRewards(sorted);
  }, []);

  const queueOperation = useCallback((operation: PendingOperation) => {
    const current = readPendingOperations();
    const next = [...current.filter((item) => item.id !== operation.id), operation];
    storePendingOperations(next);
    setPendingCount(next.length);
  }, []);

  const removePendingOperation = useCallback((operationId: string) => {
    const next = readPendingOperations().filter((item) => item.id !== operationId);
    storePendingOperations(next);
    setPendingCount(next.length);
  }, []);

  const executeOperation = useCallback(
    async (operation: PendingOperation): Promise<boolean> => {
      if (
        !isFirebaseConfigured() ||
        !navigator.onLine ||
        !firebaseConnectedRef.current ||
        operation.actorUserId !== currentUser.uid
      ) {
        return false;
      }

      try {
        const { auth, database } = getAuthenticatedFirebaseServices();
        if (auth.currentUser?.uid !== currentUser.uid) return false;

        if (operation.type === "upsertTransaction") {
          await set(
            ref(database, `papipoints/transactions/${operation.transaction.id}`),
            stripUndefined(operation.transaction),
          );
        } else if (operation.type === "deleteTransaction") {
          await remove(
            ref(database, `papipoints/transactions/${operation.transactionId}`),
          );
        } else if (operation.type === "upsertReward") {
          await set(
            ref(database, `papipoints/rewards/${operation.reward.id}`),
            stripUndefined(operation.reward),
          );
        } else {
          await remove(ref(database, `papipoints/rewards/${operation.rewardId}`));
        }

        removePendingOperation(operation.id);
        return true;
      } catch {
        return false;
      }
    },
    [currentUser.uid, removePendingOperation],
  );

  const submitOperation = useCallback(
    (operation: PendingOperation) => {
      queueOperation(operation);
      if (
        isFirebaseConfigured() &&
        navigator.onLine &&
        firebaseConnectedRef.current
      ) {
        void executeOperation(operation);
      }
    },
    [executeOperation, queueOperation],
  );

  const retrySync = useCallback(async () => {
    if (!navigator.onLine || !firebaseConnectedRef.current) return;
    const eligible = readPendingOperations().filter(
      (operation) => operation.actorUserId === currentUser.uid,
    );
    for (const operation of eligible) {
      const succeeded = await executeOperation(operation);
      if (!succeeded) break;
    }
  }, [currentUser.uid, executeOperation]);

  const upsertTransaction = useCallback(
    async (transaction: PapipointsTransaction): Promise<boolean> => {
      const current = readCachedTransactions();
      if (current.some((item) => item.id === transaction.id)) return false;
      updateTransactions([...current, transaction]);
      submitOperation({
        id: `transaction-upsert:${transaction.id}`,
        actorUserId: currentUser.uid,
        type: "upsertTransaction",
        transaction,
      });
      return true;
    },
    [currentUser.uid, submitOperation, updateTransactions],
  );

  const deleteTransaction = useCallback(
    async (transactionId: string): Promise<void> => {
      const current = readCachedTransactions();
      if (!current.some((item) => item.id === transactionId)) return;
      updateTransactions(current.filter((item) => item.id !== transactionId));
      submitOperation({
        id: `transaction-delete:${transactionId}`,
        actorUserId: currentUser.uid,
        type: "deleteTransaction",
        transactionId,
      });
    },
    [currentUser.uid, submitOperation, updateTransactions],
  );

  const awardTaskCreation = useCallback(
    async (task: Task): Promise<number> => {
      if (task.source !== "manual") return 0;
      const transaction: PapipointsTransaction = {
        id: `task-created:${task.id}`,
        userId: currentUser.uid,
        userName: currentUser.name,
        amount: TASK_CREATION_POINTS,
        type: "task_created",
        description: `Tarea creada: ${task.name}`,
        taskId: task.id,
        createdAt: new Date().toISOString(),
        createdByUserId: currentUser.uid,
      };
      return (await upsertTransaction(transaction)) ? TASK_CREATION_POINTS : 0;
    },
    [currentUser, upsertTransaction],
  );

  const removeTaskCreationReward = useCallback(
    async (taskId: string): Promise<number> => {
      const transaction = readCachedTransactions().find(
        (item) => item.id === `task-created:${taskId}`,
      );
      await deleteTransaction(`task-created:${taskId}`);
      return transaction ? -transaction.amount : 0;
    },
    [deleteTransaction],
  );

  const awardTaskCompletion = useCallback(
    async (
      task: Task,
      completedAt: string,
      completedBy: AppUserDefinition,
    ): Promise<number> => {
      if (!task.priority) return 0;
      let awarded = 0;
      const base = COMPLETION_POINTS[task.priority];
      const completionAdded = await upsertTransaction({
        id: `task-completed:${task.id}`,
        userId: completedBy.uid,
        userName: completedBy.name,
        amount: base,
        type: "task_completed",
        description: `Tarea completada: ${task.name}`,
        taskId: task.id,
        createdAt: completedAt,
        createdByUserId: currentUser.uid,
      });
      if (completionAdded) awarded += base;

      if (isCompletedEarly(task, completedAt)) {
        const bonus = EARLY_COMPLETION_BONUS[task.priority];
        const earlyAdded = await upsertTransaction({
          id: `task-early:${task.id}`,
          userId: completedBy.uid,
          userName: completedBy.name,
          amount: bonus,
          type: "task_early",
          description: `Tarea completada antes de tiempo: ${task.name}`,
          taskId: task.id,
          createdAt: completedAt,
          createdByUserId: currentUser.uid,
        });
        if (earlyAdded) awarded += bonus;
      }

      return awarded;
    },
    [currentUser.uid, upsertTransaction],
  );

  const removeTaskCompletionRewards = useCallback(
    async (taskId: string): Promise<number> => {
      const existing = readCachedTransactions().filter(
        (item) =>
          item.id === `task-completed:${taskId}` ||
          item.id === `task-early:${taskId}`,
      );
      await deleteTransaction(`task-completed:${taskId}`);
      await deleteTransaction(`task-early:${taskId}`);
      return -existing.reduce((total, item) => total + item.amount, 0);
    },
    [deleteTransaction],
  );

  const removeAllTaskTransactions = useCallback(
    async (taskId: string): Promise<number> => {
      const existing = readCachedTransactions().filter(
        (item) => item.taskId === taskId,
      );
      for (const transaction of existing) {
        await deleteTransaction(transaction.id);
      }
      return -existing.reduce((total, item) => total + item.amount, 0);
    },
    [deleteTransaction],
  );

  const applyOverduePenalty = useCallback(
    async (task: Task, force = false): Promise<number> => {
      if (!task.priority) return 0;
      if (force ? !isTaskOverdue(task) : !isEligibleForOverduePenalty(task)) return 0;
      const transactionId = `task-overdue:${task.id}`;
      if (readCachedTransactions().some((item) => item.id === transactionId)) {
        return 0;
      }

      const assignee = getAppUserByName(task.assignedTo);
      const balance = getPapipointsBalance(readCachedTransactions(), assignee.uid);
      const penalty = Math.min(OVERDUE_PENALTY[task.priority], balance);

      const added = await upsertTransaction({
        id: transactionId,
        userId: assignee.uid,
        userName: assignee.name,
        amount: -penalty,
        type: "task_overdue",
        description: `Tarea vencida: ${task.name}`,
        taskId: task.id,
        createdAt: new Date().toISOString(),
        createdByUserId: currentUser.uid,
      });
      return added ? -penalty : 0;
    },
    [currentUser.uid, upsertTransaction],
  );

  const saveReward = useCallback(
    async (reward: PapipointsReward) => {
      const current = readCachedRewards();
      const next = current.some((item) => item.id === reward.id)
        ? current.map((item) => (item.id === reward.id ? reward : item))
        : [...current, reward];
      updateRewards(next);
      submitOperation({
        id: `reward-upsert:${reward.id}`,
        actorUserId: currentUser.uid,
        type: "upsertReward",
        reward,
      });
    },
    [currentUser.uid, submitOperation, updateRewards],
  );

  const deleteReward = useCallback(
    async (rewardId: string) => {
      updateRewards(readCachedRewards().filter((item) => item.id !== rewardId));
      submitOperation({
        id: `reward-delete:${rewardId}`,
        actorUserId: currentUser.uid,
        type: "deleteReward",
        rewardId,
      });
    },
    [currentUser.uid, submitOperation, updateRewards],
  );

  const redeemReward = useCallback(
    async (reward: PapipointsReward): Promise<RedeemResult> => {
      const currentTransactions = readCachedTransactions();
      const balance = getPapipointsBalance(currentTransactions, currentUser.uid);
      if (!reward.active) return { ok: false, message: "Esta recompensa no está disponible." };
      if (balance < reward.cost) {
        return {
          ok: false,
          message: `Necesitas ${reward.cost - balance} Papipuntos adicionales.`,
        };
      }

      const previousLevel = getLevelFromPapipoints(balance);
      const nextLevel = getLevelFromPapipoints(balance - reward.cost);
      const redemptionId = crypto.randomUUID();
      const added = await upsertTransaction({
        id: `reward-redeemed:${redemptionId}`,
        userId: currentUser.uid,
        userName: currentUser.name,
        amount: -reward.cost,
        type: "reward_redeemed",
        description: `Recompensa canjeada: ${reward.name}`,
        rewardId: reward.id,
        createdAt: new Date().toISOString(),
        createdByUserId: currentUser.uid,
      });

      return added
        ? {
            ok: true,
            message: `Canjeaste “${reward.name}” por ${reward.cost} Papipuntos.`,
            previousLevel,
            nextLevel,
          }
        : { ok: false, message: "No se pudo registrar el canje." };
    },
    [currentUser, upsertTransaction],
  );

  useEffect(() => {
    mountedRef.current = true;
    defaultsInitializedRef.current = false;
    if (!isFirebaseConfigured()) return () => undefined;

    let unsubscribeTransactions: Unsubscribe | undefined;
    let unsubscribeRewards: Unsubscribe | undefined;
    let unsubscribeConnection: Unsubscribe | undefined;

    try {
      const { auth, database } = getAuthenticatedFirebaseServices();
      if (auth.currentUser?.uid !== currentUser.uid) return () => undefined;

      unsubscribeConnection = onValue(ref(database, ".info/connected"), (snapshot) => {
        firebaseConnectedRef.current = snapshot.val() === true;
        if (firebaseConnectedRef.current) void retrySync();
      });

      unsubscribeTransactions = onValue(
        ref(database, "papipoints/transactions"),
        (snapshot) => {
          if (!mountedRef.current) return;
          updateTransactions(
            mergeTransactionsWithPending(
              recordToArray<PapipointsTransaction>(snapshot.val()),
              readPendingOperations(),
            ),
          );
        },
      );

      unsubscribeRewards = onValue(
        ref(database, "papipoints/rewards"),
        (snapshot) => {
          if (!mountedRef.current) return;
          const remote = recordToArray<PapipointsReward>(snapshot.val());
          const merged = mergeRewardsWithPending(remote, readPendingOperations());
          updateRewards(merged);

          if (!remote.length && !merged.length && !defaultsInitializedRef.current) {
            defaultsInitializedRef.current = true;
            for (const reward of defaultRewards(currentUser.uid)) {
              void saveReward(reward);
            }
          }
        },
      );
    } catch {
      firebaseConnectedRef.current = false;
    }

    return () => {
      mountedRef.current = false;
      firebaseConnectedRef.current = false;
      unsubscribeTransactions?.();
      unsubscribeRewards?.();
      unsubscribeConnection?.();
    };
  }, [currentUser.uid, retrySync, saveReward, updateRewards, updateTransactions]);

  const profiles = useMemo(
    () =>
      Object.fromEntries(
        APP_USERS.map((user) => [
          user.name,
          getPapipointsProfile(transactions, user.uid, user.name),
        ]),
      ) as Record<"Yisel" | "Yorki", PapipointsProfile>,
    [transactions],
  );

  return {
    transactions,
    rewards,
    profiles,
    pendingCount,
    awardTaskCreation,
    removeTaskCreationReward,
    awardTaskCompletion,
    removeTaskCompletionRewards,
    removeAllTaskTransactions,
    applyOverduePenalty,
    saveReward,
    deleteReward,
    redeemReward,
    retrySync,
  };
};
