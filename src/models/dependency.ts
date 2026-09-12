import type { TaskAssignee, TaskPriority, TaskRecurrence } from "./task";

export type DependencyCycleMode = "overlap" | "wait";

export interface DependencyStepDefinition {
  id: string;
  name: string;
  description: string;
  assignedTo: TaskAssignee;
  estimatedMinutes: number;
  priority: TaskPriority;
  /** Calendar days after activation. Zero means the same day. */
  dueAfterDays: number;
  dueTime?: string;
}

export interface DependencyChain {
  id: string;
  name: string;
  steps: DependencyStepDefinition[];
  firstDueDate: string;
  recurrence: TaskRecurrence;
  cycleMode: DependencyCycleMode;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string;
  lastModifiedByUserId: string;
}
