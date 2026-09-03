import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  get,
  onValue,
  ref,
  remove,
  runTransaction,
  set,
  update,
  type Unsubscribe,
} from "firebase/database";
import {
  APP_USERS,
  getAppUserByUid,
  getOtherAppUser,
  type AppUserDefinition,
} from "../config/appUsers";
import { isFirebaseConfigured } from "../config/firebaseConfig";
import type {
  PapipointsProfile,
  PapipointsReward,
  PapipointsRewardClaim,
  PapipointsTaskResolution,
  PapipointsTransaction,
  RewardPenaltySettlement,
} from "../models/gamification";
import type { Task, UserName } from "../models/task";
import { getAuthenticatedFirebaseServices } from "../services/firebase";
import { getTaskAssigneeUsers } from "../utils/taskAssignment";
import { getTaskDate, isTaskOverdue, isTaskOverdueAt } from "../utils/taskDates";
import {
  COMPLETION_POINTS,
  EARLY_COMPLETION_BONUS,
  OVERDUE_PENALTY,
  TASK_CREATION_POINTS,
  getLevelFromPapipoints,
  getPapipointsBalance,
  getPapipointsProfile,
  getPenaltyTaskAccruedHours,
  isCompletedEarly,
  isEligibleForOverduePenalty,
  isEligibleForOverduePenaltyAt,
  PENALTY_TASK_POINTS_PER_HOUR,
} from "../utils/papipoints";

const TRANSACTIONS_CACHE_KEY = "taskFollower.papipoints.transactions.v1";
const REWARDS_CACHE_KEY = "taskFollower.papipoints.rewards.v1";
const REWARD_CLAIMS_CACHE_KEY = "taskFollower.papipoints.rewardClaims.v1";
const RESOLUTIONS_CACHE_KEY = "taskFollower.papipoints.taskResolutions.v1";
const PENDING_KEY = "taskFollower.papipoints.pending.v1";

export const REWARD_OVERDUE_TRANSFER_PERCENT = 10;
export const REWARD_CANCEL_REFUND_PERCENT = 70;

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
    }
  | {
      id: string;
      actorUserId: string;
      type: "upsertRewardClaim";
      claim: PapipointsRewardClaim;
    }
  | {
      id: string;
      actorUserId: string;
      type: "redeemReward";
      claim: PapipointsRewardClaim;
      transaction: PapipointsTransaction;
    }
  | {
      id: string;
      actorUserId: string;
      type: "settleRewardPenalty";
      settlement: RewardPenaltySettlement;
      transactions: PapipointsTransaction[];
    }
  | {
      id: string;
      actorUserId: string;
      type: "cancelRewardClaim";
      claim: PapipointsRewardClaim;
      refundTransaction: PapipointsTransaction;
    }
  | {
      id: string;
      actorUserId: string;
      type: "resolveTaskOutcome";
      resolution: PapipointsTaskResolution;
      transactions: PapipointsTransaction[];
    }
  | {
      id: string;
      actorUserId: string;
      type: "deleteTaskOutcome";
      taskId: string;
      claimId?: string;
      transactionIds: string[];
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

const readCachedRewardClaims = (): PapipointsRewardClaim[] =>
  readJsonArray<PapipointsRewardClaim>(REWARD_CLAIMS_CACHE_KEY);

const readCachedResolutions = (): PapipointsTaskResolution[] =>
  readJsonArray<PapipointsTaskResolution>(RESOLUTIONS_CACHE_KEY);

const readPendingOperations = (): PendingOperation[] =>
  readJsonArray<PendingOperation>(PENDING_KEY);

const storeTransactions = (transactions: PapipointsTransaction[]): void =>
  localStorage.setItem(TRANSACTIONS_CACHE_KEY, JSON.stringify(transactions));

const storeRewards = (rewards: PapipointsReward[]): void =>
  localStorage.setItem(REWARDS_CACHE_KEY, JSON.stringify(rewards));

const storeRewardClaims = (claims: PapipointsRewardClaim[]): void =>
  localStorage.setItem(REWARD_CLAIMS_CACHE_KEY, JSON.stringify(claims));

const storeResolutions = (resolutions: PapipointsTaskResolution[]): void =>
  localStorage.setItem(RESOLUTIONS_CACHE_KEY, JSON.stringify(resolutions));

const storePendingOperations = (operations: PendingOperation[]): void =>
  localStorage.setItem(PENDING_KEY, JSON.stringify(operations));

const recordToArray = <T extends { id?: string }>(value: unknown): T[] => {
  if (!value || typeof value !== "object") return [];
  return Object.values(value as Record<string, T>).filter(Boolean);
};

const recordToResolutions = (value: unknown): PapipointsTaskResolution[] => {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, PapipointsTaskResolution>)
    .filter(([, item]) => Boolean(item?.taskId))
    .map(([taskId, item]) => ({ ...item, taskId: item.taskId || taskId }));
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
    } else if (operation.type === "resolveTaskOutcome") {
      for (const transaction of operation.transactions) {
        map.set(transaction.id, transaction);
      }
    } else if (operation.type === "deleteTaskOutcome") {
      for (const transactionId of operation.transactionIds) {
        map.delete(transactionId);
      }
    } else if (operation.type === "redeemReward") {
      map.set(operation.transaction.id, operation.transaction);
    } else if (operation.type === "settleRewardPenalty") {
      for (const transaction of operation.transactions) {
        map.set(transaction.id, transaction);
      }
    } else if (operation.type === "cancelRewardClaim") {
      map.set(operation.refundTransaction.id, operation.refundTransaction);
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

const mergeRewardClaimsWithPending = (
  remote: PapipointsRewardClaim[],
  operations: PendingOperation[],
): PapipointsRewardClaim[] => {
  const map = new Map(remote.map((item) => [item.id, item]));
  for (const operation of operations) {
    if (operation.type === "upsertRewardClaim") {
      map.set(operation.claim.id, operation.claim);
    } else if (operation.type === "redeemReward") {
      map.set(operation.claim.id, operation.claim);
    } else if (operation.type === "cancelRewardClaim") {
      map.set(operation.claim.id, operation.claim);
    }
  }
  return [...map.values()];
};

const mergeResolutionsWithPending = (
  remote: PapipointsTaskResolution[],
  operations: PendingOperation[],
): PapipointsTaskResolution[] => {
  const map = new Map(remote.map((item) => [item.taskId, item]));
  for (const operation of operations) {
    if (operation.type === "resolveTaskOutcome") {
      map.set(operation.resolution.taskId, operation.resolution);
    } else if (operation.type === "deleteTaskOutcome") {
      map.delete(operation.taskId);
    }
  }
  return [...map.values()];
};

const getLegacyTaskOutcome = (
  taskId: string,
  transactions: PapipointsTransaction[],
): PapipointsTaskResolution | null => {
  // Only positive legacy task outcomes reserve the completion reward.
  // Overdue transactions are now cumulative penalties and must not block
  // future overdue cycles after a task is postponed.
  const rewarded = transactions.filter(
    (item) =>
      item.taskId === taskId &&
      (item.type === "task_completed" ||
        item.type === "task_early" ||
        item.id.startsWith(`task-created:${taskId}:completed:`)),
  );
  if (!rewarded.length) return null;

  const recipientAmounts: Record<string, number> = {};
  for (const item of rewarded) {
    recipientAmounts[item.userId] =
      (recipientAmounts[item.userId] || 0) + item.amount;
  }

  return {
    taskId,
    claimId: `legacy:${taskId}`,
    outcome: "rewarded",
    recipientAmounts,
    resolvedAt: rewarded[0].createdAt,
    resolvedByUserId: rewarded[0].createdByUserId,
    description: "Resultado de Papipuntos migrado: tarea completada",
  };
};

const getTaskResolution = (
  taskId: string,
): PapipointsTaskResolution | null =>
  readCachedResolutions().find(
    (item) => item.taskId === taskId && item.outcome === "rewarded",
  ) || getLegacyTaskOutcome(taskId, readCachedTransactions());

const getTaskPapipointsLabel = (task: Task): string =>
  task.isPrivate ? "Tarea privada" : task.name;

const hasTaskOverduePenalty = (taskId: string): boolean =>
  readCachedTransactions().some(
    (item) => item.taskId === taskId && item.type === "task_overdue",
  );

const toLocalDateKey = (date: Date): string =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");

const getOverdueDayKeys = (task: Task, now = new Date()): string[] => {
  const due = getTaskDate(task);
  if (!due || due.getTime() >= now.getTime()) return [];

  const cursor = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  // A date-only task expires at the end of its due date, so its first overdue
  // day is the following calendar day. With an explicit time, the due date
  // itself counts as day one once that time has passed.
  if (!task.dueTime) cursor.setDate(cursor.getDate() + 1);

  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const keys: string[] = [];
  while (cursor.getTime() <= end.getTime()) {
    const key = toLocalDateKey(cursor);
    if (!task.overduePenaltyStartDate || key >= task.overduePenaltyStartDate) {
      keys.push(key);
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
};

const getPenaltyCycleKey = (task: Task): string => {
  const date = task.dueDate || "sin-fecha";
  const time = (task.dueTime || "fin-dia").replace(":", "-");
  return `${date}-${time}`;
};

const changesFromAmounts = (
  recipientAmounts: Record<string, number>,
): PapipointsChange[] =>
  Object.entries(recipientAmounts)
    .map(([userId, amount]) => {
      const user = getAppUserByUid(userId);
      return user
        ? {
            userId,
            userName: user.name,
            amount,
          }
        : null;
    })
    .filter((item): item is PapipointsChange => Boolean(item && item.amount !== 0));


const transactionsFromResolution = (
  resolution: PapipointsTaskResolution,
): PapipointsTransaction[] => {
  const result: PapipointsTransaction[] = [];
  for (const [userId, amount] of Object.entries(
    resolution.recipientAmounts,
  )) {
    if (amount === 0) continue;
    const user = getAppUserByUid(userId);
    if (!user) continue;
    result.push({
      id: `task-outcome:${resolution.taskId}:${userId}`,
      userId,
      userName: user.name,
      amount,
      type:
        resolution.outcome === "penalized"
          ? "task_overdue"
          : "task_completed",
      description: resolution.description,
      taskId: resolution.taskId,
      createdAt: resolution.resolvedAt,
      createdByUserId: resolution.resolvedByUserId,
    });
  }
  return result;
};

const normalizeReward = (reward: PapipointsReward): PapipointsReward => {
  if (reward.requestedByUserId && reward.providerUserId && reward.status) return reward;
  const requester = getAppUserByUid(reward.createdByUserId) || APP_USERS[0];
  const provider = getOtherAppUser(requester.name);
  return {
    ...reward,
    requestedByUserId: reward.requestedByUserId || requester.uid,
    providerUserId: reward.providerUserId || provider.uid,
    status: reward.status || ((reward.cost || 0) > 0 ? "available" : "pending_configuration"),
    fulfillmentDays: reward.fulfillmentDays || 1,
    active: reward.active !== false,
  };
};

const addLocalDays = (date: Date, days: number): Date => {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + days);
  return next;
};

const toDateKey = (date: Date): string =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");

const getClaimOverdueDayKeys = (claim: PapipointsRewardClaim, now = new Date()): string[] => {
  if (claim.status !== "pending") return [];
  const [year, month, day] = claim.dueDate.split("-").map(Number);
  if (!year || !month || !day) return [];
  const cursor = new Date(year, month - 1, day);
  cursor.setDate(cursor.getDate() + 1);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const keys: string[] = [];
  while (cursor.getTime() <= end.getTime()) {
    keys.push(toDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
};

const rewardPenaltyTransactions = (settlement: RewardPenaltySettlement): PapipointsTransaction[] => {
  const provider = getAppUserByUid(settlement.providerUserId);
  const requester = getAppUserByUid(settlement.requesterUserId);
  if (!provider || !requester) return [];
  return [
    {
      id: `reward-penalty:${settlement.rewardClaimId}:${settlement.dayKey}:${provider.uid}`,
      userId: provider.uid,
      userName: provider.name,
      amount: -settlement.amount,
      type: "reward_overdue_transfer",
      description: settlement.amount
        ? `Penalización por recompensa vencida: -${settlement.amount} PP transferidos a ${requester.name}`
        : "Recompensa vencida sin Papipuntos disponibles para transferir",
      rewardClaimId: settlement.rewardClaimId,
      createdAt: settlement.createdAt,
      createdByUserId: settlement.createdByUserId,
    },
    {
      id: `reward-penalty:${settlement.rewardClaimId}:${settlement.dayKey}:${requester.uid}`,
      userId: requester.uid,
      userName: requester.name,
      amount: settlement.amount,
      type: "reward_overdue_transfer",
      description: settlement.amount
        ? `Compensación por recompensa vencida: +${settlement.amount} PP recibidos de ${provider.name}`
        : "Recompensa vencida sin transferencia disponible",
      rewardClaimId: settlement.rewardClaimId,
      createdAt: settlement.createdAt,
      createdByUserId: settlement.createdByUserId,
    },
  ];
};

export interface RedeemResult {
  ok: boolean;
  message: string;
  previousLevel?: number;
  nextLevel?: number;
}

export interface PapipointsChange {
  userId: string;
  userName: UserName;
  amount: number;
}

export interface UsePapipointsResult {
  transactions: PapipointsTransaction[];
  rewards: PapipointsReward[];
  rewardClaims: PapipointsRewardClaim[];
  profiles: Record<"Yisel" | "Yorki", PapipointsProfile>;
  pendingCount: number;
  removePendingTaskCreationReward: (taskId: string) => Promise<PapipointsChange | null>;
  awardTaskCompletion: (
    task: Task,
    completedAt: string,
    completedBy: AppUserDefinition,
  ) => Promise<PapipointsChange[]>;
  removeTaskCompletionRewards: (taskId: string) => Promise<PapipointsChange[]>;
  applyOverduePenalty: (
    task: Task,
    force?: boolean,
    effectiveAt?: string,
  ) => Promise<PapipointsChange[]>;
  settlePenaltyTask: (
    task: Task,
    effectiveAt?: string,
    reconcile?: boolean,
  ) => Promise<PapipointsChange[]>;
  hasTaskOverduePenalty: (taskId: string) => boolean;
  saveReward: (reward: PapipointsReward) => Promise<void>;
  configureReward: (rewardId: string, cost: number, fulfillmentDays: number) => Promise<void>;
  rejectReward: (rewardId: string) => Promise<void>;
  deleteReward: (rewardId: string) => Promise<void>;
  redeemReward: (reward: PapipointsReward, purchaseComment?: string) => Promise<RedeemResult>;
  completeRewardClaim: (claim: PapipointsRewardClaim) => Promise<RedeemResult>;
  cancelRewardClaim: (claim: PapipointsRewardClaim) => Promise<RedeemResult>;
  settleRewardClaimPenalties: (claim: PapipointsRewardClaim) => Promise<PapipointsChange[]>;
  retrySync: () => Promise<void>;
}

export const usePapipoints = (
  currentUser: AppUserDefinition,
): UsePapipointsResult => {
  const [transactions, setTransactions] = useState<PapipointsTransaction[]>(
    readCachedTransactions,
  );
  const [rewards, setRewards] = useState<PapipointsReward[]>(() => readCachedRewards().map(normalizeReward));
  const [rewardClaims, setRewardClaims] = useState<PapipointsRewardClaim[]>(readCachedRewardClaims);
  const [, setResolutions] = useState<PapipointsTaskResolution[]>(
    readCachedResolutions,
  );
  const [pendingCount, setPendingCount] = useState(readPendingOperations().length);
  const mountedRef = useRef(true);
  const firebaseConnectedRef = useRef(false);

  const updateTransactions = useCallback((next: PapipointsTransaction[]) => {
    const sorted = [...next].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    setTransactions(sorted);
    storeTransactions(sorted);
  }, []);

  const updateRewards = useCallback((next: PapipointsReward[]) => {
    const sorted = next.map(normalizeReward).sort(
      (a, b) => (a.cost || 0) - (b.cost || 0) || a.name.localeCompare(b.name),
    );
    setRewards(sorted);
    storeRewards(sorted);
  }, []);

  const updateRewardClaims = useCallback((next: PapipointsRewardClaim[]) => {
    const sorted = [...next].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    setRewardClaims(sorted);
    storeRewardClaims(sorted);
  }, []);

  const updateResolutions = useCallback((next: PapipointsTaskResolution[]) => {
    setResolutions(next);
    storeResolutions(next);
  }, []);

  const queueOperation = useCallback((operation: PendingOperation) => {
    const current = readPendingOperations();
    const next = [
      ...current.filter((item) => item.id !== operation.id),
      operation,
    ];
    storePendingOperations(next);
    setPendingCount(next.length);
  }, []);

  const removePendingOperation = useCallback((operationId: string) => {
    const next = readPendingOperations().filter((item) => item.id !== operationId);
    storePendingOperations(next);
    setPendingCount(next.length);
  }, []);

  const reconcileLostResolution = useCallback(
    (
      operation: Extract<PendingOperation, { type: "resolveTaskOutcome" }>,
      remoteResolution: PapipointsTaskResolution,
    ) => {
      const transactionIds = new Set(operation.transactions.map((item) => item.id));
      updateTransactions(
        readCachedTransactions().filter((item) => !transactionIds.has(item.id)),
      );
      updateResolutions([
        ...readCachedResolutions().filter(
          (item) => item.taskId !== remoteResolution.taskId,
        ),
        remoteResolution,
      ]);
    },
    [updateResolutions, updateTransactions],
  );

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
          const transactionRef = ref(
            database,
            `papipoints/transactions/${operation.transaction.id}`,
          );
          await runTransaction(
            transactionRef,
            (current) =>
              current == null ? stripUndefined(operation.transaction) : undefined,
            { applyLocally: false },
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
        } else if (operation.type === "deleteReward") {
          await remove(ref(database, `papipoints/rewards/${operation.rewardId}`));
        } else if (operation.type === "upsertRewardClaim") {
          await set(
            ref(database, `papipoints/rewardClaims/${operation.claim.id}`),
            stripUndefined(operation.claim),
          );
        } else if (operation.type === "redeemReward") {
          await update(ref(database), {
            [`papipoints/transactions/${operation.transaction.id}`]: stripUndefined(operation.transaction),
            [`papipoints/rewardClaims/${operation.claim.id}`]: stripUndefined(operation.claim),
          });
        } else if (operation.type === "settleRewardPenalty") {
          const settlementRef = ref(
            database,
            `papipoints/rewardPenaltySettlements/${operation.settlement.rewardClaimId}/${operation.settlement.dayKey}`,
          );
          const result = await runTransaction(
            settlementRef,
            (current) => current == null ? stripUndefined(operation.settlement) : undefined,
            { applyLocally: false },
          );
          const winning = (result.snapshot.exists()
            ? result.snapshot.val()
            : (await get(settlementRef)).val()) as RewardPenaltySettlement | null;
          if (!winning) return false;
          const winnerTransactions = rewardPenaltyTransactions(winning);
          const localIds = new Set(operation.transactions.map((item) => item.id));
          const nextTransactions = readCachedTransactions().filter((item) => !localIds.has(item.id));
          updateTransactions([...nextTransactions, ...winnerTransactions]);
          const transactionUpdates: Record<string, PapipointsTransaction> = {};
          for (const transaction of winnerTransactions) {
            transactionUpdates[`papipoints/transactions/${transaction.id}`] = stripUndefined(transaction);
          }
          if (Object.keys(transactionUpdates).length) {
            await update(ref(database), transactionUpdates);
          }
        } else if (operation.type === "cancelRewardClaim") {
          await update(ref(database), {
            [`papipoints/transactions/${operation.refundTransaction.id}`]: stripUndefined(operation.refundTransaction),
            [`papipoints/rewardClaims/${operation.claim.id}`]: stripUndefined(operation.claim),
          });
        } else if (operation.type === "resolveTaskOutcome") {
          const resolutionRef = ref(
            database,
            `papipoints/taskResolutions/${operation.resolution.taskId}`,
          );
          const existing = await get(resolutionRef);
          let winningResolution = existing.exists()
            ? (existing.val() as PapipointsTaskResolution)
            : null;

          if (!winningResolution) {
            const result = await runTransaction(
              resolutionRef,
              (current) => (current == null ? stripUndefined(operation.resolution) : undefined),
              { applyLocally: false },
            );
            winningResolution = result.snapshot.exists()
              ? (result.snapshot.val() as PapipointsTaskResolution)
              : null;
            if (!winningResolution) {
              const afterTransaction = await get(resolutionRef);
              winningResolution = afterTransaction.exists()
                ? (afterTransaction.val() as PapipointsTaskResolution)
                : null;
            }
          }

          if (!winningResolution) return false;

          if (
            winningResolution.claimId !== operation.resolution.claimId
          ) {
            // The other device won the one-outcome claim. Recreate its
            // deterministic transactions from the resolution itself so a
            // crash between claiming the outcome and writing the ledger cannot
            // leave the Papipuntos balance incomplete.
            const remoteTransactions =
              transactionsFromResolution(winningResolution);
            const remoteUpdates: Record<string, PapipointsTransaction> = {};
            for (const transaction of remoteTransactions) {
              remoteUpdates[`papipoints/transactions/${transaction.id}`] =
                stripUndefined(transaction);
            }
            if (Object.keys(remoteUpdates).length) {
              await update(ref(database), remoteUpdates);
            }
            reconcileLostResolution(operation, winningResolution);
            removePendingOperation(operation.id);
            return true;
          }

          const updates: Record<string, PapipointsTransaction> = {};
          for (const transaction of operation.transactions) {
            updates[`papipoints/transactions/${transaction.id}`] =
              stripUndefined(transaction);
          }
          if (Object.keys(updates).length) {
            await update(ref(database), updates);
          }
        } else if (operation.type === "deleteTaskOutcome") {
          const resolutionRef = ref(
            database,
            `papipoints/taskResolutions/${operation.taskId}`,
          );
          const snapshot = await get(resolutionRef);
          const currentResolution = snapshot.exists()
            ? (snapshot.val() as PapipointsTaskResolution)
            : null;

          if (
            currentResolution &&
            operation.claimId &&
            currentResolution.claimId !== operation.claimId
          ) {
            removePendingOperation(operation.id);
            return true;
          }

          if (currentResolution) {
            await runTransaction(
              resolutionRef,
              (current) => {
                if (current == null) return null;
                if (
                  operation.claimId &&
                  (current as PapipointsTaskResolution).claimId !== operation.claimId
                ) {
                  return undefined;
                }
                return null;
              },
              { applyLocally: false },
            );
          }

          if (operation.transactionIds.length) {
            const updates: Record<string, null> = {};
            for (const transactionId of operation.transactionIds) {
              updates[`papipoints/transactions/${transactionId}`] = null;
            }
            await update(ref(database), updates);
          }
        }

        removePendingOperation(operation.id);
        return true;
      } catch {
        return false;
      }
    },
    [
      currentUser.uid,
      reconcileLostResolution,
      removePendingOperation,
      updateTransactions,
    ],
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

  const settlePenaltyTask = useCallback(
    async (
      task: Task,
      effectiveAt = new Date().toISOString(),
      reconcile = false,
    ): Promise<PapipointsChange[]> => {
      if ((task.taskType || "normal") !== "penalty" || task.isUnassigned) {
        return [];
      }

      const recipients = getTaskAssigneeUsers(task);
      if (!recipients.length) return [];
      const expectedHours = getPenaltyTaskAccruedHours(task, effectiveAt);
      const pointsPerHour = Math.max(
        1,
        Math.floor(Number(task.penaltyPointsPerHour) || PENALTY_TASK_POINTS_PER_HOUR),
      );
      const expectedIds = new Set<string>();
      const changes = new Map<string, PapipointsChange>();

      for (const recipient of recipients) {
        for (let hour = 1; hour <= expectedHours; hour += 1) {
          const transactionId = `penalty-task-hour:${task.id}:${hour}:${recipient.uid}`;
          expectedIds.add(transactionId);
          const added = await upsertTransaction({
            id: transactionId,
            userId: recipient.uid,
            userName: recipient.name,
            amount: -pointsPerHour,
            type: "penalty_task_hourly",
            description: `Penalización: ${getTaskPapipointsLabel(task)} (hora ${hour} · ${pointsPerHour} Papipuntos)`,
            taskId: task.id,
            createdAt: effectiveAt,
            createdByUserId: currentUser.uid,
          });
          if (added) {
            const current = changes.get(recipient.uid) || {
              userId: recipient.uid,
              userName: recipient.name,
              amount: 0,
            };
            current.amount -= pointsPerHour;
            changes.set(recipient.uid, current);
          }
        }
      }

      if (reconcile) {
        const existing = readCachedTransactions().filter(
          (item) =>
            item.taskId === task.id && item.type === "penalty_task_hourly",
        );
        for (const transaction of existing) {
          if (expectedIds.has(transaction.id)) continue;
          await deleteTransaction(transaction.id);
          const recipient = getAppUserByUid(transaction.userId);
          if (!recipient) continue;
          const current = changes.get(recipient.uid) || {
            userId: recipient.uid,
            userName: recipient.name,
            amount: 0,
          };
          current.amount -= transaction.amount;
          changes.set(recipient.uid, current);
        }
      }

      return [...changes.values()].filter((change) => change.amount !== 0);
    },
    [currentUser.uid, deleteTransaction, upsertTransaction],
  );

  const removePendingTaskCreationReward = useCallback(
    async (taskId: string): Promise<PapipointsChange | null> => {
      const transaction = readCachedTransactions().find(
        (item) => item.id === `task-created:${taskId}`,
      );
      if (!transaction) return null;
      await deleteTransaction(transaction.id);
      return {
        userId: transaction.userId,
        userName: transaction.userName,
        amount: -transaction.amount,
      };
    },
    [deleteTransaction],
  );

  const resolveTaskOutcome = useCallback(
    async (
      resolution: PapipointsTaskResolution,
      outcomeTransactions: PapipointsTransaction[],
    ): Promise<PapipointsChange[]> => {
      if (getTaskResolution(resolution.taskId)) return [];

      updateResolutions([...readCachedResolutions(), resolution]);
      if (outcomeTransactions.length) {
        const map = new Map(
          readCachedTransactions().map((item) => [item.id, item]),
        );
        for (const transaction of outcomeTransactions) {
          map.set(transaction.id, transaction);
        }
        updateTransactions([...map.values()]);
      }

      submitOperation({
        id: `task-outcome-resolve:${resolution.taskId}`,
        actorUserId: currentUser.uid,
        type: "resolveTaskOutcome",
        resolution,
        transactions: outcomeTransactions,
      });

      return changesFromAmounts(resolution.recipientAmounts);
    },
    [currentUser.uid, submitOperation, updateResolutions, updateTransactions],
  );

  const applyOverduePenalty = useCallback(
    async (
      task: Task,
      force = false,
      effectiveAt = new Date().toISOString(),
    ): Promise<PapipointsChange[]> => {
      if (!task.priority || !isTaskOverdueAt(task, effectiveAt)) return [];
      if (!force && !isEligibleForOverduePenaltyAt(task, effectiveAt)) return [];

      const changes = new Map<string, PapipointsChange>();
      const legacyCreation = await removePendingTaskCreationReward(task.id);
      if (legacyCreation) changes.set(legacyCreation.userId, legacyCreation);

      const overdueDays = getOverdueDayKeys(task, new Date(effectiveAt));
      if (!overdueDays.length) return [...changes.values()];

      const resolvedAt = new Date().toISOString();
      const recipients = getTaskAssigneeUsers(task);
      const cycleKey = getPenaltyCycleKey(task);
      const dailyPenalty = OVERDUE_PENALTY[task.priority];

      // Penalties are materialized only when the user acts on the overdue
      // task. Each overdue calendar day has a deterministic transaction ID,
      // which means retries and later checks only apply days not already
      // charged for this deadline cycle.
      for (let dayIndex = 0; dayIndex < overdueDays.length; dayIndex += 1) {
        const overdueDay = overdueDays[dayIndex];
        for (const assignee of recipients) {
          const transactionId = `task-overdue-day:${task.id}:${cycleKey}:${overdueDay}:${assignee.uid}`;
          if (readCachedTransactions().some((item) => item.id === transactionId)) {
            continue;
          }

          const penalty = dailyPenalty;
          const added = await upsertTransaction({
            id: transactionId,
            userId: assignee.uid,
            userName: assignee.name,
            amount: -penalty,
            type: "task_overdue",
            description: `${
              task.assignedTo === "Ambos"
                ? "Tarea compartida vencida"
                : "Tarea vencida"
            }: ${getTaskPapipointsLabel(task)} (día ${dayIndex + 1} de ${overdueDays.length} de atraso · ${dailyPenalty} Papipuntos por día)`,
            taskId: task.id,
            createdAt: resolvedAt,
            createdByUserId: currentUser.uid,
          });

          // Papipuntos may go below zero, so every overdue day applies the
          // full configured penalty regardless of the current balance.
          if (added) {
            const existing = changes.get(assignee.uid) || {
              userId: assignee.uid,
              userName: assignee.name,
              amount: 0,
            };
            existing.amount -= penalty;
            changes.set(assignee.uid, existing);
          }
        }
      }

      return [...changes.values()].filter((change) => change.amount !== 0);
    },
    [
      currentUser.uid,
      removePendingTaskCreationReward,
      upsertTransaction,
    ],
  );

  const awardTaskCompletion = useCallback(
    async (
      task: Task,
      completedAt: string,
      completedBy: AppUserDefinition,
    ): Promise<PapipointsChange[]> => {
      if ((task.taskType || "normal") === "penalty") {
        return settlePenaltyTask(task, completedAt, true);
      }
      if (!task.priority) return [];

      // Penalties are calculated when the task is completed (or when an
      // overdue task is postponed/cancelled/deleted). There is no background
      // daily deduction. Each overdue cycle is charged once for all calendar
      // days accumulated in that cycle.
      let penaltyChanges: PapipointsChange[] = [];
      if (
        isTaskOverdueAt(task, completedAt) &&
        isEligibleForOverduePenaltyAt(task, completedAt)
      ) {
        penaltyChanges = await applyOverduePenalty(task, false, completedAt);
      }

      // Once a task has ever received an overdue penalty, it permanently loses
      // its completion reward. A later postponed deadline can accumulate new
      // penalties, but completing the task never restores positive points.
      if (hasTaskOverduePenalty(task.id)) {
        return penaltyChanges;
      }

      if (getTaskResolution(task.id)) return penaltyChanges;

      const changes = new Map<string, PapipointsChange>();
      for (const change of penaltyChanges) changes.set(change.userId, change);

      const legacyCreation = await removePendingTaskCreationReward(task.id);
      if (legacyCreation) changes.set(legacyCreation.userId, legacyCreation);

      const recipients =
        task.assignedTo === "Ambos"
          ? getTaskAssigneeUsers(task)
          : [completedBy];
      const base = COMPLETION_POINTS[task.priority];
      const early = isCompletedEarly(task, completedAt);
      const earlyBonus = early ? EARLY_COMPLETION_BONUS[task.priority] : 0;
      const creationBonus = task.source === "manual" ? TASK_CREATION_POINTS : 0;
      const amountPerRecipient = base + earlyBonus + creationBonus;
      const recipientAmounts: Record<string, number> = {};
      const outcomeTransactions: PapipointsTransaction[] = [];

      for (const recipient of recipients) {
        recipientAmounts[recipient.uid] = amountPerRecipient;
        const detailParts = [
          `${base} por completar`,
          creationBonus ? `${creationBonus} por tarea manual` : "",
          earlyBonus ? `${earlyBonus} por completar antes de tiempo` : "",
        ].filter(Boolean);
        outcomeTransactions.push({
          id: `task-outcome:${task.id}:${recipient.uid}`,
          userId: recipient.uid,
          userName: recipient.name,
          amount: amountPerRecipient,
          type: "task_completed",
          description: `${
            task.assignedTo === "Ambos"
              ? "Tarea compartida completada"
              : "Tarea completada"
          }: ${getTaskPapipointsLabel(task)} (${detailParts.join(" + ")})`,
          taskId: task.id,
          createdAt: completedAt,
          createdByUserId: currentUser.uid,
        });
      }

      const outcomeChanges = await resolveTaskOutcome(
        {
          taskId: task.id,
          claimId: crypto.randomUUID(),
          outcome: "rewarded",
          recipientAmounts,
          resolvedAt: completedAt,
          resolvedByUserId: currentUser.uid,
          description: early
            ? `Tarea completada antes de tiempo: ${getTaskPapipointsLabel(task)}`
            : `Tarea completada: ${getTaskPapipointsLabel(task)}`,
        },
        outcomeTransactions,
      );

      for (const change of outcomeChanges) {
        const existing = changes.get(change.userId) || {
          ...change,
          amount: 0,
        };
        existing.amount += change.amount;
        changes.set(change.userId, existing);
      }

      return [...changes.values()].filter((change) => change.amount !== 0);
    },
    [
      applyOverduePenalty,
      currentUser.uid,
      removePendingTaskCreationReward,
      resolveTaskOutcome,
      settlePenaltyTask,
    ],
  );

  const removeTaskCompletionRewards = useCallback(
    async (taskId: string): Promise<PapipointsChange[]> => {
      const resolution = readCachedResolutions().find(
        (item) => item.taskId === taskId && item.outcome === "rewarded",
      );

      if (resolution) {
        // A missed deadline is permanent. Undoing the later task completion
        // must not refund or reopen a penalty outcome.
        if (resolution.outcome !== "rewarded") return [];

        const transactionIds = readCachedTransactions()
          .filter(
            (item) =>
              item.taskId === taskId &&
              item.id.startsWith(`task-outcome:${taskId}:`),
          )
          .map((item) => item.id);
        const transactionIdSet = new Set(transactionIds);
        updateTransactions(
          readCachedTransactions().filter(
            (item) => !transactionIdSet.has(item.id),
          ),
        );
        updateResolutions(
          readCachedResolutions().filter((item) => item.taskId !== taskId),
        );
        submitOperation({
          id: `task-outcome-delete:${taskId}`,
          actorUserId: currentUser.uid,
          type: "deleteTaskOutcome",
          taskId,
          claimId: resolution.claimId,
          transactionIds,
        });

        return changesFromAmounts(
          Object.fromEntries(
            Object.entries(resolution.recipientAmounts).map(([uid, amount]) => [
              uid,
              -amount,
            ]),
          ),
        );
      }

      // Compatibility with positive outcomes created by older versions.
      const existing = readCachedTransactions().filter(
        (item) =>
          item.taskId === taskId &&
          (item.type === "task_completed" ||
            item.type === "task_early" ||
            item.id.startsWith(`task-created:${taskId}:completed:`)),
      );
      if (!existing.length) return [];

      const changes = new Map<string, PapipointsChange>();
      for (const transaction of existing) {
        const current = changes.get(transaction.userId) || {
          userId: transaction.userId,
          userName: transaction.userName,
          amount: 0,
        };
        current.amount -= transaction.amount;
        changes.set(transaction.userId, current);
        await deleteTransaction(transaction.id);
      }
      return [...changes.values()].filter((change) => change.amount !== 0);
    },
    [
      currentUser.uid,
      deleteTransaction,
      submitOperation,
      updateResolutions,
      updateTransactions,
    ],
  );

  const saveReward = useCallback(
    async (reward: PapipointsReward) => {
      const normalized = normalizeReward(reward);
      const current = readCachedRewards().map(normalizeReward);
      const next = current.some((item) => item.id === normalized.id)
        ? current.map((item) => (item.id === normalized.id ? normalized : item))
        : [...current, normalized];
      updateRewards(next);
      submitOperation({
        id: `reward-upsert:${normalized.id}`,
        actorUserId: currentUser.uid,
        type: "upsertReward",
        reward: normalized,
      });
    },
    [currentUser.uid, submitOperation, updateRewards],
  );

  const configureReward = useCallback(
    async (rewardId: string, cost: number, fulfillmentDays: number) => {
      const current = readCachedRewards().map(normalizeReward);
      const reward = current.find((item) => item.id === rewardId);
      if (!reward || reward.providerUserId !== currentUser.uid) return;
      const timestamp = new Date().toISOString();
      await saveReward({
        ...reward,
        cost: Math.max(1, Math.floor(cost)),
        fulfillmentDays: Math.max(1, Math.floor(fulfillmentDays)),
        status: "available",
        active: true,
        configuredAt: timestamp,
        configuredByUserId: currentUser.uid,
        rejectedAt: undefined,
        rejectedByUserId: undefined,
        updatedAt: timestamp,
      });
    },
    [currentUser.uid, saveReward],
  );

  const rejectReward = useCallback(
    async (rewardId: string) => {
      const current = readCachedRewards().map(normalizeReward);
      const reward = current.find((item) => item.id === rewardId);
      if (!reward || reward.providerUserId !== currentUser.uid) return;
      const timestamp = new Date().toISOString();
      await saveReward({
        ...reward,
        status: "rejected",
        active: false,
        rejectedAt: timestamp,
        rejectedByUserId: currentUser.uid,
        updatedAt: timestamp,
      });
    },
    [currentUser.uid, saveReward],
  );

  const deleteReward = useCallback(
    async (rewardId: string) => {
      const reward = readCachedRewards().map(normalizeReward).find((item) => item.id === rewardId);
      if (!reward || reward.requestedByUserId !== currentUser.uid) return;
      updateRewards(readCachedRewards().map(normalizeReward).filter((item) => item.id !== rewardId));
      submitOperation({
        id: `reward-delete:${rewardId}`,
        actorUserId: currentUser.uid,
        type: "deleteReward",
        rewardId,
      });
    },
    [currentUser.uid, submitOperation, updateRewards],
  );

  const upsertRewardClaim = useCallback(
    async (claim: PapipointsRewardClaim) => {
      const current = readCachedRewardClaims();
      const next = current.some((item) => item.id === claim.id)
        ? current.map((item) => (item.id === claim.id ? claim : item))
        : [...current, claim];
      updateRewardClaims(next);
      submitOperation({
        id: `reward-claim-upsert:${claim.id}`,
        actorUserId: currentUser.uid,
        type: "upsertRewardClaim",
        claim,
      });
    },
    [currentUser.uid, submitOperation, updateRewardClaims],
  );

  const redeemReward = useCallback(
    async (reward: PapipointsReward, purchaseComment?: string): Promise<RedeemResult> => {
      const normalized = normalizeReward(reward);
      const cost = normalized.cost || 0;
      const fulfillmentDays = normalized.fulfillmentDays || 0;
      const currentTransactions = readCachedTransactions();
      const balance = getPapipointsBalance(currentTransactions, currentUser.uid);
      const alreadyActive = readCachedRewardClaims().some(
        (claim) =>
          claim.rewardId === normalized.id &&
          claim.requesterUserId === currentUser.uid &&
          claim.status === "pending",
      );
      if (alreadyActive) {
        return { ok: false, message: "Ya tienes un canje activo de esta recompensa." };
      }
      if (
        normalized.status !== "available" ||
        !normalized.active ||
        normalized.requestedByUserId !== currentUser.uid ||
        !cost ||
        !fulfillmentDays
      ) {
        return { ok: false, message: "Esta recompensa no está disponible para ti." };
      }
      if (balance < cost) {
        return {
          ok: false,
          message: `Necesitas ${cost - balance} Papipuntos adicionales.`,
        };
      }

      const previousLevel = getLevelFromPapipoints(balance);
      const nextLevel = getLevelFromPapipoints(balance - cost);
      const claimId = crypto.randomUUID();
      const claimedAt = new Date();
      const claim: PapipointsRewardClaim = {
        id: claimId,
        rewardId: normalized.id,
        rewardName: normalized.name,
        rewardDescription: normalized.description,
        purchaseComment: purchaseComment?.trim() || undefined,
        requesterUserId: currentUser.uid,
        providerUserId: normalized.providerUserId,
        cost,
        fulfillmentDays,
        overdueTransferPercent: REWARD_OVERDUE_TRANSFER_PERCENT,
        claimedAt: claimedAt.toISOString(),
        dueDate: toDateKey(addLocalDays(claimedAt, fulfillmentDays)),
        status: "pending",
        createdAt: claimedAt.toISOString(),
        updatedAt: claimedAt.toISOString(),
      };
      const transaction: PapipointsTransaction = {
        id: `reward-redeemed:${claimId}`,
        userId: currentUser.uid,
        userName: currentUser.name,
        amount: -cost,
        type: "reward_redeemed",
        description: `Recompensa canjeada: ${normalized.name}`,
        rewardId: normalized.id,
        rewardClaimId: claimId,
        createdAt: claimedAt.toISOString(),
        createdByUserId: currentUser.uid,
      };

      updateTransactions([...readCachedTransactions(), transaction]);
      updateRewardClaims([...readCachedRewardClaims(), claim]);
      submitOperation({
        id: `reward-redeem:${claimId}`,
        actorUserId: currentUser.uid,
        type: "redeemReward",
        claim,
        transaction,
      });

      const provider = getAppUserByUid(normalized.providerUserId);
      return {
        ok: true,
        message: `Canjeaste “${normalized.name}” por ${cost} Papipuntos. ${provider?.name || "Tu pareja"} tiene ${fulfillmentDays} ${fulfillmentDays === 1 ? "día" : "días"} para entregarla.`,
        previousLevel,
        nextLevel,
      };
    },
    [currentUser, submitOperation, updateRewardClaims, updateTransactions],
  );

  const settleRewardClaimPenalties = useCallback(
    async (claim: PapipointsRewardClaim): Promise<PapipointsChange[]> => {
      if (claim.status !== "pending") return [];
      const provider = getAppUserByUid(claim.providerUserId);
      const requester = getAppUserByUid(claim.requesterUserId);
      if (!provider || !requester) return [];
      const dayKeys = getClaimOverdueDayKeys(claim);
      if (!dayKeys.length) return [];

      const changes = new Map<string, PapipointsChange>();
      const dailyAmount = Math.max(
        1,
        Math.ceil((claim.cost * claim.overdueTransferPercent) / 100),
      );

      for (const dayKey of dayKeys) {
        const providerTransactionId = `reward-penalty:${claim.id}:${dayKey}:${provider.uid}`;
        if (readCachedTransactions().some((item) => item.id === providerTransactionId)) continue;

        const transferAmount = dailyAmount;
        const settlement: RewardPenaltySettlement = {
          id: `${claim.id}:${dayKey}`,
          rewardClaimId: claim.id,
          dayKey,
          providerUserId: provider.uid,
          requesterUserId: requester.uid,
          amount: transferAmount,
          createdAt: new Date().toISOString(),
          createdByUserId: currentUser.uid,
        };
        const settlementTransactions = rewardPenaltyTransactions(settlement);
        updateTransactions([...readCachedTransactions(), ...settlementTransactions]);
        submitOperation({
          id: `reward-penalty-settle:${claim.id}:${dayKey}`,
          actorUserId: currentUser.uid,
          type: "settleRewardPenalty",
          settlement,
          transactions: settlementTransactions,
        });

        if (transferAmount > 0) {
          for (const [user, amount] of [[provider, -transferAmount], [requester, transferAmount]] as const) {
            const existing = changes.get(user.uid) || { userId: user.uid, userName: user.name, amount: 0 };
            existing.amount += amount;
            changes.set(user.uid, existing);
          }
        }
      }
      return [...changes.values()].filter((item) => item.amount !== 0);
    },
    [currentUser.uid, submitOperation, updateTransactions],
  );

  const completeRewardClaim = useCallback(
    async (claim: PapipointsRewardClaim): Promise<RedeemResult> => {
      const latestClaim = readCachedRewardClaims().find((item) => item.id === claim.id) || claim;
      if (latestClaim.status !== "pending" || latestClaim.providerUserId !== currentUser.uid) {
        return { ok: false, message: "No puedes completar esta recompensa." };
      }
      await settleRewardClaimPenalties(latestClaim);
      const timestamp = new Date().toISOString();
      await upsertRewardClaim({
        ...latestClaim,
        status: "completed",
        completedAt: timestamp,
        completedByUserId: currentUser.uid,
        updatedAt: timestamp,
      });
      return { ok: true, message: `Marcaste “${claim.rewardName}” como entregada. Las penalizaciones se detienen.` };
    },
    [currentUser.uid, settleRewardClaimPenalties, upsertRewardClaim],
  );

  const cancelRewardClaim = useCallback(
    async (claim: PapipointsRewardClaim): Promise<RedeemResult> => {
      const latestClaim = readCachedRewardClaims().find((item) => item.id === claim.id) || claim;
      if (latestClaim.status !== "pending" || latestClaim.requesterUserId !== currentUser.uid) {
        return { ok: false, message: "Solo quien canjeó la recompensa puede cancelarla." };
      }
      const refundTransactionId = `reward-refund:${latestClaim.id}`;
      if (readCachedTransactions().some((item) => item.id === refundTransactionId)) {
        return { ok: false, message: "Este canje ya fue cancelado." };
      }
      await settleRewardClaimPenalties(latestClaim);
      const refundAmount = Math.floor((latestClaim.cost * REWARD_CANCEL_REFUND_PERCENT) / 100);
      const timestamp = new Date().toISOString();
      const refundTransaction: PapipointsTransaction = {
        id: refundTransactionId,
        userId: currentUser.uid,
        userName: currentUser.name,
        amount: refundAmount,
        type: "reward_refund",
        description: `Reembolso del ${REWARD_CANCEL_REFUND_PERCENT}% por cancelar recompensa: ${latestClaim.rewardName}`,
        rewardId: latestClaim.rewardId,
        rewardClaimId: latestClaim.id,
        createdAt: timestamp,
        createdByUserId: currentUser.uid,
      };
      const updatedClaim: PapipointsRewardClaim = {
        ...latestClaim,
        status: "cancelled",
        cancelledAt: timestamp,
        cancelledByUserId: currentUser.uid,
        refundAmount,
        updatedAt: timestamp,
      };
      updateTransactions([...readCachedTransactions(), refundTransaction]);
      updateRewardClaims(
        readCachedRewardClaims().map((item) => item.id === latestClaim.id ? updatedClaim : item),
      );
      submitOperation({
        id: `reward-claim-cancel:${latestClaim.id}`,
        actorUserId: currentUser.uid,
        type: "cancelRewardClaim",
        claim: updatedClaim,
        refundTransaction,
      });
      return {
        ok: true,
        message: `Recompensa cancelada. Recuperaste ${refundAmount} Papipuntos (${REWARD_CANCEL_REFUND_PERCENT}% del costo).`,
      };
    },
    [currentUser, settleRewardClaimPenalties, submitOperation, updateRewardClaims, updateTransactions],
  );

  useEffect(() => {
    mountedRef.current = true;
    if (!isFirebaseConfigured()) return () => undefined;

    let unsubscribeTransactions: Unsubscribe | undefined;
    let unsubscribeRewards: Unsubscribe | undefined;
    let unsubscribeRewardClaims: Unsubscribe | undefined;
    let unsubscribeResolutions: Unsubscribe | undefined;
    let unsubscribeConnection: Unsubscribe | undefined;

    try {
      const { auth, database } = getAuthenticatedFirebaseServices();
      if (auth.currentUser?.uid !== currentUser.uid) return () => undefined;

      unsubscribeConnection = onValue(
        ref(database, ".info/connected"),
        (snapshot) => {
          firebaseConnectedRef.current = snapshot.val() === true;
          if (firebaseConnectedRef.current) void retrySync();
        },
      );

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

      unsubscribeResolutions = onValue(
        ref(database, "papipoints/taskResolutions"),
        (snapshot) => {
          if (!mountedRef.current) return;
          updateResolutions(
            mergeResolutionsWithPending(
              recordToResolutions(snapshot.val()),
              readPendingOperations(),
            ),
          );
        },
      );

      unsubscribeRewards = onValue(
        ref(database, "papipoints/rewards"),
        (snapshot) => {
          if (!mountedRef.current) return;
          const remote = recordToArray<PapipointsReward>(snapshot.val()).map(normalizeReward);
          updateRewards(
            mergeRewardsWithPending(remote, readPendingOperations()),
          );
        },
      );

      unsubscribeRewardClaims = onValue(
        ref(database, "papipoints/rewardClaims"),
        (snapshot) => {
          if (!mountedRef.current) return;
          updateRewardClaims(
            mergeRewardClaimsWithPending(
              recordToArray<PapipointsRewardClaim>(snapshot.val()),
              readPendingOperations(),
            ),
          );
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
      unsubscribeRewardClaims?.();
      unsubscribeResolutions?.();
      unsubscribeConnection?.();
    };
  }, [
    currentUser.uid,
    retrySync,
    updateResolutions,
    updateRewardClaims,
    updateRewards,
    updateTransactions,
  ]);

  useEffect(() => {
    const settle = () => {
      for (const claim of readCachedRewardClaims().filter((item) => item.status === "pending")) {
        void settleRewardClaimPenalties(claim);
      }
    };
    settle();
    const interval = window.setInterval(settle, 5 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [rewardClaims, settleRewardClaimPenalties]);

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
    rewardClaims,
    profiles,
    pendingCount,
    removePendingTaskCreationReward,
    awardTaskCompletion,
    removeTaskCompletionRewards,
    applyOverduePenalty,
    settlePenaltyTask,
    hasTaskOverduePenalty,
    saveReward,
    configureReward,
    rejectReward,
    deleteReward,
    redeemReward,
    completeRewardClaim,
    cancelRewardClaim,
    settleRewardClaimPenalties,
    retrySync,
  };
};
