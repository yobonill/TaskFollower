import type { Task } from "../models/task";

export type RequiredTaskField = "name" | "priority" | "dueDate";

const requiredFieldLabels: Record<RequiredTaskField, string> = {
  name: "nombre",
  priority: "prioridad",
  dueDate: "fecha límite",
};

export const getMissingRequiredFields = (
  task: Pick<Task, "name" | "priority" | "dueDate">,
): RequiredTaskField[] => {
  const missing: RequiredTaskField[] = [];
  if (!task.name.trim()) missing.push("name");
  if (!task.priority) missing.push("priority");
  if (!task.dueDate) missing.push("dueDate");
  return missing;
};

export const isTaskDataComplete = (
  task: Pick<Task, "name" | "priority" | "dueDate">,
): boolean => getMissingRequiredFields(task).length === 0;

export const formatMissingRequiredFields = (
  task: Pick<Task, "name" | "priority" | "dueDate">,
): string =>
  getMissingRequiredFields(task)
    .map((field) => requiredFieldLabels[field])
    .join(", ");
