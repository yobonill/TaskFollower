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
