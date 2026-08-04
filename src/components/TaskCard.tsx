import type { Task, UserName } from "../models/task";
import {
  formatDueDate,
  formatDuration,
  isTaskOverdue,
} from "../utils/taskDates";

interface TaskCardProps {
  task: Task;
  featured?: boolean;
  onComplete: (task: Task, completedBy: UserName) => void;
  onEdit: (task: Task) => void;
  activeUser: UserName;
}

const urgencyLabels = {
  low: "Baja",
  normal: "Normal",
  high: "Alta",
  critical: "Crítica",
};

const formatRecurrence = (task: Task): string => {
  const { type, interval } = task.recurrence;
  const amount = Math.max(1, interval);

  if (type === "daily") return amount === 1 ? "Cada día" : `Cada ${amount} días`;
  if (type === "weekly") return amount === 1 ? "Cada semana" : `Cada ${amount} semanas`;
  if (type === "monthly") return amount === 1 ? "Cada mes" : `Cada ${amount} meses`;
  return "";
};

export function TaskCard({
  task,
  featured = false,
  onComplete,
  onEdit,
  activeUser,
}: TaskCardProps) {
  const overdue = isTaskOverdue(task);

  return (
    <article
      className={`task-card urgency-${task.urgency} ${featured ? "task-card-featured" : ""}`}
    >
      <div className="task-card-topline">
        {featured && <span className="next-label">Siguiente</span>}
        <span className="urgency-label">{urgencyLabels[task.urgency]}</span>
        {overdue && <span className="overdue-label">Vencida</span>}
        {task.recurrence.type !== "none" && (
          <span className="recurrence-label">↻ {formatRecurrence(task)}</span>
        )}
      </div>

      <h2>{task.name}</h2>
      {task.description && <p className="task-description">{task.description}</p>}

      <div className="task-meta-grid">
        <div>
          <span>Fecha límite</span>
          <strong>{formatDueDate(task)}</strong>
        </div>
        <div>
          <span>Tiempo estimado</span>
          <strong>{formatDuration(task.estimatedMinutes)}</strong>
        </div>
        <div>
          <span>Asignada a</span>
          <strong>{task.assignedTo}</strong>
        </div>
      </div>

      <div className="task-actions">
        <button className="button button-primary" onClick={() => onComplete(task, activeUser)}>
          ✓ Completar
        </button>
        <button className="button button-secondary" onClick={() => onEdit(task)}>
          Editar
        </button>
      </div>
    </article>
  );
}
