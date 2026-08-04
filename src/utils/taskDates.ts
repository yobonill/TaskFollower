import type { Task, TaskRecurrence, TaskUrgency } from "../models/task";

const APP_LOCALE = "es-DO";

export const toDateInputValue = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

export const getTaskDate = (task: Pick<Task, "dueDate" | "dueTime">): Date => {
  const time = task.dueTime || "23:59";
  return new Date(`${task.dueDate}T${time}:00`);
};

export const isTaskOverdue = (task: Task): boolean =>
  task.status === "pending" && getTaskDate(task).getTime() < Date.now();

export const isTaskDueToday = (task: Task): boolean => {
  const due = getTaskDate(task);
  const today = new Date();
  return (
    task.status === "pending" &&
    due.getFullYear() === today.getFullYear() &&
    due.getMonth() === today.getMonth() &&
    due.getDate() === today.getDate()
  );
};

const urgencyWeight: Record<TaskUrgency, number> = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
};

export const sortPendingTasks = (tasks: Task[]): Task[] =>
  [...tasks].sort((a, b) => {
    const overdueDifference = Number(isTaskOverdue(b)) - Number(isTaskOverdue(a));
    if (overdueDifference !== 0) return overdueDifference;

    const dateDifference = getTaskDate(a).getTime() - getTaskDate(b).getTime();
    if (dateDifference !== 0) return dateDifference;

    const urgencyDifference = urgencyWeight[b.urgency] - urgencyWeight[a.urgency];
    if (urgencyDifference !== 0) return urgencyDifference;

    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

export const formatDueDate = (task: Task): string => {
  const due = getTaskDate(task);
  const now = new Date();
  const tomorrow = addDays(now, 1);
  const sameDay = (left: Date, right: Date) =>
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate();

  let dateText: string;
  if (sameDay(due, now)) dateText = "Hoy";
  else if (sameDay(due, tomorrow)) dateText = "Mañana";
  else {
    dateText = new Intl.DateTimeFormat(APP_LOCALE, {
      month: "short",
      day: "numeric",
      year: due.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    }).format(due);
  }

  if (!task.dueTime) return dateText;

  const timeText = new Intl.DateTimeFormat(APP_LOCALE, {
    hour: "numeric",
    minute: "2-digit",
  }).format(due);
  return `${dateText}, ${timeText}`;
};

export const formatDuration = (minutes: number): string => {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} h ${remainder} min` : `${hours} h`;
};

export const getNextDueDate = (
  currentDueDate: string,
  recurrence: TaskRecurrence,
): string => {
  const date = new Date(`${currentDueDate}T12:00:00`);
  const interval = Math.max(1, recurrence.interval || 1);

  switch (recurrence.type) {
    case "daily":
      date.setDate(date.getDate() + interval);
      break;
    case "weekly":
      date.setDate(date.getDate() + interval * 7);
      break;
    case "monthly":
      date.setMonth(date.getMonth() + interval);
      break;
    case "none":
      break;
  }

  return toDateInputValue(date);
};
