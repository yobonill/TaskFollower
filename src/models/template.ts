import type {
  TaskAssignee,
  TaskPriority,
  TaskRecurrence,
} from "./task";

/**
 * Templates contain every field a user can configure while creating a task.
 * System-controlled fields (creator, status, timestamps, source and Papipuntos)
 * are intentionally generated when the task itself is created.
 */
export interface TaskTemplate {
  id: string;
  name: string;
  description: string;
  estimatedMinutes?: number;
  priority?: TaskPriority;
  assignedTo: TaskAssignee;
  /** Visibility is configurable just like the rest of the task form. */
  isPrivate?: boolean;
  privateOwnerUserId?: string;
  dueDate?: string;
  dueTime?: string;
  recurrence: TaskRecurrence;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string;
}
