import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { TaskCard } from "./components/TaskCard";
import { TaskForm } from "./components/TaskForm";
import { useTasks } from "./hooks/useTasks";
import {
  USERS,
  type Task,
  type TaskExport,
  type TaskUrgency,
  type UserFilter,
  type UserName,
} from "./models/task";
import {
  formatDueDate,
  formatDuration,
  isTaskDueToday,
  isTaskOverdue,
  sortPendingTasks,
} from "./utils/taskDates";
import "./styles.css";

const USER_KEY = "taskFollower.selectedUser";
const APP_LOCALE = "es-DO";

type View = "dashboard" | "manage";
type ImportMode = "merge" | "replace";

const urgencyLabels: Record<TaskUrgency, string> = {
  low: "Baja",
  normal: "Normal",
  high: "Alta",
  critical: "Crítica",
};

const readSelectedUser = (): UserFilter => {
  const value = localStorage.getItem(USER_KEY);
  return value === "Yisel" || value === "Yorki" ? value : "all";
};

const isTaskArray = (value: unknown): value is Task[] =>
  Array.isArray(value) &&
  value.every(
    (task) =>
      task &&
      typeof task === "object" &&
      typeof (task as Task).id === "string" &&
      typeof (task as Task).name === "string",
  );

function App() {
  const {
    tasks,
    syncState,
    syncMessage,
    pendingCount,
    saveTask,
    completeTask,
    deleteTask,
    replaceTasks,
    mergeTasks,
    retrySync,
  } = useTasks();

  const [selectedUser, setSelectedUser] = useState<UserFilter>(readSelectedUser);
  const [view, setView] = useState<View>("dashboard");
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>("merge");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeUser: UserName = selectedUser === "all" ? "Yorki" : selectedUser;
  const completionUserFor = (task: Task): UserName =>
    selectedUser === "all" ? task.assignedTo : selectedUser;

  const filteredTasks = useMemo(
    () =>
      selectedUser === "all"
        ? tasks
        : tasks.filter((task) => task.assignedTo === selectedUser),
    [selectedUser, tasks],
  );

  const pendingTasks = useMemo(
    () => sortPendingTasks(filteredTasks.filter((task) => task.status === "pending")),
    [filteredTasks],
  );

  const completedTasks = useMemo(
    () =>
      filteredTasks
        .filter((task) => task.status === "done")
        .sort(
          (a, b) =>
            new Date(b.completedAt || b.updatedAt).getTime() -
            new Date(a.completedAt || a.updatedAt).getTime(),
        ),
    [filteredTasks],
  );

  const nextTask = pendingTasks[0];
  const upcomingTasks = pendingTasks.slice(1, 7);
  const overdueCount = pendingTasks.filter(isTaskOverdue).length;
  const dueTodayCount = pendingTasks.filter(isTaskDueToday).length;

  const changeSelectedUser = (value: UserFilter) => {
    setSelectedUser(value);
    localStorage.setItem(USER_KEY, value);
  };

  const openCreateForm = () => {
    setEditingTask(null);
    setShowForm(true);
  };

  const openEditForm = (task: Task) => {
    setEditingTask(task);
    setShowForm(true);
  };

  const closeForm = () => {
    setEditingTask(null);
    setShowForm(false);
  };

  const handleSave = async (task: Task) => {
    await saveTask(task);
    closeForm();
  };

  const handleDelete = async (task: Task) => {
    if (!window.confirm(`¿Eliminar la tarea “${task.name}”?`)) return;
    await deleteTask(task.id);
  };

  const handleExport = () => {
    const payload: TaskExport = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      tasks,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `taskfollower-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const requestImport = (mode: ImportMode) => {
    setImportMode(mode);
    fileInputRef.current?.click();
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const importedTasks = isTaskArray(parsed)
        ? parsed
        : isTaskArray((parsed as TaskExport)?.tasks)
          ? (parsed as TaskExport).tasks
          : null;

      if (!importedTasks) {
        window.alert("Este archivo no contiene una lista válida de tareas de TaskFollower.");
        return;
      }

      const quantityText = importedTasks.length === 1 ? "1 tarea" : `${importedTasks.length} tareas`;
      const action =
        importMode === "replace"
          ? "reemplazar todas las tareas actuales"
          : "combinar estas tareas con las actuales";

      if (!window.confirm(`¿Importar ${quantityText} y ${action}?`)) return;

      if (importMode === "replace") await replaceTasks(importedTasks);
      else await mergeTasks(importedTasks);
    } catch {
      window.alert("El archivo seleccionado no contiene JSON válido.");
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView("dashboard")}>
          <span className="brand-mark">✓</span>
          <span>
            <strong>TaskFollower</strong>
            <small>Ten claro qué sigue.</small>
          </span>
        </button>

        <div className="topbar-actions">
          <label className="user-picker">
            <span>Mostrar</span>
            <select
              value={selectedUser}
              onChange={(event) => changeSelectedUser(event.target.value as UserFilter)}
            >
              <option value="all">Todas las tareas</option>
              {USERS.map((user) => (
                <option key={user} value={user}>
                  {user}
                </option>
              ))}
            </select>
          </label>

          <button
            className={`button ${view === "manage" ? "button-primary" : "button-quiet"}`}
            onClick={() => setView(view === "dashboard" ? "manage" : "dashboard")}
          >
            {view === "dashboard" ? "⚙ Gestionar" : "← Panel"}
          </button>
        </div>
      </header>

      <div className={`sync-bar sync-${syncState}`}>
        <span className="sync-dot" />
        <span>{syncMessage}</span>
        {pendingCount > 0 && (
          <strong>
            {pendingCount === 1 ? "1 cambio pendiente" : `${pendingCount} cambios pendientes`}
          </strong>
        )}
        {(syncState === "error" || syncState === "offline") && (
          <button onClick={() => void retrySync()}>Reintentar</button>
        )}
      </div>

      <main className="main-content">
        {view === "dashboard" ? (
          <>
            <section className="dashboard-heading">
              <div>
                <span className="eyebrow">Enfoque de hoy</span>
                <h1>
                  {selectedUser === "all"
                    ? "¿Qué necesitas completar ahora?"
                    : `Próximas tareas de ${selectedUser}`}
                </h1>
              </div>

              <div className="summary-strip">
                <div className={overdueCount ? "summary-danger" : ""}>
                  <strong>{overdueCount}</strong>
                  <span>Vencidas</span>
                </div>
                <div>
                  <strong>{dueTodayCount}</strong>
                  <span>Para hoy</span>
                </div>
                <div>
                  <strong>{pendingTasks.length}</strong>
                  <span>Pendientes</span>
                </div>
              </div>
            </section>

            {nextTask ? (
              <section className="next-task-section">
                <div className="section-title-row">
                  <div>
                    <span className="eyebrow">Próxima tarea</span>
                    <h2>Empieza por aquí</h2>
                  </div>
                </div>
                <TaskCard
                  featured
                  task={nextTask}
                  activeUser={completionUserFor(nextTask)}
                  onComplete={(task, user) => void completeTask(task, user)}
                  onEdit={openEditForm}
                />
              </section>
            ) : (
              <section className="empty-state">
                <span className="empty-icon">✓</span>
                <h2>No hay tareas pendientes</h2>
                <p>Todo en esta vista está completado.</p>
                <button className="button button-primary" onClick={openCreateForm}>
                  Crear una tarea
                </button>
              </section>
            )}

            {upcomingTasks.length > 0 && (
              <section className="upcoming-section">
                <div className="section-title-row">
                  <div>
                    <span className="eyebrow">Después</span>
                    <h2>Próximas tareas</h2>
                  </div>
                  <button className="text-button" onClick={() => setView("manage")}>
                    Ver las {pendingTasks.length}
                  </button>
                </div>

                <div className="task-grid">
                  {upcomingTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      activeUser={completionUserFor(task)}
                      onComplete={(item, user) => void completeTask(item, user)}
                      onEdit={openEditForm}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          <section className="manage-section">
            <div className="manage-heading">
              <div>
                <span className="eyebrow">Gestión</span>
                <h1>Tareas y datos</h1>
                <p>Crea, edita, completa, importa o exporta la lista de tareas compartidas.</p>
              </div>
              <button className="button button-primary" onClick={openCreateForm}>
                + Nueva tarea
              </button>
            </div>

            <div className="data-actions">
              <button className="button button-secondary" onClick={handleExport}>
                Exportar JSON
              </button>
              <button className="button button-secondary" onClick={() => requestImport("merge")}>
                Importar y combinar
              </button>
              <button className="button button-quiet" onClick={() => requestImport("replace")}>
                Importar y reemplazar
              </button>
              <input
                ref={fileInputRef}
                hidden
                type="file"
                accept="application/json,.json"
                onChange={(event) => void handleImport(event)}
              />
            </div>

            <div className="task-list-panel">
              <div className="list-heading">
                <h2>Tareas pendientes</h2>
                <span>{pendingTasks.length}</span>
              </div>

              {pendingTasks.length ? (
                <div className="management-list">
                  {pendingTasks.map((task) => (
                    <article className="management-row" key={task.id}>
                      <span className={`urgency-dot urgency-dot-${task.urgency}`} />
                      <div className="management-main">
                        <strong>{task.name}</strong>
                        <span>
                          {task.assignedTo} · {formatDueDate(task)} · {formatDuration(task.estimatedMinutes)}
                        </span>
                      </div>
                      <span className={`status-pill ${isTaskOverdue(task) ? "status-overdue" : ""}`}>
                        {isTaskOverdue(task) ? "Vencida" : urgencyLabels[task.urgency]}
                      </span>
                      <div className="row-actions">
                        <button onClick={() => openEditForm(task)}>Editar</button>
                        <button onClick={() => void completeTask(task, completionUserFor(task))}>
                          Completar
                        </button>
                        <button className="danger-action" onClick={() => void handleDelete(task)}>
                          Eliminar
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="list-empty">No hay tareas pendientes en esta vista.</p>
              )}
            </div>

            <div className="task-list-panel completed-panel">
              <button className="completed-toggle" onClick={() => setShowCompleted(!showCompleted)}>
                <span>
                  <strong>Tareas completadas</strong>
                  <small>{completedTasks.length} en esta vista</small>
                </span>
                <span>{showCompleted ? "−" : "+"}</span>
              </button>

              {showCompleted && (
                <div className="management-list">
                  {completedTasks.length ? (
                    completedTasks.map((task) => (
                      <article className="management-row completed-row" key={task.id}>
                        <span className="completed-check">✓</span>
                        <div className="management-main">
                          <strong>{task.name}</strong>
                          <span>
                            Completada por {task.completedBy || task.assignedTo}
                            {task.completedAt
                              ? ` · ${new Intl.DateTimeFormat(APP_LOCALE, {
                                  month: "short",
                                  day: "numeric",
                                }).format(new Date(task.completedAt))}`
                              : ""}
                          </span>
                        </div>
                        <div className="row-actions">
                          <button onClick={() => openEditForm(task)}>Editar</button>
                          <button className="danger-action" onClick={() => void handleDelete(task)}>
                            Eliminar
                          </button>
                        </div>
                      </article>
                    ))
                  ) : (
                    <p className="list-empty">Todavía no hay tareas completadas.</p>
                  )}
                </div>
              )}
            </div>
          </section>
        )}
      </main>

      {showForm && (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeForm}>
          <div
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <TaskForm
              editingTask={editingTask}
              defaultUser={activeUser}
              onSave={handleSave}
              onCancel={closeForm}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
