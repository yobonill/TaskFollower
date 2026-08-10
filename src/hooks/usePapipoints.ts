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
  type AppUserDefinition,
} from "../config/appUsers";
import { isFirebaseConfigured } from "../config/firebaseConfig";
import type {
  PapipointsProfile,
  PapipointsReward,
  PapipointsTaskResolution,
  PapipointsTransaction,
} from "../models/gamification";
import type { Task, UserName } from "../models/task";
import { getAuthenticatedFirebaseServices } from "../services/firebase";
import { getTaskAssigneeUsers } from "../utils/taskAssignment";
import { getTaskDate, isTaskOverdue } from "../utils/taskDates";
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
const RESOLUTIONS_CACHE_KEY = "taskFollower.papipoints.taskResolutions.v1";
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

const readCachedResolutions = (): PapipointsTaskResolution[] =>
  readJsonArray<PapipointsTaskResolution>(RESOLUTIONS_CACHE_KEY);

const readPendingOperations = (): PendingOperation[] =>
  readJsonArray<PendingOperation>(PENDING_KEY);

const storeTransactions = (transactions: PapipointsTransaction[]): void =>
  localStorage.setItem(TRANSACTIONS_CACHE_KEY, JSON.stringify(transactions));

const storeRewards = (rewards: PapipointsReward[]): void =>
  localStorage.setItem(REWARDS_CACHE_KEY, JSON.stringify(rewards));

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
    keys.push(toLocalDateKey(cursor));
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
  profiles: Record<"Yisel" | "Yorki", PapipointsProfile>;
  pendingCount: number;
  removePendingTaskCreationReward: (taskId: string) => Promise<PapipointsChange | null>;
  awardTaskCompletion: (
    task: Task,
    completedAt: string,
    completedBy: AppUserDefinition,
  ) => Promise<PapipointsChange[]>;
  removeTaskCompletionRewards: (taskId: string) => Promise<PapipointsChange[]>;
  applyOverduePenalty: (task: Task, force?: boolean) => Promise<PapipointsChange[]>;
  hasTaskOverduePenalty: (taskId: string) => boolean;
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
  const [, setResolutions] = useState<PapipointsTaskResolution[]>(
    readCachedResolutions,
  );
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
    const sorted = [...next].sort(
      (a, b) => a.cost - b.cost || a.name.localeCompare(b.name),
    );
    setRewards(sorted);
    storeRewards(sorted);
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
    async (task: Task, force = false): Promise<PapipointsChange[]> => {
      if (!task.priority || !isTaskOverdue(task)) return [];
      if (!force && !isEligibleForOverduePenalty(task)) return [];

      const changes = new Map<string, PapipointsChange>();
      const legacyCreation = await removePendingTaskCreationReward(task.id);
      if (legacyCreation) changes.set(legacyCreation.userId, legacyCreation);

      const overdueDays = getOverdueDayKeys(task);
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

          const balance = getPapipointsBalance(
            readCachedTransactions(),
            assignee.uid,
          );
          const penalty = Math.min(dailyPenalty, balance);
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

          // A zero-value transaction is intentionally kept as a penalty
          // marker when the balance is already zero. It is hidden from the
          // visible history, but permanently removes completion eligibility.
          if (added && penalty > 0) {
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
      if (!task.priority) return [];

      // Penalties are calculated when the task is completed (or when an
      // overdue task is postponed/cancelled/deleted). There is no background
      // daily deduction. Each overdue cycle is charged once for all calendar
      // days accumulated in that cycle.
      let penaltyChanges: PapipointsChange[] = [];
      if (isTaskOverdue(task) && isEligibleForOverduePenalty(task)) {
        penaltyChanges = await applyOverduePenalty(task);
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
      if (!reward.active) {
        return { ok: false, message: "Esta recompensa no está disponible." };
      }
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
          const remote = recordToArray<PapipointsReward>(snapshot.val());
          const merged = mergeRewardsWithPending(
            remote,
            readPendingOperations(),
          );
          updateRewards(merged);

          if (
            !remote.length &&
            !merged.length &&
            !defaultsInitializedRef.current
          ) {
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
      unsubscribeResolutions?.();
      unsubscribeConnection?.();
    };
  }, [
    currentUser.uid,
    retrySync,
    saveReward,
    updateResolutions,
    updateRewards,
    updateTransactions,
  ]);

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
    removePendingTaskCreationReward,
    awardTaskCompletion,
    removeTaskCompletionRewards,
    applyOverduePenalty,
    hasTaskOverduePenalty,
    saveReward,
    deleteReward,
    redeemReward,
    retrySync,
  };
};
