import { useState, type FormEvent } from "react";
import type { AppUserDefinition } from "../config/appUsers";
import type { DependencyChain, DependencyCycleMode, DependencyStepDefinition } from "../models/dependency";
import type { RecurrenceType, TaskPriority, UserName, WeekdayNumber } from "../models/task";
import { WEEKDAY_OPTIONS, getRecurrenceStartDate, normalizeWeekdays, toDateInputValue } from "../utils/taskDates";

interface Props {
  currentUser: AppUserDefinition;
  chains: DependencyChain[];
  onCreate: (chain: DependencyChain) => Promise<void>;
  onStop: (chain: DependencyChain) => Promise<void>;
  onDelete: (chain: DependencyChain) => Promise<void>;
}

const makeStep = (assignedTo: UserName): DependencyStepDefinition => ({
  id: crypto.randomUUID(), name: "", description: "", assignedTo,
  estimatedMinutes: 15, priority: "normal", dueAfterDays: 0,
});

export function DependencyChainsPanel({ currentUser, chains, onCreate, onStop, onDelete }: Props) {
  const [name, setName] = useState("");
  const [steps, setSteps] = useState<DependencyStepDefinition[]>([
    makeStep(currentUser.name), makeStep(currentUser.name === "Yorki" ? "Yisel" : "Yorki"),
  ]);
  const [firstDueDate, setFirstDueDate] = useState(() => toDateInputValue(new Date()));
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>("none");
  const [interval, setInterval] = useState(1);
  const [weekdays, setWeekdays] = useState<WeekdayNumber[]>([]);
  const [endDate, setEndDate] = useState("");
  const [cycleMode, setCycleMode] = useState<DependencyCycleMode>("overlap");
  const [saving, setSaving] = useState(false);

  const updateStep = <K extends keyof DependencyStepDefinition>(index: number, key: K, value: DependencyStepDefinition[K]) =>
    setSteps((current) => current.map((step, position) => position === index ? { ...step, [key]: value } : step));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || steps.some((step) => !step.name.trim()) || (recurrenceType === "weekdays" && !weekdays.length)) return;
    const timestamp = new Date().toISOString();
    const chain: DependencyChain = {
      id: crypto.randomUUID(), name: name.trim(), steps: steps.map((step) => ({ ...step, name: step.name.trim(), description: step.description.trim() })),
      firstDueDate: getRecurrenceStartDate(firstDueDate, { type: recurrenceType, interval: Math.max(1, interval), weekdays }),
      recurrence: { type: recurrenceType, interval: Math.max(1, interval), weekdays: recurrenceType === "weekdays" ? normalizeWeekdays(weekdays) : undefined, endDate: recurrenceType !== "none" && endDate ? endDate : undefined },
      cycleMode, active: true, createdAt: timestamp, updatedAt: timestamp,
      createdByUserId: currentUser.uid, lastModifiedByUserId: currentUser.uid,
    };
    setSaving(true);
    try {
      await onCreate(chain);
      setName("");
      setSteps([makeStep(currentUser.name), makeStep(currentUser.name === "Yorki" ? "Yisel" : "Yorki")]);
      setRecurrenceType("none"); setInterval(1); setWeekdays([]); setEndDate("");
    } finally { setSaving(false); }
  };

  return <section className="dependency-page">
    <div className="manage-heading"><div><span className="eyebrow">Trabajo encadenado</span><h1>Tareas con dependencia</h1><p>Cada paso se activa únicamente cuando el anterior se completa.</p></div></div>
    <form className="task-list-panel dependency-form" onSubmit={submit}>
      <label className="field"><span>Nombre de la cadena</span><input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Sacar la basura" /></label>
      <div className="dependency-step-list">
        {steps.map((step, index) => <article className="dependency-step-editor" key={step.id}>
          <div className="dependency-step-heading"><strong>Paso {index + 1}</strong>{steps.length > 2 && <button type="button" className="button button-quiet danger-action" onClick={() => setSteps((current) => current.filter((_, position) => position !== index))}>Quitar</button>}</div>
          <label className="field"><span>Tarea</span><input required value={step.name} onChange={(e) => updateStep(index, "name", e.target.value)} /></label>
          <label className="field"><span>Detalles</span><textarea rows={2} value={step.description} onChange={(e) => updateStep(index, "description", e.target.value)} /></label>
          <div className="dependency-step-grid">
            <label className="field"><span>Responsable</span><select value={step.assignedTo} onChange={(e) => updateStep(index, "assignedTo", e.target.value as UserName)}><option>Yorki</option><option>Yisel</option></select></label>
            <label className="field"><span>Tiempo estimado (minutos)</span><input type="number" min="1" step="5" value={step.estimatedMinutes} onChange={(e) => updateStep(index, "estimatedMinutes", Math.max(1, Number(e.target.value)))} /></label>
            <label className="field"><span>Prioridad</span><select value={step.priority} onChange={(e) => updateStep(index, "priority", e.target.value as TaskPriority)}><option value="low">Baja</option><option value="normal">Normal</option><option value="high">Alta</option><option value="critical">Crítica</option></select></label>
            {index > 0 && <label className="field"><span>Plazo al activarse</span><select value={step.dueAfterDays} onChange={(e) => updateStep(index, "dueAfterDays", Number(e.target.value))}><option value="0">El mismo día</option><option value="1">1 día</option><option value="2">2 días</option><option value="7">7 días</option></select></label>}
            <label className="field"><span>Hora límite (opcional)</span><input type="time" value={step.dueTime || ""} onChange={(e) => updateStep(index, "dueTime", e.target.value || undefined)} /></label>
          </div>
        </article>)}
      </div>
      <button type="button" className="button button-secondary" onClick={() => setSteps((current) => [...current, makeStep(currentUser.name)])}>+ Agregar paso</button>
      <div className="dependency-schedule-grid">
        <label className="field"><span>Primera fecha</span><input required type="date" value={firstDueDate} onChange={(e) => setFirstDueDate(e.target.value)} /></label>
        <label className="field"><span>Repetición</span><select value={recurrenceType} onChange={(e) => setRecurrenceType(e.target.value as RecurrenceType)}><option value="none">No repetir</option><option value="daily">Diaria</option><option value="weekly">Semanal</option><option value="weekdays">Días específicos</option><option value="monthly">Mensual</option></select></label>
        {recurrenceType !== "none" && recurrenceType !== "weekdays" && <label className="field"><span>Intervalo</span><input type="number" min="1" value={interval} onChange={(e) => setInterval(Math.max(1, Number(e.target.value)))} /></label>}
        {recurrenceType !== "none" && <label className="field"><span>Fecha final (opcional)</span><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>}
      </div>
      {recurrenceType === "weekdays" && <div className="weekday-picker">{WEEKDAY_OPTIONS.map((day) => <button key={day.value} className={weekdays.includes(day.value) ? "selected" : ""} type="button" onClick={() => setWeekdays((current) => current.includes(day.value) ? current.filter((value) => value !== day.value) : normalizeWeekdays([...current, day.value]))}>{day.shortLabel}<span>{day.label}</span></button>)}</div>}
      {recurrenceType !== "none" && <fieldset className="cycle-mode"><legend>Comportamiento de cada ciclo</legend><label><input type="radio" checked={cycleMode === "overlap"} onChange={() => setCycleMode("overlap")} /> Permitir ciclos simultáneos</label><small>La siguiente cadena comienza en su fecha aunque la anterior siga pendiente.</small><label><input type="radio" checked={cycleMode === "wait"} onChange={() => setCycleMode("wait")} /> Esperar a que termine la cadena</label><small>El próximo ciclo comienza después de completar el último paso.</small></fieldset>}
      <button className="button button-primary" disabled={saving} type="submit">{saving ? "Guardando…" : "Crear cadena"}</button>
    </form>
    <section className="task-list-panel"><div className="list-heading"><div><h2>Cadenas configuradas</h2><small>Detener una cadena conserva las tareas e historial existentes.</small></div><span>{chains.length}</span></div>
      <div className="dependency-chain-list">{chains.length ? chains.map((chain) => <article className="dependency-chain-card" key={chain.id}><div><span className={`status-pill ${chain.active ? "" : "status-incomplete"}`}>{chain.active ? "ACTIVA" : "DETENIDA"}</span><h3>{chain.name}</h3><p>{chain.steps.map((step) => step.assignedTo).join(" → ")}</p><small>{chain.steps.length} pasos · {chain.cycleMode === "overlap" ? "Ciclos simultáneos" : "Espera la finalización"}</small></div><div className="reward-actions">{chain.active && <button type="button" className="button button-secondary" onClick={() => void onStop(chain)}>Detener futuras</button>}<button type="button" className="button button-quiet danger-action" onClick={() => void onDelete(chain)}>Eliminar definición</button></div></article>) : <p className="list-empty">Todavía no hay cadenas de dependencia.</p>}</div>
    </section>
  </section>;
}
