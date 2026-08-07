import { useState, type FormEvent } from "react";
import type { AppUserDefinition } from "../config/appUsers";
import type { TaskPriority } from "../models/task";
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

const emptyForm = {
  name: "",
  description: "",
  estimatedMinutes: "",
  priority: "" as TaskPriority | "",
};

export function TaskTemplatesPanel({
  currentUser,
  templates,
  onSave,
  onDelete,
  onMessage,
}: TaskTemplatesPanelProps) {
  const [editing, setEditing] = useState<TaskTemplate | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setEditing(null);
    setForm(emptyForm);
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
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) return;

    setSaving(true);
    try {
      const timestamp = new Date().toISOString();
      await onSave({
        id: editing?.id || crypto.randomUUID(),
        name,
        description: form.description.trim(),
        estimatedMinutes:
          form.estimatedMinutes.trim() && Number(form.estimatedMinutes) > 0
            ? Math.max(1, Number(form.estimatedMinutes))
            : undefined,
        priority: form.priority || undefined,
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
          <small>Crea, edita o elimina los atajos disponibles al registrar tareas.</small>
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
                    {template.priority ? `Prioridad ${priorityLabels[template.priority]}` : "Sin prioridad"}
                    {template.estimatedMinutes ? ` · ${template.estimatedMinutes} min` : " · Sin tiempo"}
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
            <span>Nombre</span>
            <input
              required
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Ej.: Limpiar cocina"
            />
          </label>
          <label className="field">
            <span>Descripción</span>
            <textarea
              rows={2}
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            />
          </label>
          <div className="form-grid">
            <label className="field">
              <span>Prioridad</span>
              <select
                value={form.priority}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    priority: event.target.value as TaskPriority | "",
                  }))
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
              <span>Tiempo estimado</span>
              <input
                min="1"
                inputMode="numeric"
                type="number"
                value={form.estimatedMinutes}
                onChange={(event) =>
                  setForm((current) => ({ ...current, estimatedMinutes: event.target.value }))
                }
                placeholder="Minutos"
              />
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
