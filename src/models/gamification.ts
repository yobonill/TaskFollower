import type { UserName } from "./task";

export type PapipointsTransactionType =
  | "task_created"
  | "task_completed"
  | "task_early"
  | "task_overdue"
  | "reward_redeemed";

export interface PapipointsTransaction {
  id: string;
  userId: string;
  userName: UserName;
  amount: number;
  type: PapipointsTransactionType;
  description: string;
  taskId?: string;
  rewardId?: string;
  createdAt: string;
  createdByUserId: string;
}

export type PapipointsTaskOutcome = "rewarded" | "penalized";

/**
 * One task can resolve its Papipuntos lifecycle only once. The resolution is
 * shared by all devices and, for shared tasks, contains the amount applied to
 * each participant.
 */
export interface PapipointsTaskResolution {
  taskId: string;
  claimId: string;
  outcome: PapipointsTaskOutcome;
  recipientAmounts: Record<string, number>;
  resolvedAt: string;
  resolvedByUserId: string;
  description: string;
}

export interface PapipointsReward {
  id: string;
  name: string;
  description: string;
  cost: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string;
}

export interface PapipointsProfile {
  userId: string;
  userName: UserName;
  balance: number;
  level: number;
  currentLevelStart: number;
  nextLevelTarget: number;
  progressPercent: number;
}
