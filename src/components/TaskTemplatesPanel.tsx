import { useState, type FormEvent } from "react";
import type { AppUserDefinition } from "../config/appUsers";
import {
  USERS,
  type RecurrenceType,
  type TaskAssignee,
  type TaskPriority,
} from "../models/task";
import type { TaskTemplate } from "../models/template";

interface TaskTemplatesPanelProps {
  currentUser: AppUserDefinition;
  templates: TaskTemplate[];
  onSave: (template: TaskTemplate) => Promise<void>;
  onDelete: (templateId: string) => Promise<void>;
  onMessage: (message: string) => void;
}

const priorityLabels: Record<TaskPriority, string> = {
  low: "Baja",
  normal: "Normal",
  high: "Alta",
  critical: "Crítica",
};

interface TemplateFormState {
  name: string;
  description: string;
  estimatedMinutes: string;
  priority: TaskPriority | "";
  assignedTo: TaskAssignee;
  isPrivate: boolean;
  dueDate: string;
  dueTime: string;
  recurrenceType: RecurrenceType;
  recurrenceInterval: string;
  recurrenceEndDate: string;
}

const createEmptyForm = (defaultAssignee: TaskAssignee): TemplateFormState => ({
  name: "",
  description: "",
  estimatedMinutes: "",
  priority: "",
  assignedTo: defaultAssignee,
  isPrivate: false,
  dueDate: "",
  dueTime: "",
  recurrenceType: "none",
  recurrenceInterval: "1",
  recurrenceEndDate: "",
});

export function TaskTemplatesPanel({
  currentUser,
  templates,
  onSave,
  onDelete,
  onMessage,
}: TaskTemplatesPanelProps) {
  const [editing, setEditing] = useState<TaskTemplate | null>(null);
  const [form, setForm] = useState<TemplateFormState>(() =>
    createEmptyForm(currentUser.name),
  );
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setEditing(null);
    setForm(createEmptyForm(currentUser.name));
  };

  const edit = (template: TaskTemplate) => {
    setEditing(template);
    setForm({
      name: template.name,
      description: template.description,
      estimatedMinutes: template.estimatedMinutes
        ? String(template.estimatedMinutes)
        : "",
      priority: template.priority || "",
      assignedTo: template.isPrivate ? currentUser.name : template.assignedTo,
      isPrivate: template.isPrivate === true,
      dueDate: template.dueDate || "",
      dueTime: template.dueTime || "",
      recurrenceType: template.dueDate ? template.recurrence.type : "none",
      recurrenceInterval: String(Math.max(1, template.recurrence.interval || 1)),
      recurrenceEndDate: template.recurrence.endDate || "",
    });
  };

  const update = <K extends keyof TemplateFormState>(
    key: K,
    value: TemplateFormState[K],
  ) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) return;

    setSaving(true);
    try {
      const timestamp = new Date().toISOString();
      const dueDate = form.dueDate || undefined;
      const recurrenceType = dueDate ? form.recurrenceType : "none";
      await onSave({
        id: editing?.id || crypto.randomUUID(),
        name,
        description: form.description.trim(),
        estimatedMinutes:
          form.estimatedMinutes.trim() && Number(form.estimatedMinutes) > 0
            ? Math.max(1, Number(form.estimatedMinutes))
            : undefined,
        priority: form.priority || undefined,
        assignedTo: form.isPrivate ? currentUser.name : form.assignedTo,
        isPrivate: form.isPrivate,
        privateOwnerUserId: form.isPrivate ? currentUser.uid : undefined,
        dueDate,
        dueTime: dueDate && form.dueTime ? form.dueTime : undefined,
        recurrence: {
          type: recurrenceType,
          interval: Math.max(1, Number(form.recurrenceInterval) || 1),
          endDate:
            dueDate && recurrenceType !== "none" && form.recurrenceEndDate
              ? form.recurrenceEndDate
              : undefined,
        },
        createdAt: editing?.createdAt || timestamp,
        updatedAt: timestamp,
        createdByUserId: editing?.createdByUserId || currentUser.uid,
      });
      onMessage(editing ? "Plantilla actualizada." : "Plantilla creada.");
      reset();
    } finally {
      setSaving(false);
    }
  };

  const removeTemplate = async (template: TaskTemplate) => {
    if (!window.confirm(`¿Eliminar la plantilla “${template.name}”?`)) return;
    await onDelete(template.id);
    if (editing?.id === template.id) reset();
    onMessage("Plantilla eliminada.");
  };

  return (
    <section className="task-list-panel templates-manager-panel">
      <div className="list-heading">
        <div>
          <h2>Plantillas de tareas</h2>
          <small>
            Cada plantilla guarda todos los campos configurables para crear una tarea rápidamente.
          </small>
        </div>
        <span>{templates.length}</span>
      </div>

      <div className="templates-manager-layout">
        <div className="template-management-list">
          {templates.length ? (
            templates.map((template) => (
              <article className="template-management-row" key={template.id}>
                <div>
                  <strong>{template.name}</strong>
                  <span>
                    {template.isPrivate ? "🔒 Privada" : template.assignedTo}
                    {template.priority
                      ? ` · Prioridad ${priorityLabels[template.priority]}`
                      : " · Sin prioridad"}
                    {template.estimatedMinutes
                      ? ` · ${template.estimatedMinutes} min`
                      : " · Sin tiempo"}
                    {template.dueDate ? ` · ${template.dueDate}` : " · Sin fecha"}
                    {template.recurrence.type !== "none" ? " · Recurrente" : ""}
                  </span>
                </div>
                <div className="row-actions">
                  <button type="button" onClick={() => edit(template)}>Editar</button>
                  <button
                    type="button"
                    className="danger-action"
                    onClick={() => void removeTemplate(template)}
                  >
                    Eliminar
                  </button>
                </div>
              </article>
            ))
          ) : (
            <p className="list-empty">No hay plantillas. Crea la primera a la derecha.</p>
          )}
        </div>

        <form className="template-manager-form" onSubmit={submit}>
          <h3>{editing ? "Editar plantilla" : "Nueva plantilla"}</h3>

          <label className="field">
            <span>Nombre de la tarea</span>
            <input
              required
              value={form.name}
              onChange={(event) => update("name", event.target.value)}
              placeholder="Ej.: Limpiar cocina"
            />
          </label>

          <label className="field">
            <span>Descripción</span>
            <textarea
              rows={3}
              value={form.description}
              onChange={(event) => update("description", event.target.value)}
              placeholder="Detalles opcionales"
            />
          </label>

          <fieldset className="quick-group">
            <legend>Visibilidad</legend>
            <div className="segmented-options two-options">
              <button
                type="button"
                className={!form.isPrivate ? "selected" : ""}
                onClick={() => update("isPrivate", false)}
              >
                Normal
              </button>
              <button
                type="button"
                className={form.isPrivate ? "selected" : ""}
                onClick={() => {
                  update("isPrivate", true);
                  update("assignedTo", currentUser.name);
                }}
              >
                🔒 Privada
              </button>
            </div>
            {form.isPrivate && (
              <small className="privacy-note">
                Esta plantilla privada solo será visible para {currentUser.name} y creará tareas privadas asignadas únicamente a ese usuario.
              </small>
            )}
          </fieldset>

          <fieldset className="quick-group template-assignee-group">
            <legend>Asignada a</legend>
            {form.isPrivate ? (
              <div className="private-assignee-summary">🔒 Solo {currentUser.name}</div>
            ) : (
              <div className="segmented-options three-options">
                {[...USERS, "Ambos" as const].map((user) => (
                  <button
                    key={user}
                    type="button"
                    className={form.assignedTo === user ? "selected" : ""}
                    onClick={() => update("assignedTo", user)}
                  >
                    {user === "Ambos" ? "👥 Ambos" : user}
                  </button>
                ))}
              </div>
            )}
          </fieldset>

          <div className="form-grid">
            <label className="field">
              <span>Prioridad</span>
              <select
                value={form.priority}
                onChange={(event) =>
                  update("priority", event.target.value as TaskPriority | "")
                }
              >
                <option value="">Sin prioridad</option>
                <option value="low">Baja</option>
                <option value="normal">Normal</option>
                <option value="high">Alta</option>
                <option value="critical">Crítica</option>
              </select>
            </label>

            <label className="field">
              <span>Tiempo estimado (minutos)</span>
              <input
                min="1"
                inputMode="numeric"
                type="number"
                value={form.estimatedMinutes}
                onChange={(event) => update("estimatedMinutes", event.target.value)}
                placeholder="Sin estimar"
              />
            </label>

            <label className="field">
              <span>Fecha límite</span>
              <input
                type="date"
                value={form.dueDate}
                onChange={(event) => {
                  const value = event.target.value;
                  update("dueDate", value);
                  if (!value) {
                    update("dueTime", "");
                    update("recurrenceType", "none");
                    update("recurrenceEndDate", "");
                  }
                }}
              />
              <small>Déjala vacía para usar “Sin fecha”.</small>
            </label>

            <label className="field">
              <span>Hora límite</span>
              <input
                type="time"
                disabled={!form.dueDate}
                value={form.dueTime}
                onChange={(event) => update("dueTime", event.target.value)}
              />
            </label>

            <label className="field">
              <span>Repetición</span>
              <select
                disabled={!form.dueDate}
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
                inputMode="numeric"
                type="number"
                disabled={!form.dueDate || form.recurrenceType === "none"}
                value={form.recurrenceInterval}
                onChange={(event) => update("recurrenceInterval", event.target.value)}
              />
            </label>

            <label className="field">
              <span>Repetir hasta</span>
              <input
                type="date"
                disabled={!form.dueDate || form.recurrenceType === "none"}
                min={form.dueDate || undefined}
                value={form.recurrenceEndDate}
                onChange={(event) => update("recurrenceEndDate", event.target.value)}
              />
              <small>Déjala vacía si la recurrencia no tiene fecha final.</small>
            </label>
          </div>

          <div className="form-actions">
            {editing && (
              <button className="button button-secondary" type="button" onClick={reset}>
                Cancelar
              </button>
            )}
            <button className="button button-primary" type="submit" disabled={saving}>
              {saving ? "Guardando…" : editing ? "Guardar cambios" : "Crear plantilla"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
