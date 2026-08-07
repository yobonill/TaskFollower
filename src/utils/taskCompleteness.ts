import type { Task } from "../models/task";

export type RequiredTaskField = "name" | "priority";

const requiredFieldLabels: Record<RequiredTaskField, string> = {
  name: "nombre",
  priority: "prioridad",
};

export const getMissingRequiredFields = (
  task: Pick<Task, "name" | "priority">,
): RequiredTaskField[] => {
  const missing: RequiredTaskField[] = [];
  if (!task.name.trim()) missing.push("name");
  if (!task.priority) missing.push("priority");
  return missing;
};

export const isTaskDataComplete = (
  task: Pick<Task, "name" | "priority">,
): boolean => getMissingRequiredFields(task).length === 0;

export const formatMissingRequiredFields = (
  task: Pick<Task, "name" | "priority">,
): string =>
  getMissingRequiredFields(task)
    .map((field) => requiredFieldLabels[field])
    .join(", ");
