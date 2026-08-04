import { useEffect, useState, type FormEvent } from "react";
import {
  USERS,
  type RecurrenceType,
  type Task,
  type TaskUrgency,
  type UserName,
} from "../models/task";
import { toDateInputValue } from "../utils/taskDates";

interface TaskFormProps {
  editingTask: Task | null;
  defaultUser: UserName;
  onSave: (task: Task) => Promise<void>;
  onCancel: () => void;
}

interface FormState {
  name: string;
  description: string;
  estimatedMinutes: string;
  dueDate: string;
  dueTime: string;
  urgency: TaskUrgency;
  assignedBy: UserName;
  assignedTo: UserName;
  recurrenceType: RecurrenceType;
  recurrenceInterval: string;
}

const createInitialState = (defaultUser: UserName): FormState => ({
  name: "",
  description: "",
  estimatedMinutes: "15",
  dueDate: toDateInputValue(new Date()),
  dueTime: "",
  urgency: "normal",
  assignedBy: defaultUser,
  assignedTo: defaultUser,
  recurrenceType: "none",
  recurrenceInterval: "1",
});

export function TaskForm({
  editingTask,
  defaultUser,
  onSave,
  onCancel,
}: TaskFormProps) {
  const [form, setForm] = useState<FormState>(() => createInitialState(defaultUser));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editingTask) {
      setForm(createInitialState(defaultUser));
      return;
    }

    setForm({
      name: editingTask.name,
      description: editingTask.description,
      estimatedMinutes: String(editingTask.estimatedMinutes),
      dueDate: editingTask.dueDate,
      dueTime: editingTask.dueTime || "",
      urgency: editingTask.urgency,
      assignedBy: editingTask.assignedBy,
      assignedTo: editingTask.assignedTo,
      recurrenceType: editingTask.recurrence.type,
      recurrenceInterval: String(editingTask.recurrence.interval),
    });
  }, [defaultUser, editingTask]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) return;

    setSaving(true);
    const timestamp = new Date().toISOString();
    const task: Task = {
      id: editingTask?.id || crypto.randomUUID(),
      name: form.name.trim(),
      description: form.description.trim(),
      estimatedMinutes: Math.max(1, Number(form.estimatedMinutes) || 1),
      dueDate: form.dueDate,
      dueTime: form.dueTime || undefined,
      urgency: form.urgency,
      assignedBy: form.assignedBy,
      assignedTo: form.assignedTo,
      status: editingTask?.status || "pending",
      recurrence: {
        type: form.recurrenceType,
        interval: Math.max(1, Number(form.recurrenceInterval) || 1),
      },
      recurrenceSeriesId:
        form.recurrenceType === "none"
          ? undefined
          : editingTask?.recurrenceSeriesId || editingTask?.id || crypto.randomUUID(),
      createdAt: editingTask?.createdAt || timestamp,
      updatedAt: timestamp,
      completedAt: editingTask?.completedAt,
      completedBy: editingTask?.completedBy,
    };

    await onSave(task);
    setSaving(false);
  };

  return (
    <form className="task-form" onSubmit={handleSubmit}>
      <div className="form-heading">
        <div>
          <span className="eyebrow">Detalles de la tarea</span>
          <h2>{editingTask ? "Editar tarea" : "Crear una nueva tarea"}</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onCancel}
          aria-label="Cerrar formulario"
        >
          ×
        </button>
      </div>

      <label className="field field-wide">
        <span>Nombre de la tarea</span>
        <input
          autoFocus
          required
          value={form.name}
          onChange={(event) => update("name", event.target.value)}
          placeholder="¿Qué necesitas terminar?"
        />
      </label>

      <label className="field field-wide">
        <span>Descripción</span>
        <textarea
          rows={3}
          value={form.description}
          onChange={(event) => update("description", event.target.value)}
          placeholder="Detalles o instrucciones opcionales"
        />
      </label>

      <div className="form-grid">
        <label className="field">
          <span>Tiempo estimado (minutos)</span>
          <input
            required
            min="1"
            type="number"
            value={form.estimatedMinutes}
            onChange={(event) => update("estimatedMinutes", event.target.value)}
          />
        </label>

        <label className="field">
          <span>Urgencia</span>
          <select
            value={form.urgency}
            onChange={(event) => update("urgency", event.target.value as TaskUrgency)}
          >
            <option value="low">Baja</option>
            <option value="normal">Normal</option>
            <option value="high">Alta</option>
            <option value="critical">Crítica</option>
          </select>
        </label>

        <label className="field">
          <span>Fecha límite</span>
          <input
            required
            type="date"
            value={form.dueDate}
            onChange={(event) => update("dueDate", event.target.value)}
          />
        </label>

        <label className="field">
          <span>Hora límite (opcional)</span>
          <input
            type="time"
            value={form.dueTime}
            onChange={(event) => update("dueTime", event.target.value)}
          />
        </label>

        <label className="field">
          <span>Asignada por</span>
          <select
            value={form.assignedBy}
            onChange={(event) => update("assignedBy", event.target.value as UserName)}
          >
            {USERS.map((user) => (
              <option key={user}>{user}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Asignada a</span>
          <select
            value={form.assignedTo}
            onChange={(event) => update("assignedTo", event.target.value as UserName)}
          >
            {USERS.map((user) => (
              <option key={user}>{user}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Repetición</span>
          <select
            value={form.recurrenceType}
            onChange={(event) =>
              update("recurrenceType", event.target.value as RecurrenceType)
            }
          >
            <option value="none">No se repite</option>
            <option value="daily">Cada X días</option>
            <option value="weekly">Cada X semanas</option>
            <option value="monthly">Cada X meses</option>
          </select>
        </label>

        <label className="field">
          <span>Repetir cada</span>
          <input
            min="1"
            type="number"
            disabled={form.recurrenceType === "none"}
            value={form.recurrenceInterval}
            onChange={(event) => update("recurrenceInterval", event.target.value)}
          />
        </label>
      </div>

      <div className="form-actions">
        <button type="button" className="button button-secondary" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="button button-primary" disabled={saving}>
          {saving ? "Guardando…" : editingTask ? "Guardar cambios" : "Crear tarea"}
        </button>
      </div>
    </form>
  );
}
