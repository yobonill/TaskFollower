import type {
  PapipointsProfile,
  PapipointsTransaction,
} from "../models/gamification";
import type { Task, TaskPriority, UserName } from "../models/task";
import { getTaskDate } from "./taskDates";

export const MAX_LEVEL = 100;
export const TASK_CREATION_POINTS = 2;
export const LEVEL_GROWTH = 1.4;
export const FIRST_LEVEL_REQUIREMENT = 100;
export const LEVEL_REQUIREMENT_CAP = 500;

/**
 * Existing tasks that were already overdue before this release are not
 * penalized retroactively. Future due dates and new tasks are eligible.
 */
export const PAPIPOINTS_ACTIVATION_AT = "2026-08-06T21:30:00.000Z";

export const COMPLETION_POINTS: Record<TaskPriority, number> = {
  low: 5,
  normal: 10,
  high: 20,
  critical: 35,
};

export const EARLY_COMPLETION_BONUS: Record<TaskPriority, number> = {
  low: 1,
  normal: 2,
  high: 4,
  critical: 7,
};

export const OVERDUE_PENALTY: Record<TaskPriority, number> = {
  low: 2,
  normal: 4,
  high: 8,
  critical: 12,
};

/** Papipoints required to advance from `level` to `level + 1`. */
export const getPointsNeededForNextLevel = (level: number): number => {
  const safeLevel = Math.min(MAX_LEVEL - 1, Math.max(1, Math.floor(level)));
  const exponentialRequirement = Math.round(
    FIRST_LEVEL_REQUIREMENT * LEVEL_GROWTH ** (safeLevel - 1),
  );
  return Math.min(LEVEL_REQUIREMENT_CAP, exponentialRequirement);
};

/** Cumulative Papipoints required to be at the start of a level. */
export const getPointsRequiredForLevel = (level: number): number => {
  const safeLevel = Math.min(MAX_LEVEL, Math.max(1, Math.floor(level)));
  let total = 0;
  for (let currentLevel = 1; currentLevel < safeLevel; currentLevel += 1) {
    total += getPointsNeededForNextLevel(currentLevel);
  }
  return total;
};

export const getLevelFromPapipoints = (papipoints: number): number => {
  const safePoints = Math.max(0, Math.floor(papipoints));
  let low = 1;
  let high = MAX_LEVEL;

  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (getPointsRequiredForLevel(middle) <= safePoints) low = middle;
    else high = middle - 1;
  }

  return low;
};

export const getPapipointsBalance = (
  transactions: PapipointsTransaction[],
  userId: string,
): number =>
  transactions
    .filter((transaction) => transaction.userId === userId)
    .reduce((total, transaction) => total + transaction.amount, 0);

export const getPapipointsProfile = (
  transactions: PapipointsTransaction[],
  userId: string,
  userName: UserName,
): PapipointsProfile => {
  const balance = getPapipointsBalance(transactions, userId);
  const level = getLevelFromPapipoints(balance);
  const currentLevelStart = getPointsRequiredForLevel(level);
  const nextLevelTarget =
    level >= MAX_LEVEL
      ? currentLevelStart
      : getPointsRequiredForLevel(level + 1);
  const span = Math.max(1, nextLevelTarget - currentLevelStart);
  const progressPercent =
    level >= MAX_LEVEL
      ? 100
      : Math.max(0, Math.min(100, ((balance - currentLevelStart) / span) * 100));

  return {
    userId,
    userName,
    balance,
    level,
    currentLevelStart,
    nextLevelTarget,
    progressPercent,
  };
};

export const isCompletedEarly = (task: Task, completedAt: string): boolean => {
  if (!task.dueDate) return false;
  const completed = new Date(completedAt);
  if (task.dueTime) {
    const due = getTaskDate(task);
    return Boolean(due && completed.getTime() < due.getTime());
  }

  const completedDate = [
    completed.getFullYear(),
    String(completed.getMonth() + 1).padStart(2, "0"),
    String(completed.getDate()).padStart(2, "0"),
  ].join("-");
  return completedDate < task.dueDate;
};

export const isEligibleForOverduePenalty = (task: Task): boolean => {
  if (
    task.status !== "pending" ||
    task.isUnassigned ||
    !task.name.trim() ||
    !task.priority ||
    !task.dueDate
  ) return false;
  const due = getTaskDate(task);
  if (!due || due.getTime() >= Date.now()) return false;
  return due.getTime() > new Date(PAPIPOINTS_ACTIVATION_AT).getTime();
};

export const formatPapipoints = (amount: number): string =>
  `${amount.toLocaleString("es-DO")} Papipuntos`;
