import type {
  Task,
  TaskPriority,
  TaskRecurrence,
  WeekdayNumber,
} from "../models/task";

const APP_LOCALE = "es-DO";

export const WEEKDAY_OPTIONS: ReadonlyArray<{
  value: WeekdayNumber;
  shortLabel: string;
  label: string;
}> = [
  { value: 1, shortLabel: "L", label: "Lunes" },
  { value: 2, shortLabel: "M", label: "Martes" },
  { value: 3, shortLabel: "X", label: "Miércoles" },
  { value: 4, shortLabel: "J", label: "Jueves" },
  { value: 5, shortLabel: "V", label: "Viernes" },
  { value: 6, shortLabel: "S", label: "Sábado" },
  { value: 7, shortLabel: "D", label: "Domingo" },
];

export const WEEKDAY_PRESETS = {
  weekdays: [1, 2, 3, 4, 5] as WeekdayNumber[],
  weekend: [6, 7] as WeekdayNumber[],
  everyDay: [1, 2, 3, 4, 5, 6, 7] as WeekdayNumber[],
};

export const normalizeWeekdays = (values?: readonly number[]): WeekdayNumber[] =>
  [...new Set((values || []).filter((value) => value >= 1 && value <= 7))]
    .sort((a, b) => a - b) as WeekdayNumber[];

const jsDayToWeekdayNumber = (day: number): WeekdayNumber =>
  (day === 0 ? 7 : day) as WeekdayNumber;

const parseDateOnly = (value: string): Date | null => {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const parseDateLike = (value?: string): Date | null => {
  if (!value) return null;
  const dateOnlyMatch = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = dateOnlyMatch ? parseDateOnly(value) : new Date(value);
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

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

const addMonthsClamped = (date: Date, months: number): Date => {
  const next = new Date(date);
  const originalDay = next.getDate();
  next.setDate(1);
  next.setMonth(next.getMonth() + months);
  const lastDayOfTargetMonth = new Date(
    next.getFullYear(),
    next.getMonth() + 1,
    0,
    12,
  ).getDate();
  next.setDate(Math.min(originalDay, lastDayOfTargetMonth));
  return next;
};

export const getTaskDate = (
  task: Pick<Task, "dueDate" | "dueTime">,
): Date | null => {
  if (!task.dueDate) return null;
  const time = task.dueTime || "23:59";
  const date = new Date(`${task.dueDate}T${time}:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const isTaskOverdue = (task: Task): boolean => {
  const due = getTaskDate(task);
  return task.status === "pending" && Boolean(due && due.getTime() < Date.now());
};

export const isTaskDueToday = (task: Task): boolean => {
  const due = getTaskDate(task);
  if (!due || task.status !== "pending") return false;
  const today = new Date();
  return (
    due.getFullYear() === today.getFullYear() &&
    due.getMonth() === today.getMonth() &&
    due.getDate() === today.getDate()
  );
};

const priorityWeight: Record<TaskPriority, number> = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
};

export const sortPendingTasks = (tasks: Task[]): Task[] =>
  [...tasks].sort((a, b) => {
    const overdueDifference = Number(isTaskOverdue(b)) - Number(isTaskOverdue(a));
    if (overdueDifference !== 0) return overdueDifference;

    const aDate = getTaskDate(a)?.getTime() ?? Number.POSITIVE_INFINITY;
    const bDate = getTaskDate(b)?.getTime() ?? Number.POSITIVE_INFINITY;
    const dateDifference = aDate - bDate;
    if (dateDifference !== 0) return dateDifference;

    const aPriority = a.priority ? priorityWeight[a.priority] : 0;
    const bPriority = b.priority ? priorityWeight[b.priority] : 0;
    const priorityDifference = bPriority - aPriority;
    if (priorityDifference !== 0) return priorityDifference;

    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

export const formatDueDate = (task: Task): string => {
  const due = getTaskDate(task);
  if (!due) return "Sin fecha límite";

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

export const formatDuration = (minutes?: number): string => {
  if (!minutes || minutes <= 0) return "Sin estimar";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} h ${remainder} min` : `${hours} h`;
};

/**
 * Returns the first selected weekday on or after the requested start date.
 * Non-weekday recurrence modes keep the requested date unchanged.
 */
export const getRecurrenceStartDate = (
  requestedDueDate: string,
  recurrence: TaskRecurrence,
): string => {
  if (recurrence.type !== "weekdays") return requestedDueDate;

  const weekdays = normalizeWeekdays(recurrence.weekdays);
  const date = parseDateOnly(requestedDueDate);
  if (!date || !weekdays.length) return requestedDueDate;

  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = addDays(date, offset);
    if (weekdays.includes(jsDayToWeekdayNumber(candidate.getDay()))) {
      return toDateInputValue(candidate);
    }
  }

  return requestedDueDate;
};

/**
 * Calculates the following recurrence date. Every recurrence mode uses the
 * later of the current due date and the completion date as its scheduling base.
 * This keeps only one active occurrence at a time and guarantees that finishing
 * an overdue occurrence never generates another occurrence that is already in
 * the past. Early/on-time completion still preserves the original cadence.
 */
export const getNextDueDate = (
  currentDueDate: string,
  recurrence: TaskRecurrence,
  completedAt?: string,
): string => {
  const current = parseDateOnly(currentDueDate);
  if (!current) return currentDueDate;

  const interval = Math.max(1, recurrence.interval || 1);
  let base = current;
  const completed = parseDateLike(completedAt);
  if (completed) {
    const completedDate = new Date(
      completed.getFullYear(),
      completed.getMonth(),
      completed.getDate(),
      12,
    );
    if (completedDate.getTime() > base.getTime()) base = completedDate;
  }

  if (recurrence.type === "weekdays") {
    const weekdays = normalizeWeekdays(recurrence.weekdays);
    if (!weekdays.length) return currentDueDate;

    for (let offset = 1; offset <= 7; offset += 1) {
      const candidate = addDays(base, offset);
      if (weekdays.includes(jsDayToWeekdayNumber(candidate.getDay()))) {
        return toDateInputValue(candidate);
      }
    }

    return currentDueDate;
  }

  let next = new Date(base);
  switch (recurrence.type) {
    case "daily":
      next = addDays(base, interval);
      break;
    case "weekly":
      next = addDays(base, interval * 7);
      break;
    case "monthly":
      next = addMonthsClamped(base, interval);
      break;
    case "none":
      break;
  }

  return toDateInputValue(next);
};


export interface NextRecurrenceOccurrence {
  dueDate: string;
  occurrenceIndex: number;
}

/**
 * Calculates the next active occurrence for a recurring task while preserving
 * the "one active occurrence at a time" model.
 *
 * Multiple occurrences on the same scheduled day are created sequentially.
 * If an old occurrence is completed late, historical missed occurrences are
 * never generated. Daily and selected-weekday schedules may resume later on
 * the completion day; other schedules advance to their next valid date.
 */
export const getNextRecurrenceOccurrence = (
  currentDueDate: string,
  recurrence: TaskRecurrence,
  currentOccurrenceIndex = 1,
  completedAt?: string,
): NextRecurrenceOccurrence => {
  const occurrencesPerDay = Math.max(
    1,
    Math.floor(Number(recurrence.occurrencesPerDay) || 1),
  );
  const occurrenceIndex = Math.min(
    occurrencesPerDay,
    Math.max(1, Math.floor(Number(currentOccurrenceIndex) || 1)),
  );
  const completed = parseDateLike(completedAt);
  const completedDateKey = completed ? toDateInputValue(completed) : currentDueDate;

  // On-time/early completion: finish all occurrences for the scheduled day
  // before advancing to the next scheduled date.
  if (completedDateKey <= currentDueDate) {
    if (occurrenceIndex < occurrencesPerDay) {
      return {
        dueDate: currentDueDate,
        occurrenceIndex: occurrenceIndex + 1,
      };
    }

    return {
      dueDate: getNextDueDate(currentDueDate, recurrence, completedAt),
      occurrenceIndex: 1,
    };
  }

  // Late completion: never generate missed historical occurrences. For daily
  // tasks (every day) or a selected weekday that includes today, the overdue
  // occurrence counts as the first execution handled today and the series may
  // continue with occurrence 2 today.
  const completedWeekday = completed
    ? jsDayToWeekdayNumber(completed.getDay())
    : undefined;
  const canResumeToday =
    occurrencesPerDay > 1 &&
    ((recurrence.type === "daily" &&
      Math.max(1, recurrence.interval || 1) === 1) ||
      (recurrence.type === "weekdays" &&
        completedWeekday !== undefined &&
        normalizeWeekdays(recurrence.weekdays).includes(completedWeekday)));

  if (canResumeToday) {
    return {
      dueDate: completedDateKey,
      occurrenceIndex: 2,
    };
  }

  return {
    dueDate: getNextDueDate(currentDueDate, recurrence, completedAt),
    occurrenceIndex: 1,
  };
};

export const formatWeekdayRecurrence = (weekdays?: readonly number[]): string => {
  const normalized = normalizeWeekdays(weekdays);
  if (!normalized.length) return "Días de la semana";
  if (normalized.join(",") === WEEKDAY_PRESETS.weekdays.join(",")) {
    return "Lunes a viernes";
  }
  if (normalized.join(",") === WEEKDAY_PRESETS.weekend.join(",")) {
    return "Fin de semana";
  }
  if (normalized.length === 7) return "Todos los días";

  const labels: Record<WeekdayNumber, string> = {
    1: "Lun",
    2: "Mar",
    3: "Mié",
    4: "Jue",
    5: "Vie",
    6: "Sáb",
    7: "Dom",
  };
  return normalized.map((day) => labels[day]).join(", ");
};
