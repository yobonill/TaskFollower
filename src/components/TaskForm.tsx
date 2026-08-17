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
  type TaskAssignee,
  type TaskPriority,
  type UserName,
  type WeekdayNumber,
} from "../models/task";
import {
  formatMissingRequiredFields,
  getMissingRequiredFields,
} from "../utils/taskCompleteness";
import {
  WEEKDAY_OPTIONS,
  WEEKDAY_PRESETS,
  getRecurrenceStartDate,
  normalizeWeekdays,
  toDateInputValue,
} from "../utils/taskDates";
import type { TaskTemplate } from "../models/template";
import { getAssigneeUserIds } from "../utils/taskAssignment";

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
  assignedTo: TaskAssignee;
  isPrivate: boolean;
  recurrenceType: RecurrenceType;
  recurrenceInterval: string;
  recurrenceWeekdays: WeekdayNumber[];
  recurrenceOccurrencesPerDay: string;
  recurrenceEndDate: string;
}

interface SavedDefaults {
  estimatedMinutes?: string;
  assignedTo?: TaskAssignee;
}

export const TASK_FORM_DRAFT_KEY = "taskFollower.taskDraft.v4";
export const getTaskFormDraftKey = (userId: string): string =>
  `${TASK_FORM_DRAFT_KEY}.${userId}`;
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
      defaults.assignedTo === "Yisel" ||
      defaults.assignedTo === "Yorki" ||
      defaults.assignedTo === "Ambos"
        ? defaults.assignedTo
        : defaultUser,
    isPrivate: false,
    recurrenceType: "none",
    recurrenceInterval: "1",
    recurrenceWeekdays: [],
    recurrenceOccurrencesPerDay: "1",
    recurrenceEndDate: "",
  };
};

const hasMeaningfulDraft = (form: FormState, defaultUser: UserName): boolean => {
  const baseline = createInitialState(defaultUser);
  return (Object.keys(form) as (keyof FormState)[]).some(
    (key) => form[key] !== baseline[key],
  );
};

const readDraft = (
  defaultUser: UserName,
  userId: string,
): FormState | null => {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(getTaskFormDraftKey(userId)) || "null",
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
        parsed.isPrivate === true
          ? defaultUser
          : parsed.assignedTo === "Yisel" ||
              parsed.assignedTo === "Yorki" ||
              parsed.assignedTo === "Ambos"
            ? parsed.assignedTo
            : defaultUser,
      isPrivate: parsed.isPrivate === true,
      recurrenceType:
        parsed.recurrenceType === "none" ||
        parsed.recurrenceType === "daily" ||
        parsed.recurrenceType === "weekly" ||
        parsed.recurrenceType === "weekdays" ||
        parsed.recurrenceType === "monthly"
          ? parsed.recurrenceType
          : "none",
      recurrenceWeekdays: normalizeWeekdays(parsed.recurrenceWeekdays),
      recurrenceOccurrencesPerDay:
        parsed.recurrenceOccurrencesPerDay &&
        Number(parsed.recurrenceOccurrencesPerDay) > 0
          ? String(Math.min(20, Math.max(1, Math.floor(Number(parsed.recurrenceOccurrencesPerDay)))))
          : "1",
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
  const draftKey = getTaskFormDraftKey(currentUser.uid);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<FormState>(() =>
    editingTask
      ? createInitialState(defaultUser)
      : readDraft(defaultUser, currentUser.uid) || createInitialState(defaultUser),
  );
  const [showAdvanced, setShowAdvanced] = useState(Boolean(editingTask));
  const [showCustomDate, setShowCustomDate] = useState(false);
  const [customDuration, setCustomDuration] = useState(false);
  const [savingAction, setSavingAction] = useState<"save" | "another" | null>(null);
  const [formMessage, setFormMessage] = useState("");
  const [similarPrompt, setSimilarPrompt] = useState<{ task: Task; similarTasks: Task[]; createAnother: boolean } | null>(null);
  const [draftRecovered, setDraftRecovered] = useState(() => {
    if (editingTask) return false;
    const draft = readDraft(defaultUser, currentUser.uid);
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
    if (missingFields.length > 0 && form.isPrivate) {
      setForm((current) => ({ ...current, isPrivate: false }));
    }
  }, [form.isPrivate, missingFields.length]);

  const weekdayAdjustedDueDate = useMemo(() => {
    if (
      !form.dueDate ||
      form.recurrenceType !== "weekdays" ||
      form.recurrenceWeekdays.length === 0
    ) {
      return form.dueDate;
    }
    return getRecurrenceStartDate(form.dueDate, {
      type: "weekdays",
      interval: 1,
      weekdays: form.recurrenceWeekdays,
    });
  }, [form.dueDate, form.recurrenceType, form.recurrenceWeekdays]);

  useEffect(() => {
    if (!editingTask) {
      const draft = readDraft(defaultUser, currentUser.uid);
      const meaningfulDraft = Boolean(
        draft && hasMeaningfulDraft(draft, defaultUser),
      );
      setForm(meaningfulDraft && draft ? draft : createInitialState(defaultUser));
      setDraftRecovered(meaningfulDraft);
      if (!meaningfulDraft) localStorage.removeItem(draftKey);
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
      assignedTo:
        editingTask.isUnassigned
          ? currentUser.name
          : editingTask.isPrivate
            ? currentUser.name
            : editingTask.assignedTo,
      isPrivate: editingTask.isUnassigned ? false : editingTask.isPrivate === true,
      recurrenceType: editingTask.recurrence.type,
      recurrenceInterval: String(editingTask.recurrence.interval),
      recurrenceWeekdays: normalizeWeekdays(editingTask.recurrence.weekdays),
      recurrenceOccurrencesPerDay: String(
        Math.min(20, Math.max(1, editingTask.recurrence.occurrencesPerDay || 1)),
      ),
      recurrenceEndDate: editingTask.recurrence.endDate || "",
    });
  }, [currentUser.uid, defaultUser, draftKey, editingTask]);

  useEffect(() => {
    if (editingTask) return;
    const timeout = window.setTimeout(() => {
      if (hasMeaningfulDraft(form, defaultUser)) {
        localStorage.setItem(draftKey, JSON.stringify(form));
      } else {
        localStorage.removeItem(draftKey);
      }
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [defaultUser, draftKey, editingTask, form]);

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

  const setRecurrenceType = (type: RecurrenceType) => {
    setFormMessage("");
    setForm((current) => {
      const selectedWeekdays =
        type === "weekdays"
          ? current.recurrenceWeekdays.length
            ? current.recurrenceWeekdays
            : current.dueDate
              ? normalizeWeekdays([
                  (() => {
                    const day = new Date(`${current.dueDate}T12:00:00`).getDay();
                    return day === 0 ? 7 : day;
                  })(),
                ])
              : []
          : [];
      return {
        ...current,
        recurrenceType: type,
        recurrenceInterval: type === "weekdays" ? "1" : current.recurrenceInterval,
        recurrenceWeekdays: selectedWeekdays,
        recurrenceOccurrencesPerDay:
          type === "none" ? "1" : current.recurrenceOccurrencesPerDay || "1",
      };
    });
  };

  const toggleRecurrenceWeekday = (weekday: WeekdayNumber) => {
    setFormMessage("");
    setForm((current) => ({
      ...current,
      recurrenceWeekdays: current.recurrenceWeekdays.includes(weekday)
        ? current.recurrenceWeekdays.filter((day) => day !== weekday)
        : normalizeWeekdays([...current.recurrenceWeekdays, weekday]),
    }));
  };

  const setWeekdayPreset = (weekdays: WeekdayNumber[]) => {
    setFormMessage("");
    setForm((current) => ({
      ...current,
      recurrenceWeekdays: [...weekdays],
    }));
  };

  const applyTemplate = (template: TaskTemplate) => {
    const dueDate = template.dueDate || "";
    const recurrenceType = dueDate ? template.recurrence.type : "none";
    setForm({
      name: template.name,
      description: template.description || "",
      estimatedMinutes: template.estimatedMinutes
        ? String(template.estimatedMinutes)
        : "",
      dueDate,
      dueTime: dueDate ? template.dueTime || "" : "",
      priority: template.priority || "",
      assignedTo: template.isPrivate ? currentUser.name : template.assignedTo,
      isPrivate: template.isPrivate === true,
      recurrenceType,
      recurrenceInterval: String(Math.max(1, template.recurrence.interval || 1)),
      recurrenceWeekdays: normalizeWeekdays(template.recurrence.weekdays),
      recurrenceOccurrencesPerDay: String(
        Math.min(20, Math.max(1, template.recurrence.occurrencesPerDay || 1)),
      ),
      recurrenceEndDate:
        dueDate && recurrenceType !== "none"
          ? template.recurrence.endDate || ""
          : "",
    });
    setShowAdvanced(
      Boolean(
        template.description ||
          template.dueTime ||
          recurrenceType !== "none",
      ),
    );
    window.setTimeout(() => nameInputRef.current?.focus(), 0);
  };

  const buildTask = (): Task => {
    const timestamp = new Date().toISOString();
    const isIncomplete = missingFields.length > 0;
    const isPrivate = !isIncomplete && form.isPrivate;
    const assignedTo: TaskAssignee = isPrivate ? currentUser.name : form.assignedTo;
    const recurrenceType: RecurrenceType = form.dueDate
      ? form.recurrenceType
      : "none";
    const recurrence = {
      type: recurrenceType,
      interval:
        recurrenceType === "weekdays"
          ? 1
          : Math.max(1, Number(form.recurrenceInterval) || 1),
      weekdays:
        recurrenceType === "weekdays"
          ? normalizeWeekdays(form.recurrenceWeekdays)
          : undefined,
      occurrencesPerDay:
        recurrenceType !== "none"
          ? Math.min(
              20,
              Math.max(1, Math.floor(Number(form.recurrenceOccurrencesPerDay) || 1)),
            )
          : undefined,
      defaultAssignedTo:
        recurrenceType !== "none"
          ? editingTask &&
            editingTask.assignedTo === assignedTo &&
            editingTask.recurrence.defaultAssignedTo
            ? editingTask.recurrence.defaultAssignedTo
            : assignedTo
          : undefined,
      endDate:
        form.dueDate && recurrenceType !== "none" && form.recurrenceEndDate
          ? form.recurrenceEndDate
          : undefined,
    };
    const effectiveDueDate = form.dueDate
      ? getRecurrenceStartDate(form.dueDate, recurrence)
      : undefined;

    return {
      id: editingTask?.id || crypto.randomUUID(),
      name: form.name.trim(),
      description: form.description.trim(),
      estimatedMinutes:
        form.estimatedMinutes.trim() && Number(form.estimatedMinutes) > 0
          ? Math.max(1, Number(form.estimatedMinutes))
          : undefined,
      dueDate: effectiveDueDate,
      dueTime: effectiveDueDate && form.dueTime ? form.dueTime : undefined,
      priority: form.priority || undefined,
      assignedBy: editingTask?.assignedBy || currentUser.name,
      assignedTo,
      createdByUserId: editingTask?.createdByUserId || currentUser.uid,
      assignedToUserId:
        isIncomplete || assignedTo === "Ambos"
          ? undefined
          : getAppUserByName(assignedTo).uid,
      assignedToUserIds: isIncomplete ? [] : getAssigneeUserIds(assignedTo),
      isUnassigned: isIncomplete,
      isPrivate,
      privateOwnerUserId: isPrivate ? currentUser.uid : undefined,
      lastModifiedByUserId: currentUser.uid,
      status: editingTask?.status || "pending",
      recurrence,
      recurrenceSeriesId:
        !effectiveDueDate || recurrenceType === "none"
          ? undefined
          : editingTask?.recurrenceSeriesId || editingTask?.id || crypto.randomUUID(),
      recurrenceOccurrenceIndex:
        !effectiveDueDate || recurrenceType === "none"
          ? undefined
          : editingTask?.recurrenceOccurrenceIndex || 1,
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
    localStorage.removeItem(draftKey);
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
        assignedTo: defaultUser,
        isPrivate: false,
        recurrenceType: "none",
        recurrenceInterval: "1",
        recurrenceWeekdays: [],
        recurrenceOccurrencesPerDay: "1",
        recurrenceEndDate: "",
      };
      setForm(nextState);
      localStorage.setItem(draftKey, JSON.stringify(nextState));
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
    if (
      form.dueDate &&
      form.recurrenceType === "weekdays" &&
      form.recurrenceWeekdays.length === 0
    ) {
      setShowAdvanced(true);
      setFormMessage("Selecciona al menos un día de la semana para la repetición.");
      return;
    }

    if (
      form.recurrenceEndDate &&
      weekdayAdjustedDueDate &&
      form.recurrenceEndDate < weekdayAdjustedDueDate
    ) {
      setShowAdvanced(true);
      setFormMessage(
        "La fecha final de repetición no puede ser anterior a la primera fecha programada.",
      );
      return;
    }

    const task = buildTask();
    if (!editingTask && !skipSimilarityCheck && task.name.trim()) {
      const similarTasks = findSimilarTasks(task);
      if (similarTasks.length) {
        localStorage.setItem(draftKey, JSON.stringify(form));
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
    localStorage.removeItem(draftKey);
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
            disabled={missingFields.length > 0}
            onClick={() => {
              update("isPrivate", true);
              update("assignedTo", currentUser.name);
            }}
          >
            🔒 Privada
          </button>
        </div>
        {missingFields.length > 0 ? (
          <small className="privacy-note">
            Las tareas incompletas son visibles para ambos usuarios y no se asignan hasta completar sus datos requeridos.
          </small>
        ) : form.isPrivate ? (
          <small className="privacy-note">
            Solo {currentUser.name} podrá ver esta tarea. Las tareas privadas no pueden asignarse a Ambos ni al otro usuario.
          </small>
        ) : null}
      </fieldset>

      <fieldset className="quick-group">
        <legend>Asignada a</legend>
        {missingFields.length > 0 ? (
          <div className="private-assignee-summary">
            Sin asignar · visible para ambos hasta completar nombre y prioridad
          </div>
        ) : form.isPrivate ? (
          <div className="private-assignee-summary">
            🔒 Solo {currentUser.name}
          </div>
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
              update("recurrenceWeekdays", []);
              update("recurrenceOccurrencesPerDay", "1");
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
            onChange={(event) => {
              const value = event.target.value;
              update("dueDate", value);
              if (!value) {
                update("dueTime", "");
                update("recurrenceType", "none");
                update("recurrenceWeekdays", []);
                update("recurrenceOccurrencesPerDay", "1");
                update("recurrenceEndDate", "");
              }
            }}
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
                onChange={(event) => {
                  const value = event.target.value;
                  update("dueDate", value);
                  if (!value) {
                    update("dueTime", "");
                    update("recurrenceType", "none");
                    update("recurrenceWeekdays", []);
                    update("recurrenceEndDate", "");
                  }
                }}
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
                  setRecurrenceType(event.target.value as RecurrenceType)
                }
              >
                <option value="none">No se repite</option>
                <option value="daily">Cada X días</option>
                <option value="weekly">Cada X semanas</option>
                <option value="weekdays">Días de la semana</option>
                <option value="monthly">Cada X meses</option>
              </select>
            </label>

            {form.recurrenceType !== "weekdays" && (
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
            )}

            {form.dueDate && form.recurrenceType === "weekdays" && (
              <div className="field field-wide weekday-recurrence-field">
                <span>Días de la semana</span>
                <div className="weekday-selector" aria-label="Días de repetición">
                  {WEEKDAY_OPTIONS.map((weekday) => (
                    <button
                      key={weekday.value}
                      type="button"
                      className={
                        form.recurrenceWeekdays.includes(weekday.value)
                          ? "selected"
                          : ""
                      }
                      aria-pressed={form.recurrenceWeekdays.includes(weekday.value)}
                      title={weekday.label}
                      onClick={() => toggleRecurrenceWeekday(weekday.value)}
                    >
                      {weekday.shortLabel}
                    </button>
                  ))}
                </div>
                <div className="weekday-presets">
                  <button
                    type="button"
                    onClick={() => setWeekdayPreset(WEEKDAY_PRESETS.weekdays)}
                  >
                    Lunes a viernes
                  </button>
                  <button
                    type="button"
                    onClick={() => setWeekdayPreset(WEEKDAY_PRESETS.weekend)}
                  >
                    Fin de semana
                  </button>
                  <button
                    type="button"
                    onClick={() => setWeekdayPreset(WEEKDAY_PRESETS.everyDay)}
                  >
                    Todos los días
                  </button>
                </div>
                {form.recurrenceWeekdays.length === 0 ? (
                  <small className="weekday-recurrence-warning">
                    Selecciona al menos un día.
                  </small>
                ) : weekdayAdjustedDueDate !== form.dueDate ? (
                  <small className="weekday-adjustment-note">
                    La primera fecha se ajustará automáticamente a {new Intl.DateTimeFormat(
                      "es-DO",
                      { weekday: "long", day: "numeric", month: "short" },
                    ).format(new Date(`${weekdayAdjustedDueDate}T12:00:00`))}.
                  </small>
                ) : null}
              </div>
            )}

            {form.recurrenceType !== "none" && (
              <label className="field">
                <span>Veces por día</span>
                <input
                  min="1"
                  max="20"
                  inputMode="numeric"
                  type="number"
                  value={form.recurrenceOccurrencesPerDay}
                  onChange={(event) =>
                    update("recurrenceOccurrencesPerDay", event.target.value)
                  }
                />
                <small>
                  Las ocurrencias se crean una por una. Ej.: 3 = 1 de 3, 2 de 3 y 3 de 3.
                </small>
              </label>
            )}

            <label className="field">
              <span>Repetir hasta (opcional)</span>
              <input
                type="date"
                disabled={!form.dueDate || form.recurrenceType === "none"}
                min={weekdayAdjustedDueDate || form.dueDate || undefined}
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
                  localStorage.setItem(draftKey, JSON.stringify(form));
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
