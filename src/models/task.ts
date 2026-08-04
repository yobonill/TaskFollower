export const USERS = ["Yisel", "Yorki"] as const;
export type UserName = (typeof USERS)[number];
export type UserFilter = "all" | UserName;

export type TaskUrgency = "low" | "normal" | "high" | "critical";
export type TaskStatus = "pending" | "done";
export type RecurrenceType = "none" | "daily" | "weekly" | "monthly";

export interface TaskRecurrence {
  type: RecurrenceType;
  interval: number;
}

export interface Task {
  id: string;
  name: string;
  description: string;
  estimatedMinutes: number;
  dueDate: string;
  dueTime?: string;
  urgency: TaskUrgency;
  assignedBy: UserName;
  assignedTo: UserName;
  status: TaskStatus;
  recurrence: TaskRecurrence;
  recurrenceSeriesId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  completedBy?: UserName;
}

export interface TaskExport {
  schemaVersion: 1;
  exportedAt: string;
  tasks: Task[];
}

export type SyncState =
  | "local"
  | "connecting"
  | "synced"
  | "saving"
  | "offline"
  | "error";
