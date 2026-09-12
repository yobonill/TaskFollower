import type { AppUserDefinition } from "../config/appUsers";
import type { DependencyChain, DependencyStepDefinition } from "../models/dependency";
import type { Task } from "../models/task";
import { getAppUserByName } from "../config/appUsers";
import { getAssigneeUserIds } from "./taskAssignment";
import { getNextRecurrenceOccurrence, toDateInputValue } from "./taskDates";

const addDaysToKey = (dateKey: string, days: number) => {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + days);
  return toDateInputValue(date);
};

export const createDependencyOccurrence = (
  chain: DependencyChain,
  step: DependencyStepDefinition,
  stepIndex: number,
  cycleId: string,
  cycleDueDate: string,
  actor: AppUserDefinition,
  parentTaskId?: string,
  activatedAt = new Date().toISOString(),
): Task => {
  const activationDate = toDateInputValue(new Date(activatedAt));
  const dueDate = stepIndex === 0
    ? cycleDueDate
    : addDaysToKey(activationDate, Math.max(0, step.dueAfterDays));
  const assigneeIds = getAssigneeUserIds(step.assignedTo);
  return {
    id: `dependency-${chain.id}-${cycleDueDate}-${stepIndex}`,
    taskType: "dependency",
    name: step.name,
    description: step.description,
    estimatedMinutes: step.estimatedMinutes,
    dueDate,
    dueTime: step.dueTime,
    priority: step.priority,
    assignedBy: actor.name,
    assignedTo: step.assignedTo,
    createdByUserId: actor.uid,
    assignedToUserId: step.assignedTo === "Ambos" ? undefined : getAppUserByName(step.assignedTo).uid,
    assignedToUserIds: assigneeIds,
    isUnassigned: false,
    isPrivate: false,
    lastModifiedByUserId: actor.uid,
    status: "pending",
    recurrence: { type: "none", interval: 1 },
    dependencyChainId: chain.id,
    dependencyCycleId: cycleId,
    dependencyCycleDueDate: cycleDueDate,
    dependencyStepIndex: stepIndex,
    dependencyStepCount: chain.steps.length,
    dependencyParentTaskId: parentTaskId,
    source: "dependency",
    createdAt: activatedAt,
    updatedAt: activatedAt,
  };
};

export const getProjectedRecurrenceDates = (
  firstDate: string,
  recurrence: DependencyChain["recurrence"],
  rangeStart: string,
  rangeEnd: string,
  limit = 400,
): string[] => {
  const dates: string[] = [];
  let current = firstDate;
  let occurrenceIndex = 1;
  for (let guard = 0; guard < limit && current <= rangeEnd; guard += 1) {
    if (current >= rangeStart && (!recurrence.endDate || current <= recurrence.endDate)) dates.push(current);
    if (recurrence.type === "none") break;
    const next = getNextRecurrenceOccurrence(current, recurrence, occurrenceIndex);
    if (next.dueDate <= current) break;
    current = next.dueDate;
    occurrenceIndex = next.occurrenceIndex;
    if (recurrence.endDate && current > recurrence.endDate) break;
  }
  return dates;
};
