import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { getAppUserByName, type AppUserDefinition } from "../config/appUsers";
import {
  USERS,
  type RecurrenceType,
  type Task,
  type TaskPriority,
  type UserName,
} from "../models/task";
import {
  formatMissingRequiredFields,
  getMissingRequiredFields,
} from "../utils/taskCompleteness";
import { toDateInputValue } from "../utils/taskDates";
import type { TaskTemplate } from "../models/template";

interface TaskFormProps {
  editingTask: Task | null;
  currentUser: AppUserDefinition;
  templates: TaskTemplate[];
  findSimilarTasks: (candidate: Task) => Task[];
  skipSimilarityCheck?: boolean;
  onReviewSimilar: (draft: Task, similarTasks: Task[]) => void;
  onSave: (task: Task, createAnother: boolean) => Promise<void>;
  onCancel: () => void;
}

interface FormState {
  name: string;
  description: string;
  estimatedMinutes: string;
  dueDate: string;
  dueTime: string;
  priority: TaskPriority | "";
  assignedTo: UserName;
  recurrenceType: RecurrenceType;
  recurrenceInterval: string;
  recurrenceEndDate: string;
}

interface SavedDefaults {
  estimatedMinutes?: string;
  assignedTo?: UserName;
}

export const TASK_FORM_DRAFT_KEY = "taskFollower.taskDraft.v3";
const DRAFT_KEY = TASK_FORM_DRAFT_KEY;
const DEFAULTS_KEY = "taskFollower.taskFormDefaults.v2";

const addDays = (date: Date, amount: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
};

const getDatePresets = () => {
  const today = new Date();
  const daysUntilSaturday = (6 - today.getDay() + 7) % 7;
  return [
    { id: "today", label: "Hoy", value: toDateInputValue(today) },
    { id: "tomorrow", label: "Mañana", value: toDateInputValue(addDays(today, 1)) },
    { id: "two-days", label: "En 2 días", value: toDateInputValue(addDays(today, 2)) },
    {
      id: "saturday",
      label: "Este sábado",
      value: toDateInputValue(addDays(today, daysUntilSaturday)),
    },
    {
      id: "next-week",
      label: "Próxima semana",
      value: toDateInputValue(addDays(today, 7)),
    },
  ];
};

const readSavedDefaults = (): SavedDefaults => {
  try {
    return JSON.parse(localStorage.getItem(DEFAULTS_KEY) || "{}") as SavedDefaults;
  } catch {
    return {};
  }
};

const createInitialState = (defaultUser: UserName): FormState => {
  const defaults = readSavedDefaults();
  return {
    name: "",
    description: "",
    estimatedMinutes: defaults.estimatedMinutes || "15",
    dueDate: "",
    dueTime: "",
    priority: "",
    assignedTo:
      defaults.assignedTo === "Yisel" || defaults.assignedTo === "Yorki"
        ? defaults.assignedTo
        : defaultUser,
    recurrenceType: "none",
    recurrenceInterval: "1",
    recurrenceEndDate: "",
  };
};

const hasMeaningfulDraft = (form: FormState, defaultUser: UserName): boolean => {
  const baseline = createInitialState(defaultUser);
  return (Object.keys(form) as (keyof FormState)[]).some(
    (key) => form[key] !== baseline[key],
  );
};

const readDraft = (defaultUser: UserName): FormState | null => {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(DRAFT_KEY) || "null",
    ) as Partial<FormState> | null;
    if (!parsed) return null;
    const fallback = createInitialState(defaultUser);
    return {
      ...fallback,
      ...parsed,
      priority:
        parsed.priority === "low" ||
        parsed.priority === "normal" ||
        parsed.priority === "high" ||
        parsed.priority === "critical"
          ? parsed.priority
          : "",
      assignedTo:
        parsed.assignedTo === "Yisel" || parsed.assignedTo === "Yorki"
          ? parsed.assignedTo
          : defaultUser,
    };
  } catch {
    return null;
  }
};

export function TaskForm({
  editingTask,
  currentUser,
  templates,
  findSimilarTasks,
  skipSimilarityCheck = false,
  onReviewSimilar,
  onSave,
  onCancel,
}: TaskFormProps) {
  const defaultUser = currentUser.name;
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<FormState>(() =>
    editingTask
      ? createInitialState(defaultUser)
      : readDraft(defaultUser) || createInitialState(defaultUser),
  );
  const [showAdvanced, setShowAdvanced] = useState(Boolean(editingTask));
  const [showCustomDate, setShowCustomDate] = useState(false);
  const [customDuration, setCustomDuration] = useState(false);
  const [savingAction, setSavingAction] = useState<"save" | "another" | null>(null);
  const [formMessage, setFormMessage] = useState("");
  const [similarPrompt, setSimilarPrompt] = useState<{ task: Task; similarTasks: Task[]; createAnother: boolean } | null>(null);
  const [draftRecovered, setDraftRecovered] = useState(() => {
    if (editingTask) return false;
    const draft = readDraft(defaultUser);
    return Boolean(draft && hasMeaningfulDraft(draft, defaultUser));
  });

  const datePresets = useMemo(getDatePresets, []);
  const presetDurationValues = ["5", "15", "30", "60"];
  const missingFields = useMemo(
    () =>
      getMissingRequiredFields({
        name: form.name,
        priority: form.priority || undefined,
      }),
    [form.name, form.priority],
  );

  useEffect(() => {
    if (!editingTask) {
      const draft = readDraft(defaultUser);
      const meaningfulDraft = Boolean(
        draft && hasMeaningfulDraft(draft, defaultUser),
      );
      setForm(meaningfulDraft && draft ? draft : createInitialState(defaultUser));
      setDraftRecovered(meaningfulDraft);
      if (!meaningfulDraft) localStorage.removeItem(DRAFT_KEY);
      setShowAdvanced(false);
      return;
    }

    setDraftRecovered(false);
    setShowAdvanced(true);
    setForm({
      name: editingTask.name,
      description: editingTask.description,
      estimatedMinutes: editingTask.estimatedMinutes ? String(editingTask.estimatedMinutes) : "",
      dueDate: editingTask.dueDate || "",
      dueTime: editingTask.dueTime || "",
      priority: editingTask.priority || "",
      assignedTo: editingTask.assignedTo,
      recurrenceType: editingTask.recurrence.type,
      recurrenceInterval: String(editingTask.recurrence.interval),
      recurrenceEndDate: editingTask.recurrence.endDate || "",
    });
  }, [defaultUser, editingTask]);

  useEffect(() => {
    if (editingTask) return;
    const timeout = window.setTimeout(() => {
      if (hasMeaningfulDraft(form, defaultUser)) {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
      } else {
        localStorage.removeItem(DRAFT_KEY);
      }
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [defaultUser, editingTask, form]);

  useEffect(() => {
    setCustomDuration(!presetDurationValues.includes(form.estimatedMinutes));
    setShowCustomDate(
      Boolean(form.dueDate) &&
        !datePresets.some((preset) => preset.value === form.dueDate),
    );
  }, [datePresets, form.dueDate, form.estimatedMinutes]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setFormMessage("");
    setForm((current) => ({ ...current, [key]: value }));
  };

  const applyTemplate = (template: TaskTemplate) => {
    setForm((current) => ({
      ...current,
      name: template.name,
      description: template.description || current.description,
      estimatedMinutes: template.estimatedMinutes ? String(template.estimatedMinutes) : current.estimatedMinutes,
      priority: template.priority || current.priority,
    }));
    window.setTimeout(() => nameInputRef.current?.focus(), 0);
  };

  const buildTask = (): Task => {
    const timestamp = new Date().toISOString();
    return {
      id: editingTask?.id || crypto.randomUUID(),
      name: form.name.trim(),
      description: form.description.trim(),
      estimatedMinutes:
        form.estimatedMinutes.trim() && Number(form.estimatedMinutes) > 0
          ? Math.max(1, Number(form.estimatedMinutes))
          : undefined,
      dueDate: form.dueDate || undefined,
      dueTime: form.dueDate && form.dueTime ? form.dueTime : undefined,
      priority: form.priority || undefined,
      assignedBy: editingTask?.assignedBy || currentUser.name,
      assignedTo: form.assignedTo,
      createdByUserId: editingTask?.createdByUserId || currentUser.uid,
      assignedToUserId: getAppUserByName(form.assignedTo).uid,
      lastModifiedByUserId: currentUser.uid,
      status: editingTask?.status || "pending",
      recurrence: {
        type: form.dueDate ? form.recurrenceType : "none",
        interval: Math.max(1, Number(form.recurrenceInterval) || 1),
        endDate:
          form.dueDate && form.recurrenceType !== "none" && form.recurrenceEndDate
            ? form.recurrenceEndDate
            : undefined,
      },
      recurrenceSeriesId:
        !form.dueDate || form.recurrenceType === "none"
          ? undefined
          : editingTask?.recurrenceSeriesId || editingTask?.id || crypto.randomUUID(),
      source: editingTask?.source || "manual",
      createdAt: editingTask?.createdAt || timestamp,
      updatedAt: timestamp,
      completedAt: editingTask?.completedAt,
      completedBy: editingTask?.completedBy,
      completedByUserId: editingTask?.completedByUserId,
      cancelledAt: editingTask?.cancelledAt,
      cancelledBy: editingTask?.cancelledBy,
      cancelledByUserId: editingTask?.cancelledByUserId,
    };
  };

  const finishSuccessfulSave = (createAnother: boolean) => {
    localStorage.removeItem(DRAFT_KEY);
    localStorage.setItem(
      DEFAULTS_KEY,
      JSON.stringify({
        estimatedMinutes: form.estimatedMinutes,
        assignedTo: form.assignedTo,
      } satisfies SavedDefaults),
    );

    if (createAnother) {
      const nextState: FormState = {
        ...form,
        name: "",
        description: "",
        dueDate: "",
        dueTime: "",
        priority: "",
        recurrenceType: "none",
        recurrenceInterval: "1",
        recurrenceEndDate: "",
      };
      setForm(nextState);
      localStorage.setItem(DRAFT_KEY, JSON.stringify(nextState));
      setDraftRecovered(false);
      setFormMessage("Tarea guardada. Puedes registrar otra.");
      window.setTimeout(() => nameInputRef.current?.focus(), 0);
    }
  };

  const persistTask = async (task: Task, createAnother: boolean) => {
    setSavingAction(createAnother ? "another" : "save");
    try {
      await onSave(task, createAnother);
      finishSuccessfulSave(createAnother);
    } finally {
      setSavingAction(null);
    }
  };

  const save = async (createAnother: boolean) => {
    const task = buildTask();
    if (!editingTask && !skipSimilarityCheck && task.name.trim()) {
      const similarTasks = findSimilarTasks(task);
      if (similarTasks.length) {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
        setSimilarPrompt({ task, similarTasks, createAnother });
        return;
      }
    }
    await persistTask(task, createAnother);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void save(false);
  };

  const clearDraft = () => {
    localStorage.removeItem(DRAFT_KEY);
    setForm(createInitialState(defaultUser));
    setDraftRecovered(false);
    setFormMessage("Borrador descartado.");
    nameInputRef.current?.focus();
  };

  return (
    <form className="task-form" onSubmit={handleSubmit}>
      <div className="form-heading">
        <div>
          <span className="eyebrow">{editingTask ? "Editar" : "Registro rápido"}</span>
          <h2>{editingTask ? "Editar tarea" : "Nueva tarea"}</h2>
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

      {!editingTask && draftRecovered && (
        <div className="draft-notice">
          <span>Se recuperó el borrador guardado en este dispositivo.</span>
          <button type="button" onClick={clearDraft}>Descartar</button>
        </div>
      )}

      {!editingTask && (
        <div className="template-section">
          <span className="quick-label">Usar plantilla</span>
          <div className="chip-scroll" aria-label="Plantillas de tareas">
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                className="choice-chip template-chip"
                onClick={() => applyTemplate(template)}
              >
                {template.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <label className="field field-wide task-name-field">
        <span>Nombre de la tarea <strong className="required-mark">Requerido</strong></span>
        <input
          ref={nameInputRef}
          autoFocus
          value={form.name}
          onChange={(event) => update("name", event.target.value)}
          placeholder="¿Qué necesitas terminar?"
          enterKeyHint="done"
        />
      </label>

      <fieldset className="quick-group">
        <legend>Asignada a</legend>
        <div className="segmented-options two-options">
          {USERS.map((user) => (
            <button
              key={user}
              type="button"
              className={form.assignedTo === user ? "selected" : ""}
              onClick={() => update("assignedTo", user)}
            >
              {user}
            </button>
          ))}
        </div>
      </fieldset>

      <p className="task-creator-note">
        {editingTask
          ? `Creada por ${editingTask.assignedBy}`
          : `Será creada por ${currentUser.name}`}
      </p>

      <fieldset className="quick-group">
        <legend>Fecha límite</legend>
        <div className="chip-grid date-presets">
          <button
            type="button"
            className={`choice-chip ${!form.dueDate ? "selected" : ""}`}
            onClick={() => {
              update("dueDate", "");
              update("dueTime", "");
              update("recurrenceType", "none");
              update("recurrenceEndDate", "");
              setShowCustomDate(false);
            }}
          >
            Sin fecha
          </button>
          {datePresets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`choice-chip ${form.dueDate === preset.value ? "selected" : ""}`}
              onClick={() => {
                update("dueDate", preset.value);
                setShowCustomDate(false);
              }}
            >
              {preset.label}
            </button>
          ))}
          <button
            type="button"
            className={`choice-chip ${showCustomDate ? "selected" : ""}`}
            onClick={() => setShowCustomDate(true)}
          >
            Otra fecha
          </button>
        </div>
        {showCustomDate && (
          <input
            className="quick-native-input"
            type="date"
            value={form.dueDate}
            onChange={(event) => update("dueDate", event.target.value)}
          />
        )}
      </fieldset>

      <fieldset className="quick-group">
        <legend>Prioridad <strong className="required-mark">Requerida</strong></legend>
        <div className="segmented-options priority-options">
          {([
            ["low", "Baja"],
            ["normal", "Normal"],
            ["high", "Alta"],
            ["critical", "Crítica"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`priority-choice priority-choice-${value} ${form.priority === value ? "selected" : ""}`}
              onClick={() => update("priority", value)}
            >
              {label}
            </button>
          ))}
        </div>
        {form.priority && (
          <button
            className="clear-field-button"
            type="button"
            onClick={() => update("priority", "")}
          >
            Quitar prioridad
          </button>
        )}
      </fieldset>

      <fieldset className="quick-group">
        <legend>Tiempo estimado</legend>
        <div className="chip-grid duration-presets">
          {[
            ["5", "5 min"],
            ["15", "15 min"],
            ["30", "30 min"],
            ["60", "1 hora"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`choice-chip ${form.estimatedMinutes === value ? "selected" : ""}`}
              onClick={() => {
                update("estimatedMinutes", value);
                setCustomDuration(false);
              }}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            className={`choice-chip ${customDuration ? "selected" : ""}`}
            onClick={() => setCustomDuration(true)}
          >
            Otro
          </button>
        </div>
        {customDuration && (
          <label className="inline-number-field">
            <input
              min="1"
              inputMode="numeric"
              type="number"
              value={form.estimatedMinutes}
              onChange={(event) => update("estimatedMinutes", event.target.value)}
            />
            <span>minutos</span>
          </label>
        )}
      </fieldset>

      <button
        className="advanced-toggle"
        type="button"
        aria-expanded={showAdvanced}
        onClick={() => setShowAdvanced((current) => !current)}
      >
        <span>Más opciones</span>
        <span>{showAdvanced ? "−" : "+"}</span>
      </button>

      {showAdvanced && (
        <div className="advanced-fields">
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
              <span>Fecha exacta</span>
              <input
                type="date"
                value={form.dueDate}
                onChange={(event) => update("dueDate", event.target.value)}
              />
            </label>

            <label className="field">
              <span>Hora límite (opcional)</span>
              <input
                type="time"
                disabled={!form.dueDate}
                value={form.dueTime}
                onChange={(event) => update("dueTime", event.target.value)}
              />
            </label>

            <label className="field">
              <span>Tiempo exacto (minutos)</span>
              <input
                min="1"
                inputMode="numeric"
                type="number"
                value={form.estimatedMinutes}
                onChange={(event) => update("estimatedMinutes", event.target.value)}
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
              <span>Repetir hasta (opcional)</span>
              <input
                type="date"
                disabled={!form.dueDate || form.recurrenceType === "none"}
                min={form.dueDate || undefined}
                value={form.recurrenceEndDate}
                onChange={(event) => update("recurrenceEndDate", event.target.value)}
              />
              <small>La tarea no se recreará después de esta fecha.</small>
            </label>
          </div>
        </div>
      )}

      {missingFields.length > 0 && (
        <div className="incomplete-form-notice" role="status">
          <strong>La tarea se guardará como incompleta.</strong>
          <span>
            Faltan: {formatMissingRequiredFields({
              name: form.name,
              priority: form.priority || undefined,
            })}. No aparecerá en el panel hasta completar esos datos.
          </span>
        </div>
      )}

      {formMessage && (
        <p className={`form-message ${formMessage.startsWith("Tarea") ? "form-message-success" : ""}`}>
          {formMessage}
        </p>
      )}

      {!editingTask && (
        <div className="draft-status" aria-live="polite">
          Borrador guardado automáticamente en este dispositivo.
        </div>
      )}

      {similarPrompt && (
        <div className="similar-task-prompt" role="alertdialog" aria-modal="true" aria-labelledby="similar-task-title">
          <div className="similar-task-prompt-card">
            <span className="eyebrow">Posible duplicado</span>
            <h3 id="similar-task-title">Estas tareas similares ya existen. ¿Seguro que quieres crear esta tarea?</h3>
            <div className="similar-task-preview-list">
              {similarPrompt.similarTasks.slice(0, 4).map((task) => (
                <div key={task.id}>
                  <strong>{task.name}</strong>
                  <span>{task.assignedTo}{task.dueDate ? ` · ${task.dueDate}` : " · Sin fecha"}</span>
                </div>
              ))}
            </div>
            <div className="similar-task-prompt-actions">
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
                  const prompt = similarPrompt;
                  setSimilarPrompt(null);
                  onReviewSimilar(prompt.task, prompt.similarTasks);
                }}
              >
                Revisar tareas similares primero
              </button>
              <button
                type="button"
                className="button button-primary"
                onClick={() => {
                  const prompt = similarPrompt;
                  setSimilarPrompt(null);
                  void persistTask(prompt.task, prompt.createAnother);
                }}
              >
                Crear tarea
              </button>
              <button
                type="button"
                className="button button-quiet"
                onClick={() => setSimilarPrompt(null)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={`form-actions mobile-form-actions ${editingTask ? "editing-actions" : ""}`}>
        <button type="button" className="button button-secondary" onClick={onCancel}>
          Cerrar
        </button>
        {!editingTask && (
          <button
            type="button"
            className="button button-quiet"
            disabled={savingAction !== null}
            onClick={() => void save(true)}
          >
            {savingAction === "another" ? "Guardando…" : "Guardar y crear otra"}
          </button>
        )}
        <button type="submit" className="button button-primary" disabled={savingAction !== null}>
          {savingAction === "save"
            ? "Guardando…"
            : editingTask
              ? "Guardar cambios"
              : missingFields.length
                ? "Guardar incompleta"
                : "Guardar tarea"}
        </button>
      </div>
    </form>
  );
}
