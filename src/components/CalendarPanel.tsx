import { useMemo, useState } from "react";
import type { DependencyChain } from "../models/dependency";
import type { Task, UserFilter } from "../models/task";
import { formatDuration, getNextRecurrenceOccurrence, isTaskOverdue, toDateInputValue } from "../utils/taskDates";
import { getProjectedRecurrenceDates } from "../utils/dependencyChains";

interface CalendarItem {
  id: string;
  date: string;
  name: string;
  assignedTo: Task["assignedTo"];
  minutes: number;
  conditional: boolean;
  waitingFor?: string;
  task?: Task;
  recurring?: boolean;
}

const monthBounds = (cursor: Date) => {
  const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1, 12);
  const end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 12);
  return { start, end, startKey: toDateInputValue(start), endKey: toDateInputValue(end) };
};

const formatDayHeading = (dateKey: string) => new Intl.DateTimeFormat("es-DO", {
  weekday: "long", day: "numeric", month: "long", year: "numeric",
}).format(new Date(`${dateKey}T12:00:00`));

const priorityLabels = { low: "baja", normal: "normal", high: "alta", critical: "crítica" } as const;

export function CalendarPanel({ tasks, chains }: { tasks: Task[]; chains: DependencyChain[] }) {
  const [cursor, setCursor] = useState(() => new Date());
  const [filter, setFilter] = useState<UserFilter>("all");
  const [selectedDate, setSelectedDate] = useState(() => toDateInputValue(new Date()));
  const bounds = monthBounds(cursor);

  const items = useMemo(() => {
    const result: CalendarItem[] = [];
    const physicalKeys = new Set<string>();
    tasks.forEach((task) => {
      if (task.status === "cancelled" || !task.dueDate || (filter !== "all" && task.assignedTo !== filter && task.assignedTo !== "Ambos")) return;
      const key = `${task.recurrenceSeriesId || task.id}:${task.dueDate}:${task.recurrenceOccurrenceIndex || 1}`;
      physicalKeys.add(key);
      if (task.dueDate >= bounds.startKey && task.dueDate <= bounds.endKey) {
        result.push({ id: task.id, date: task.dueDate, name: task.name, assignedTo: task.assignedTo, minutes: task.estimatedMinutes || 0, conditional: false, task });
      }
    });

    const activeSeries = new Map<string, Task>();
    tasks.filter((task) => task.status === "pending" && task.recurrence.type !== "none" && task.dueDate).forEach((task) => activeSeries.set(task.recurrenceSeriesId || task.id, task));
    activeSeries.forEach((task, seriesId) => {
      let date = task.dueDate!;
      let occurrence = task.recurrenceOccurrenceIndex || 1;
      for (let guard = 0; guard < 400 && date <= bounds.endKey; guard += 1) {
        if (date >= bounds.startKey && !physicalKeys.has(`${seriesId}:${date}:${occurrence}`) && (filter === "all" || task.assignedTo === filter || task.assignedTo === "Ambos")) {
          result.push({ id: `projection:${seriesId}:${date}:${occurrence}`, date, name: task.name, assignedTo: task.recurrence.defaultAssignedTo || task.assignedTo, minutes: task.estimatedMinutes || 0, conditional: false, recurring: true });
        }
        const next = getNextRecurrenceOccurrence(date, task.recurrence, occurrence);
        if (next.dueDate <= date || (task.recurrence.endDate && next.dueDate > task.recurrence.endDate)) break;
        date = next.dueDate; occurrence = next.occurrenceIndex;
      }
    });

    chains.filter((chain) => chain.active).forEach((chain) => {
      const cycleDates = getProjectedRecurrenceDates(chain.firstDueDate, chain.recurrence, bounds.startKey, bounds.endKey);
      cycleDates.forEach((cycleDate) => {
        const cycleTasks = tasks.filter((task) => task.dependencyChainId === chain.id && task.dependencyCycleDueDate === cycleDate);
        const activated = new Set(cycleTasks.map((task) => task.dependencyStepIndex));
        chain.steps.forEach((step, index) => {
          if (activated.has(index) || (filter !== "all" && step.assignedTo !== filter && step.assignedTo !== "Ambos")) return;
          if (index === 0 && cycleTasks.length === 0) {
            if (chain.cycleMode === "overlap" && cycleDate > toDateInputValue(new Date())) {
              result.push({ id: `dependency-projection:${chain.id}:${cycleDate}`, date: cycleDate, name: step.name, assignedTo: step.assignedTo, minutes: step.estimatedMinutes, conditional: false, recurring: true });
            }
            return;
          }
          const prior = chain.steps[Math.max(0, index - 1)];
          result.push({ id: `conditional:${chain.id}:${cycleDate}:${index}`, date: cycleDate, name: step.name, assignedTo: step.assignedTo, minutes: step.estimatedMinutes, conditional: true, waitingFor: prior.name, recurring: chain.recurrence.type !== "none" });
        });
      });
    });
    return result;
  }, [bounds.endKey, bounds.startKey, chains, filter, tasks]);

  const days = useMemo(() => {
    const leading = (bounds.start.getDay() + 6) % 7;
    const cells: Array<string | null> = Array.from({ length: leading }, () => null);
    for (let day = 1; day <= bounds.end.getDate(); day += 1) cells.push(toDateInputValue(new Date(cursor.getFullYear(), cursor.getMonth(), day, 12)));
    while (cells.length % 7) cells.push(null);
    return cells;
  }, [bounds.end, bounds.start, cursor]);

  const selected = items.filter((item) => item.date === selectedDate);
  const confirmed = selected.filter((item) => !item.conditional);
  const conditional = selected.filter((item) => item.conditional);
  const confirmedMinutes = confirmed.reduce((sum, item) => sum + item.minutes, 0);
  const today = toDateInputValue(new Date());
  const overdueToday = selectedDate === today ? tasks.filter((task) => task.status === "pending" && task.dueDate && task.dueDate < today && isTaskOverdue(task) && (filter === "all" || task.assignedTo === filter || task.assignedTo === "Ambos")) : [];
  const changeMonth = (offset: number) => {
    const next = new Date(cursor.getFullYear(), cursor.getMonth() + offset, 1, 12);
    setCursor(next);
    setSelectedDate(toDateInputValue(next));
  };

  return <section className="calendar-page">
    <div className="manage-heading"><div><span className="eyebrow">Carga planificada</span><h1>Calendario</h1><p>Las tareas condicionales se muestran aparte y no aumentan el total confirmado.</p></div></div>
    <section className="task-list-panel calendar-panel">
      <div className="calendar-toolbar"><button className="button button-quiet" type="button" onClick={() => changeMonth(-1)}>←</button><h2>{new Intl.DateTimeFormat("es-DO", { month: "long", year: "numeric" }).format(cursor)}</h2><button className="button button-quiet" type="button" onClick={() => changeMonth(1)}>→</button></div>
      <div className="filter-chips calendar-filters">{(["all", "Yorki", "Yisel"] as UserFilter[]).map((value) => <button key={value} type="button" className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value === "all" ? "Todos" : value}</button>)}</div>
      <div className="calendar-weekdays">{["L", "M", "X", "J", "V", "S", "D"].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="calendar-grid">{days.map((date, index) => {
        if (!date) return <span className="calendar-empty" key={`empty:${index}`} />;
        const dateItems = items.filter((item) => item.date === date);
        const dateConfirmed = dateItems.filter((item) => !item.conditional);
        const minutes = dateConfirmed.reduce((sum, item) => sum + item.minutes, 0);
        return <button type="button" key={date} className={`calendar-day ${date === selectedDate ? "selected" : ""} ${date === today ? "today" : ""}`} onClick={() => setSelectedDate(date)}><strong>{Number(date.slice(-2))}</strong><span>{dateConfirmed.length} {dateConfirmed.length === 1 ? "tarea" : "tareas"}</span><small>{minutes ? formatDuration(minutes) : "0 min"}</small>{dateItems.some((item) => item.conditional) && <em>+ condicional</em>}</button>;
      })}</div>
    </section>
    <section className="task-list-panel calendar-details"><div className="list-heading"><div><h2>{formatDayHeading(selectedDate)}</h2><small>{confirmed.length} {confirmed.length === 1 ? "tarea" : "tareas"} · {formatDuration(confirmedMinutes)} estimadas</small></div></div>
      {(["Yorki", "Yisel", "Ambos"] as const).map((user) => { const userItems = confirmed.filter((item) => item.assignedTo === user); return userItems.length ? <div className="calendar-user-group" key={user}><h3>{user}</h3>{userItems.map((item) => <article key={item.id}><span>{item.name}</span><small>{formatDuration(item.minutes)}{item.recurring ? " · Recurrente" : ""}{item.task?.taskType === "dependency" || item.id.startsWith("dependency-projection:") ? " · Dependencia" : " · Normal"}{user === "Ambos" ? " · Compartida" : ""}{item.task && isTaskOverdue(item.task) ? " · Vencida" : ""}{item.task?.priority ? ` · Prioridad ${priorityLabels[item.task.priority]} · Papipuntos` : ""}</small></article>)}</div> : null; })}
      {overdueToday.length > 0 && <div className="calendar-overdue-debt"><h3>Pendientes vencidas</h3><p>No se suman otra vez al total de hoy; conservan su fecha original.</p>{overdueToday.map((task) => <span key={task.id}>{task.name} · {formatDuration(task.estimatedMinutes)}</span>)}</div>}
      {conditional.length > 0 && <div className="calendar-conditional"><h3>Condicional</h3>{conditional.map((item) => <article key={item.id}><span>{item.name} · {formatDuration(item.minutes)}</span><small>Esperando: {item.waitingFor}</small></article>)}</div>}
      {!confirmed.length && !conditional.length && !overdueToday.length && <p className="list-empty">No hay carga planificada para este día.</p>}
    </section>
  </section>;
}
