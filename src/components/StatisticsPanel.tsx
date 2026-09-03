import { useMemo, useState } from "react";
import type { PapipointsTransaction } from "../models/gamification";
import { USERS, type Task, type UserName } from "../models/task";
import { getTaskDate } from "../utils/taskDates";
import { isTaskAssignedTo } from "../utils/taskAssignment";

const DAY_MS = 86_400_000;
type StatisticsPeriod = 30 | 90 | "all";

interface StatisticsPanelProps {
  tasks: Task[];
  transactions: PapipointsTransaction[];
}

interface UserConsistencyStats {
  userName: UserName;
  completed: number;
  completedWithDeadline: number;
  onTime: number;
  lateCompleted: number;
  cancelled: number;
  overduePending: number;
  averageLateDays: number;
  onTimePercent: number | null;
  completionPercent: number | null;
}

interface DifficultTaskStats {
  key: string;
  name: string;
  assignees: Set<string>;
  occurrences: number;
  completed: number;
  cancelled: number;
  overdueOccurrences: number;
  overduePending: number;
  totalOverdueDays: number;
  completionDaysTotal: number;
  completedWithDuration: number;
  score: number;
}

const formatPercent = (value: number | null): string =>
  value === null ? "—" : `${Math.round(value)}%`;

const formatDays = (value: number): string => {
  if (value <= 0) return "0 días";
  const rounded = Math.round(value * 10) / 10;
  return `${rounded.toLocaleString("es-DO", { maximumFractionDigits: 1 })} ${rounded === 1 ? "día" : "días"}`;
};

const normalizeTaskName = (value: string): string =>
  value.trim().toLocaleLowerCase("es-DO").replace(/\s+/g, " ");

const getClosedAt = (task: Task): string | undefined =>
  task.status === "done"
    ? task.completedAt
    : task.status === "cancelled"
      ? task.cancelledAt
      : undefined;

const getCalendarOverdueDays = (task: Task, now: Date): number => {
  const due = getTaskDate(task);
  if (!due) return 0;

  const end = task.status === "done"
    ? task.completedAt ? new Date(task.completedAt) : null
    : task.status === "cancelled"
      ? task.cancelledAt ? new Date(task.cancelledAt) : null
      : now;

  if (!end || Number.isNaN(end.getTime()) || end.getTime() <= due.getTime()) return 0;
  return (end.getTime() - due.getTime()) / DAY_MS;
};

const getCompletionDays = (task: Task): number => {
  if (task.status !== "done" || !task.completedAt) return 0;
  const created = new Date(task.createdAt);
  const completed = new Date(task.completedAt);
  if (Number.isNaN(created.getTime()) || Number.isNaN(completed.getTime())) return 0;
  return Math.max(0, (completed.getTime() - created.getTime()) / DAY_MS);
};

export function StatisticsPanel({ tasks, transactions }: StatisticsPanelProps) {
  const [period, setPeriod] = useState<StatisticsPeriod>(30);

  const now = useMemo(() => new Date(), []);
  const cutoff = useMemo(() => {
    if (period === "all") return null;
    return new Date(now.getTime() - period * DAY_MS);
  }, [now, period]);

  const overduePenaltyDaysByTask = useMemo(() => {
    const byTask = new Map<string, Set<string>>();
    for (const transaction of transactions) {
      if (transaction.type !== "task_overdue" || !transaction.taskId) continue;
      const set = byTask.get(transaction.taskId) || new Set<string>();
      const id = transaction.id;
      const dayKey = id.startsWith("task-overdue-day:") && id.lastIndexOf(":") > 0
        ? id.slice(0, id.lastIndexOf(":"))
        : `legacy:${transaction.createdAt.slice(0, 10)}`;
      set.add(dayKey);
      byTask.set(transaction.taskId, set);
    }
    return byTask;
  }, [transactions]);

  const comparableTasks = useMemo(
    () => tasks.filter((task) =>
      (task.taskType || "normal") === "normal" &&
      !task.isPrivate &&
      !task.isUnassigned &&
      Boolean(task.name.trim()),
    ),
    [tasks],
  );

  const tasksInPeriod = useMemo(() => comparableTasks.filter((task) => {
    if (!cutoff || task.status === "pending") return true;
    const closedAt = getClosedAt(task);
    if (!closedAt) return false;
    const closed = new Date(closedAt);
    return !Number.isNaN(closed.getTime()) && closed.getTime() >= cutoff.getTime();
  }), [comparableTasks, cutoff]);

  const getHistoricalOverdueDays = (task: Task): number =>
    overduePenaltyDaysByTask.get(task.id)?.size || 0;

  const getEffectiveOverdueDays = (task: Task): number =>
    Math.max(getCalendarOverdueDays(task, now), getHistoricalOverdueDays(task));

  const userStats = useMemo<UserConsistencyStats[]>(() => USERS.map((userName) => {
    const assigned = tasksInPeriod.filter((task) => isTaskAssignedTo(task, userName));
    const completed = assigned.filter((task) => task.status === "done" && task.completedAt);
    const completedWithDeadline = completed.filter((task) => Boolean(getTaskDate(task)));
    const onTime = completedWithDeadline.filter((task) => getEffectiveOverdueDays(task) === 0);
    const lateCompleted = completedWithDeadline.filter((task) => getEffectiveOverdueDays(task) > 0);
    const cancelled = assigned.filter((task) => task.status === "cancelled");
    const overduePending = assigned.filter(
      (task) => task.status === "pending" && getCalendarOverdueDays(task, now) > 0,
    );
    const lateDays = lateCompleted.reduce(
      (total, task) => total + getEffectiveOverdueDays(task),
      0,
    );
    const resolved = completed.length + cancelled.length;

    return {
      userName,
      completed: completed.length,
      completedWithDeadline: completedWithDeadline.length,
      onTime: onTime.length,
      lateCompleted: lateCompleted.length,
      cancelled: cancelled.length,
      overduePending: overduePending.length,
      averageLateDays: lateCompleted.length ? lateDays / lateCompleted.length : 0,
      onTimePercent: completedWithDeadline.length
        ? (onTime.length / completedWithDeadline.length) * 100
        : null,
      completionPercent: resolved ? (completed.length / resolved) * 100 : null,
    };
  }), [tasksInPeriod, overduePenaltyDaysByTask, now]);

  const difficultTasks = useMemo(() => {
    const groups = new Map<string, DifficultTaskStats>();

    for (const task of tasksInPeriod) {
      const normalizedName = normalizeTaskName(task.name);
      const key = task.recurrenceSeriesId
        ? `series:${task.recurrenceSeriesId}`
        : `name:${normalizedName}`;
      const current = groups.get(key) || {
        key,
        name: task.name.trim(),
        assignees: new Set<string>(),
        occurrences: 0,
        completed: 0,
        cancelled: 0,
        overdueOccurrences: 0,
        overduePending: 0,
        totalOverdueDays: 0,
        completionDaysTotal: 0,
        completedWithDuration: 0,
        score: 0,
      };

      current.occurrences += 1;
      current.assignees.add(task.assignedTo);
      if (task.status === "done") current.completed += 1;
      if (task.status === "cancelled") current.cancelled += 1;

      const overdueDays = getEffectiveOverdueDays(task);
      if (overdueDays > 0) {
        current.overdueOccurrences += 1;
        current.totalOverdueDays += overdueDays;
      }
      if (task.status === "pending" && getCalendarOverdueDays(task, now) > 0) {
        current.overduePending += 1;
      }

      const completionDays = getCompletionDays(task);
      if (task.status === "done" && task.completedAt) {
        current.completionDaysTotal += completionDays;
        current.completedWithDuration += 1;
      }

      groups.set(key, current);
    }

    return [...groups.values()]
      .map((group) => {
        const averageCompletionDays = group.completedWithDuration
          ? group.completionDaysTotal / group.completedWithDuration
          : 0;
        const score =
          group.overdueOccurrences * 50 +
          group.totalOverdueDays * 10 +
          group.overduePending * 75 +
          group.cancelled * 25 +
          averageCompletionDays;
        return { ...group, score };
      })
      .filter((group) => group.completed > 0 || group.cancelled > 0 || group.overduePending > 0)
      .sort((a, b) => b.score - a.score || b.occurrences - a.occurrences)
      .slice(0, 8);
  }, [tasksInPeriod, overduePenaltyDaysByTask, now]);

  const periodLabel = period === "all" ? "todo el historial" : `los últimos ${period} días`;

  return (
    <section className="statistics-page">
      <div className="manage-heading statistics-heading">
        <div>
          <span className="eyebrow">Seguimiento y hábitos</span>
          <h1>Estadísticas</h1>
          <p>Compara la constancia de cada persona e identifica las tareas que acumulan más atrasos o tardan más en completarse.</p>
        </div>
        <label className="statistics-period-field">
          <span>Período</span>
          <select value={period} onChange={(event) => {
            const value = event.target.value;
            setPeriod(value === "all" ? "all" : Number(value) as 30 | 90);
          }}>
            <option value="30">Últimos 30 días</option>
            <option value="90">Últimos 90 días</option>
            <option value="all">Todo el historial</option>
          </select>
        </label>
      </div>

      <p className="statistics-privacy-note">
        La comparación usa tareas normales no privadas. Las tareas compartidas cuentan para ambos; las tareas privadas no se incluyen para mantener una comparación consistente y respetar su privacidad.
      </p>

      <section className="statistics-section">
        <div className="statistics-section-heading">
          <div>
            <span className="eyebrow">Constancia</span>
            <h2>Rendimiento por persona</h2>
          </div>
          <small>Resultados cerrados de {periodLabel}; las tareas pendientes actuales se mantienen visibles.</small>
        </div>

        <div className="consistency-grid">
          {userStats.map((stats) => (
            <article className="consistency-card" key={stats.userName}>
              <div className="consistency-card-heading">
                <div>
                  <span>Persona</span>
                  <h3>{stats.userName}</h3>
                </div>
                <div className="consistency-score">
                  <strong>{formatPercent(stats.onTimePercent)}</strong>
                  <small>A tiempo</small>
                </div>
              </div>

              <div className="statistics-metric-grid">
                <div><strong>{stats.completed}</strong><span>Completadas</span></div>
                <div><strong>{formatPercent(stats.completionPercent)}</strong><span>Finalización</span></div>
                <div><strong>{stats.overduePending}</strong><span>Vencidas ahora</span></div>
                <div><strong>{formatDays(stats.averageLateDays)}</strong><span>Prom. atraso</span></div>
              </div>

              <div className="consistency-detail">
                <span>{stats.onTime} a tiempo</span>
                <span>{stats.lateCompleted} completadas tarde</span>
                <span>{stats.cancelled} canceladas</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="statistics-section">
        <div className="statistics-section-heading">
          <div>
            <span className="eyebrow">Fricción</span>
            <h2>Tareas más difíciles de completar</h2>
          </div>
          <small>Se priorizan recurrencia de vencimientos, días de atraso, cancelaciones y tiempo de finalización.</small>
        </div>

        {difficultTasks.length ? (
          <div className="difficult-task-list">
            {difficultTasks.map((task, index) => {
              const overdueRate = task.occurrences
                ? (task.overdueOccurrences / task.occurrences) * 100
                : 0;
              const averageOverdueDays = task.overdueOccurrences
                ? task.totalOverdueDays / task.overdueOccurrences
                : 0;
              const averageCompletionDays = task.completedWithDuration
                ? task.completionDaysTotal / task.completedWithDuration
                : 0;
              return (
                <article className="difficult-task-row" key={task.key}>
                  <span className="difficulty-rank">#{index + 1}</span>
                  <div className="difficulty-main">
                    <strong>{task.name}</strong>
                    <small>
                      {task.assignees.size > 1 ? "Varios responsables" : [...task.assignees][0]} · {task.occurrences} {task.occurrences === 1 ? "registro" : "registros"}
                    </small>
                  </div>
                  <div className="difficulty-metrics">
                    <span><b>{Math.round(overdueRate)}%</b> con atraso</span>
                    <span><b>{formatDays(averageOverdueDays)}</b> atraso prom.</span>
                    <span><b>{formatDays(averageCompletionDays)}</b> para completar</span>
                    {task.overduePending > 0 && <span className="difficulty-alert"><b>{task.overduePending}</b> vencida ahora</span>}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="section-empty">Todavía no hay suficiente historial de tareas completadas, canceladas o vencidas para identificar patrones.</p>
        )}
      </section>
    </section>
  );
}
