import { useEffect, useRef, useState } from "react";
import type { Task, TaskAssignee, TaskPriority } from "../models/task";
import {
  formatDueDate,
  formatDuration,
  getNextDueDate,
  isTaskOverdue,
  toDateInputValue,
} from "../utils/taskDates";

interface TaskCardProps {
  task: Task;
  featured?: boolean;
  onComplete: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDuplicate: (task: Task) => void;
  onReassign: (task: Task, assignedTo: TaskAssignee) => void;
  onPostpone: (task: Task, dueDate: string) => void;
  onCancelTask: (task: Task) => void;
  onDelete: (task: Task) => void;
}

const priorityLabels: Record<TaskPriority, string> = {
  low: "Baja",
  normal: "Normal",
  high: "Alta",
  critical: "Crítica",
};

const addDays = (amount: number): string => {
  const date = new Date();
  date.setDate(date.getDate() + amount);
  return toDateInputValue(date);
};

const formatRecurrence = (task: Task): string => {
  const { type, interval, endDate } = task.recurrence;
  const amount = Math.max(1, interval);

  let label = "";
  if (type === "daily") label = amount === 1 ? "Cada día" : `Cada ${amount} días`;
  if (type === "weekly") label = amount === 1 ? "Cada semana" : `Cada ${amount} semanas`;
  if (type === "monthly") label = amount === 1 ? "Cada mes" : `Cada ${amount} meses`;
  if (label && endDate) {
    const end = new Date(`${endDate}T12:00:00`);
    label += ` hasta ${new Intl.DateTimeFormat("es-DO", {
      day: "numeric",
      month: "short",
    }).format(end)}`;
  }
  return label;
};

const isFinalRecurrence = (task: Task): boolean => {
  if (
    task.recurrence.type === "none" ||
    !task.recurrence.endDate ||
    !task.dueDate
  ) {
    return false;
  }
  return (
    getNextDueDate(task.dueDate, task.recurrence) > task.recurrence.endDate
  );
};

export function TaskCard({
  task,
  featured = false,
  onComplete,
  onEdit,
  onDuplicate,
  onReassign,
  onPostpone,
  onCancelTask,
  onDelete,
}: TaskCardProps) {
  const overdue = isTaskOverdue(task);
  const priority = task.priority || "normal";
  const [menuOpen, setMenuOpen] = useState(false);
  const [showPostpone, setShowPostpone] = useState(false);
  const [customDate, setCustomDate] = useState(task.dueDate || "");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
        setShowPostpone(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuOpen]);

  const runAndClose = (action: () => void) => {
    action();
    setMenuOpen(false);
    setShowPostpone(false);
  };

  return (
    <article
      className={`task-card priority-${priority} ${featured ? "task-card-featured" : ""}`}
    >
      <div className="task-card-header">
        <div className="task-card-topline">
          {featured && <span className="next-label">Siguiente</span>}
          <span className="priority-label">Prioridad {priorityLabels[priority]}</span>
          {task.assignedTo === "Ambos" && (
            <span className="shared-task-label">👥 Compartida</span>
          )}
          {overdue && <span className="overdue-label">Vencida</span>}
          {task.recurrence.type !== "none" && (
            <span className="recurrence-label">↻ {formatRecurrence(task)}</span>
          )}
          {isFinalRecurrence(task) && (
            <span className="last-recurrence-label">Última repetición</span>
          )}
        </div>

        <div className="task-menu-wrapper" ref={menuRef}>
          <button
            type="button"
            className="task-menu-button"
            aria-label={`Opciones de ${task.name}`}
            aria-expanded={menuOpen}
            onClick={() => {
              setMenuOpen((current) => !current);
              setShowPostpone(false);
            }}
          >
            ⋮
          </button>

          {menuOpen && (
            <div className="task-menu" role="menu">
              {!showPostpone ? (
                <>
                  <button type="button" onClick={() => runAndClose(() => onEdit(task))}>
                    Editar
                  </button>
                  <button type="button" onClick={() => runAndClose(() => onDuplicate(task))}>
                    Duplicar
                  </button>
                  {task.assignedTo === "Ambos" ? (
                    <>
                      <button
                        type="button"
                        onClick={() => runAndClose(() => onReassign(task, "Yorki"))}
                      >
                        Asignar solo a Yorki
                      </button>
                      <button
                        type="button"
                        onClick={() => runAndClose(() => onReassign(task, "Yisel"))}
                      >
                        Asignar solo a Yisel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          runAndClose(() =>
                            onReassign(
                              task,
                              task.assignedTo === "Yorki" ? "Yisel" : "Yorki",
                            ),
                          )
                        }
                      >
                        Asignar a {task.assignedTo === "Yorki" ? "Yisel" : "Yorki"}
                      </button>
                      <button
                        type="button"
                        onClick={() => runAndClose(() => onReassign(task, "Ambos"))}
                      >
                        Convertir en tarea compartida
                      </button>
                    </>
                  )}
                  <button type="button" onClick={() => setShowPostpone(true)}>
                    Posponer…
                  </button>
                  <button
                    type="button"
                    className="menu-warning"
                    onClick={() => runAndClose(() => onCancelTask(task))}
                  >
                    Cancelar tarea
                  </button>
                  <button
                    type="button"
                    className="menu-danger"
                    onClick={() => runAndClose(() => onDelete(task))}
                  >
                    Eliminar
                  </button>
                </>
              ) : (
                <div className="postpone-menu">
                  <button
                    className="menu-back"
                    type="button"
                    onClick={() => setShowPostpone(false)}
                  >
                    ← Posponer hasta
                  </button>
                  <button type="button" onClick={() => runAndClose(() => onPostpone(task, addDays(1)))}>
                    Mañana
                  </button>
                  <button type="button" onClick={() => runAndClose(() => onPostpone(task, addDays(2)))}>
                    En 2 días
                  </button>
                  <button type="button" onClick={() => runAndClose(() => onPostpone(task, addDays(7)))}>
                    Próxima semana
                  </button>
                  <label className="postpone-date">
                    <span>Otra fecha</span>
                    <input
                      type="date"
                      value={customDate}
                      onChange={(event) => setCustomDate(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="postpone-apply"
                    disabled={!customDate}
                    onClick={() => runAndClose(() => onPostpone(task, customDate))}
                  >
                    Aplicar fecha
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <h2>{task.name}</h2>
      {task.description && <p className="task-description">{task.description}</p>}

      <div className="task-compact-meta">
        <strong>{formatDueDate(task)}</strong>
        <span>·</span>
        <span>{formatDuration(task.estimatedMinutes)}</span>
        <span>·</span>
        <span>{task.assignedTo}</span>
      </div>

      <button
        className="button button-primary complete-button"
        onClick={() => onComplete(task)}
      >
        ✓ Completar
      </button>
    </article>
  );
}
