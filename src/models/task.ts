export const USERS = ["Yisel", "Yorki"] as const;
export type UserName = (typeof USERS)[number];
export type TaskAssignee = UserName | "Ambos";
export type UserFilter = "all" | UserName;

export type TaskPriority = "low" | "normal" | "high" | "critical";
export type TaskStatus = "pending" | "done" | "cancelled";
export type RecurrenceType = "none" | "daily" | "weekly" | "monthly";
export type TaskSource =
  | "manual"
  | "import"
  | "duplicate"
  | "recurrence"
  | "migration";

export interface TaskRecurrence {
  type: RecurrenceType;
  interval: number;
  /** Last due date that may be generated for the recurring series. */
  endDate?: string;
}

export interface Task {
  id: string;
  name: string;
  description: string;
  estimatedMinutes?: number;
  dueDate?: string;
  dueTime?: string;
  priority?: TaskPriority;
  /** Display values retained for readable exports and legacy compatibility. */
  assignedBy: UserName;
  assignedTo: TaskAssignee;
  /** Firebase Authentication identities used for attribution and ownership. */
  createdByUserId?: string;
  /** Legacy/single-assignee UID. Undefined for shared tasks. */
  assignedToUserId?: string;
  /** Canonical assignee UID list. Shared tasks contain both users. */
  assignedToUserIds?: string[];
  lastModifiedByUserId?: string;
  status: TaskStatus;
  recurrence: TaskRecurrence;
  recurrenceSeriesId?: string;
  source?: TaskSource;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  completedBy?: UserName;
  completedByUserId?: string;
  cancelledAt?: string;
  cancelledBy?: UserName;
  cancelledByUserId?: string;
}

export interface TaskExport {
  schemaVersion: 4;
  exportedAt: string;
  tasks: Task[];
}

export interface CompletedTaskUndo {
  originalTask: Task;
  generatedTaskId?: string;
}

export type SyncState =
  | "local"
  | "connecting"
  | "synced"
  | "saving"
  | "offline"
  | "error";
