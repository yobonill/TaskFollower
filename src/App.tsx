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
  const [menuOpen, setMenuOpen] = useState(false);
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

  const changeView = (nextView: View) => {
    setView(nextView);
    setMenuOpen(false);
  };

  return (
    <div className={`app-shell ${menuOpen ? "menu-open" : "menu-collapsed"}`}>
      <aside className="sidebar" aria-label="Menú principal">
        <div className="sidebar-header">
          <button
            className="sidebar-brand"
            type="button"
            title="Ir al panel"
            onClick={() => changeView("dashboard")}
          >
            <span className="brand-mark">✓</span>
            <span className="sidebar-label brand-name">TaskFollower</span>
          </button>

          <button
            className="sidebar-toggle"
            type="button"
            aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? "‹" : "☰"}
          </button>
        </div>

        <nav className="sidebar-nav">
          <button
            className={`sidebar-item ${view === "dashboard" ? "sidebar-item-active" : ""}`}
            type="button"
            title="Panel de tareas"
            onClick={() => changeView("dashboard")}
          >
            <span className="sidebar-icon">⌂</span>
            <span className="sidebar-label">Tareas</span>
          </button>

          <button
            className={`sidebar-item ${view === "manage" ? "sidebar-item-active" : ""}`}
            type="button"
            title="Gestionar tareas"
            onClick={() => changeView("manage")}
          >
            <span className="sidebar-icon">⚙</span>
            <span className="sidebar-label">Gestionar</span>
          </button>

          <button
            className="sidebar-item sidebar-item-primary"
            type="button"
            title="Crear nueva tarea"
            onClick={openCreateForm}
          >
            <span className="sidebar-icon">＋</span>
            <span className="sidebar-label">Nueva tarea</span>
          </button>
        </nav>

        <div className="sidebar-spacer" />

        <div className="sidebar-user">
          <label htmlFor="selected-user" className="sidebar-label">
            Mostrar tareas de
          </label>
          <select
            id="selected-user"
            value={selectedUser}
            onChange={(event) => changeSelectedUser(event.target.value as UserFilter)}
            title="Seleccionar usuario"
          >
            <option value="all">Todos</option>
            {USERS.map((user) => (
              <option key={user} value={user}>
                {user}
              </option>
            ))}
          </select>
          <span className="sidebar-user-short" aria-hidden="true">
            {selectedUser === "all" ? "T" : selectedUser.charAt(0)}
          </span>
        </div>

        <div className={`sidebar-sync sync-${syncState}`} title={syncMessage}>
          <span className="sync-dot" />
          <div className="sidebar-label sidebar-sync-text">
            <span>{syncMessage}</span>
            {pendingCount > 0 && (
              <strong>
                {pendingCount === 1 ? "1 cambio pendiente" : `${pendingCount} cambios pendientes`}
              </strong>
            )}
          </div>
          {(syncState === "error" || syncState === "offline") && (
            <button className="sidebar-label" type="button" onClick={() => void retrySync()}>
              Reintentar
            </button>
          )}
        </div>
      </aside>

      {menuOpen && (
        <button
          className="sidebar-backdrop"
          type="button"
          aria-label="Cerrar menú"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <main className="main-content">
        {view === "dashboard" ? (
          <section className="dashboard-section">
            <header className="dashboard-toolbar">
              <div>
                <span className="eyebrow">Panel de tareas</span>
                <h1>
                  {selectedUser === "all" ? "Todas las tareas" : `Tareas de ${selectedUser}`}
                </h1>
              </div>

              <div className="summary-strip" aria-label="Resumen de tareas">
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
            </header>

            {pendingTasks.length ? (
              <div className="task-grid task-grid-dashboard">
                {pendingTasks.map((task, index) => (
                  <TaskCard
                    key={task.id}
                    featured={index === 0}
                    task={task}
                    activeUser={completionUserFor(task)}
                    onComplete={(item, user) => void completeTask(item, user)}
                    onEdit={openEditForm}
                  />
                ))}
              </div>
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
          </section>
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
