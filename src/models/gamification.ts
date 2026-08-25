import type { UserName } from "./task";

export type PapipointsTransactionType =
  | "task_created"
  | "task_completed"
  | "task_early"
  | "task_overdue"
  | "penalty_task_hourly"
  | "reward_redeemed"
  | "reward_refund"
  | "reward_overdue_transfer";

export interface PapipointsTransaction {
  id: string;
  userId: string;
  userName: UserName;
  amount: number;
  type: PapipointsTransactionType;
  description: string;
  taskId?: string;
  rewardId?: string;
  rewardClaimId?: string;
  createdAt: string;
  createdByUserId: string;
}

export type PapipointsTaskOutcome = "rewarded" | "penalized";

export interface PapipointsTaskResolution {
  taskId: string;
  claimId: string;
  outcome: PapipointsTaskOutcome;
  recipientAmounts: Record<string, number>;
  resolvedAt: string;
  resolvedByUserId: string;
  description: string;
}

export type PapipointsRewardStatus =
  | "pending_configuration"
  | "available"
  | "rejected";

export interface PapipointsReward {
  id: string;
  name: string;
  description: string;
  /** The user who wants/requests this reward. */
  requestedByUserId: string;
  /** The partner who prices and fulfills this reward. */
  providerUserId: string;
  status: PapipointsRewardStatus;
  cost?: number;
  /** Calendar days the provider gets after a claim is created. */
  fulfillmentDays?: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string;
  configuredAt?: string;
  configuredByUserId?: string;
  rejectedAt?: string;
  rejectedByUserId?: string;
}

export type RewardClaimStatus = "pending" | "completed" | "cancelled";

export interface PapipointsRewardClaim {
  id: string;
  rewardId: string;
  rewardName: string;
  rewardDescription: string;
  requesterUserId: string;
  providerUserId: string;
  cost: number;
  fulfillmentDays: number;
  /** 10 means 10% of the original reward cost per overdue day. */
  overdueTransferPercent: number;
  claimedAt: string;
  dueDate: string;
  status: RewardClaimStatus;
  completedAt?: string;
  completedByUserId?: string;
  cancelledAt?: string;
  cancelledByUserId?: string;
  refundAmount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface RewardPenaltySettlement {
  id: string;
  rewardClaimId: string;
  dayKey: string;
  providerUserId: string;
  requesterUserId: string;
  amount: number;
  createdAt: string;
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
