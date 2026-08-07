import type { TaskPriority } from "./task";

export interface TaskTemplate {
  id: string;
  name: string;
  description: string;
  estimatedMinutes?: number;
  priority?: TaskPriority;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string;
}
