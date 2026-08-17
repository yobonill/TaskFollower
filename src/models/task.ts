export const USERS = ["Yisel", "Yorki"] as const;
export type UserName = (typeof USERS)[number];
export type TaskAssignee = UserName | "Ambos";
export type UserFilter = "all" | UserName;

export type TaskPriority = "low" | "normal" | "high" | "critical";
export type TaskStatus = "pending" | "done" | "cancelled";
export type RecurrenceType = "none" | "daily" | "weekly" | "weekdays" | "monthly";
export type WeekdayNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type TaskSource =
  | "manual"
  | "import"
  | "duplicate"
  | "recurrence"
  | "migration";

export interface TaskRecurrence {
  type: RecurrenceType;
  interval: number;
  /** Days used by the weekday recurrence mode. 1 = Monday, 7 = Sunday. */
  weekdays?: WeekdayNumber[];
  /** Number of sequential occurrences generated on each scheduled day. */
  occurrencesPerDay?: number;
  /** Default assignee for future occurrences in this recurring series. */
  defaultAssignedTo?: TaskAssignee;
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
  /** Private tasks are stored separately and are visible only to their owner. */
  isPrivate?: boolean;
  privateOwnerUserId?: string;
  lastModifiedByUserId?: string;
  status: TaskStatus;
  recurrence: TaskRecurrence;
  recurrenceSeriesId?: string;
  /** 1-based occurrence within the scheduled day (for example 2 of 3). */
  recurrenceOccurrenceIndex?: number;
  /** Earliest overdue calendar day that may be charged after responsibility changes. */
  overduePenaltyStartDate?: string;
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
  schemaVersion: 6;
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
