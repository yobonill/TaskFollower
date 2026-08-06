import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { LoginScreen } from "./components/LoginScreen";
import { LevelProgress, PapipointsPanel } from "./components/PapipointsPanel";
import { TaskCard } from "./components/TaskCard";
import { TaskForm } from "./components/TaskForm";
import { getAppUserByName, type AppUserDefinition } from "./config/appUsers";
import { useAuth } from "./hooks/useAuth";
import { usePapipoints } from "./hooks/usePapipoints";
import { usePwaInstall } from "./hooks/usePwaInstall";
import { useTasks } from "./hooks/useTasks";
import {
  USERS,
  type Task,
  type TaskExport,
  type TaskPriority,
  type UserFilter,
  type UserName,
} from "./models/task";
import {
  formatMissingRequiredFields,
  isTaskDataComplete,
} from "./utils/taskCompleteness";
import {
  formatDueDate,
  formatDuration,
  isTaskDueToday,
  isTaskOverdue,
  sortPendingTasks,
} from "./utils/taskDates";
import { getLevelFromPapipoints } from "./utils/papipoints";
import "./styles.css";

const USER_FILTER_KEY = "taskFollower.taskFilter.v1";
const APP_LOCALE = "es-DO";

type View = "dashboard" | "manage" | "papipoints";
type ImportMode = "merge" | "replace";

interface ToastState {
  message: string;
  actionLabel?: string;
  action?: () => void | Promise<void>;
}

interface PointsFeedbackState {
  amount: number;
  title: string;
  userName: UserName;
  levelMessage?: string;
}

const priorityLabels: Record<TaskPriority, string> = {
  low: "Baja",
  normal: "Normal",
  high: "Alta",
  critical: "Crítica",
};

const readSelectedUser = (defaultUser: UserName): UserFilter => {
  const value = localStorage.getItem(USER_FILTER_KEY);
  return value === "Yisel" || value === "Yorki" || value === "all"
    ? value
    : defaultUser;
};

const isTaskArray = (value: unknown): value is Task[] =>
  Array.isArray(value) &&
  value.every(
    (task) =>
      task &&
      typeof task === "object" &&
      typeof (task as Task).id === "string" &&
      ((task as Task).name === undefined || typeof (task as Task).name === "string"),
  );

const sumEstimatedMinutes = (tasks: Task[]): number =>
  tasks.reduce((total, task) => total + (task.estimatedMinutes || 0), 0);

interface TaskFollowerAppProps {
  currentUser: AppUserDefinition;
  onLogout: () => Promise<void>;
}

function TaskFollowerApp({ currentUser, onLogout }: TaskFollowerAppProps) {
  const {
    tasks,
    syncState,
    syncMessage,
    pendingCount: taskPendingCount,
    saveTask,
    completeTask,
    undoComplete,
    deleteTask,
    replaceTasks,
    mergeTasks,
    retrySync: retryTaskSync,
  } = useTasks(currentUser);
  const {
    transactions,
    rewards,
    profiles,
    pendingCount: papipointsPendingCount,
    awardTaskCreation,
    removeTaskCreationReward,
    awardTaskCompletion,
    removeTaskCompletionRewards,
    removeAllTaskTransactions,
    applyOverduePenalty,
    saveReward,
    deleteReward,
    redeemReward,
    retrySync: retryPapipointsSync,
  } = usePapipoints(currentUser);
  const { canInstall, install } = usePwaInstall();

  const [selectedUser, setSelectedUser] = useState<UserFilter>(() =>
    readSelectedUser(currentUser.name),
  );
  const [view, setView] = useState<View>("dashboard");
  const [menuOpen, setMenuOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [showCancelled, setShowCancelled] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>("merge");
  const [toast, setToast] = useState<ToastState | null>(null);
  const [pointsFeedback, setPointsFeedback] = useState<PointsFeedbackState | null>(null);
  const [installBannerHidden, setInstallBannerHidden] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toastTimerRef = useRef<number | null>(null);
  const pointsTimerRef = useRef<number | null>(null);
  const overdueCheckRef = useRef(new Set<string>());

  const totalPendingCount = taskPendingCount + papipointsPendingCount;

  const showToast = useCallback((nextToast: ToastState, duration = 9000) => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast(nextToast);
    toastTimerRef.current = window.setTimeout(() => setToast(null), duration);
  }, []);

  const showPointsFeedback = useCallback(
    (amount: number, title: string, userName: UserName) => {
      if (!amount) return;
      const currentBalance = profiles[userName].balance;
      const previousBalance = Math.max(0, currentBalance);
      const nextBalance = Math.max(0, previousBalance + amount);
      const previousLevel = getLevelFromPapipoints(previousBalance);
      const nextLevel = getLevelFromPapipoints(nextBalance);
      let levelMessage: string | undefined;
      if (nextLevel > previousLevel) levelMessage = `¡Subiste al nivel ${nextLevel}!`;
      if (nextLevel < previousLevel) levelMessage = `Ahora estás en el nivel ${nextLevel}.`;

      if (pointsTimerRef.current) window.clearTimeout(pointsTimerRef.current);
      setPointsFeedback({ amount, title, userName, levelMessage });
      pointsTimerRef.current = window.setTimeout(
        () => setPointsFeedback(null),
        levelMessage ? 5200 : 3400,
      );
    },
    [profiles],
  );

  const filteredTasks = useMemo(
    () =>
      selectedUser === "all"
        ? tasks
        : tasks.filter((task) => task.assignedTo === selectedUser),
    [selectedUser, tasks],
  );

  const pendingTasks = useMemo(
    () =>
      sortPendingTasks(
        filteredTasks.filter(
          (task) => task.status === "pending" && isTaskDataComplete(task),
        ),
      ),
    [filteredTasks],
  );

  const incompleteTasks = useMemo(
    () =>
      filteredTasks
        .filter(
          (task) => task.status === "pending" && !isTaskDataComplete(task),
        )
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        ),
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

  const cancelledTasks = useMemo(
    () =>
      filteredTasks
        .filter((task) => task.status === "cancelled")
        .sort(
          (a, b) =>
            new Date(b.cancelledAt || b.updatedAt).getTime() -
            new Date(a.cancelledAt || a.updatedAt).getTime(),
        ),
    [filteredTasks],
  );

  const overdueTasks = useMemo(
    () => pendingTasks.filter(isTaskOverdue),
    [pendingTasks],
  );
  const dueTodayTasks = useMemo(
    () => pendingTasks.filter(isTaskDueToday),
    [pendingTasks],
  );
  const workloadTasks = useMemo(
    () =>
      pendingTasks.filter(
        (task) => isTaskOverdue(task) || isTaskDueToday(task),
      ),
    [pendingTasks],
  );
  const workloadMinutes = sumEstimatedMinutes(workloadTasks);
  const overdueMinutes = sumEstimatedMinutes(overdueTasks);
  const todayMinutes = sumEstimatedMinutes(
    dueTodayTasks.filter((task) => !isTaskOverdue(task)),
  );
  const unestimatedWorkloadCount = workloadTasks.filter(
    (task) => !task.estimatedMinutes,
  ).length;

  useEffect(() => {
    const eligible = tasks.filter(
      (task) =>
        task.status === "pending" &&
        isTaskDataComplete(task) &&
        isTaskOverdue(task),
    );

    for (const task of eligible) {
      if (overdueCheckRef.current.has(task.id)) continue;
      overdueCheckRef.current.add(task.id);
      void applyOverduePenalty(task).then((amount) => {
        if (amount) {
          showPointsFeedback(amount, `Tarea vencida: ${task.name}`, task.assignedTo);
        }
      });
    }
  }, [applyOverduePenalty, showPointsFeedback, tasks]);

  const changeSelectedUser = (value: UserFilter) => {
    setSelectedUser(value);
    localStorage.setItem(USER_FILTER_KEY, value);
  };

  const openCreateForm = () => {
    setEditingTask(null);
    setShowForm(true);
    setMenuOpen(false);
  };

  const openEditForm = (task: Task) => {
    setEditingTask(task);
    setShowForm(true);
  };

  const closeForm = () => {
    setEditingTask(null);
    setShowForm(false);
  };

  const handleSave = async (task: Task, createAnother: boolean) => {
    const wasEditing = Boolean(editingTask);
    const complete = isTaskDataComplete(task);
    await saveTask(task);

    if (complete) {
      const points = await awardTaskCreation(task);
      if (points) showPointsFeedback(points, "Tarea creada", currentUser.name);
    }

    showToast(
      {
        message: complete
          ? wasEditing
            ? "Cambios guardados."
            : "Tarea guardada."
          : `Tarea guardada como incompleta. Faltan: ${formatMissingRequiredFields(task)}.`,
      },
      complete ? 3200 : 6500,
    );
    if (!createAnother) closeForm();
  };

  const handleComplete = async (task: Task) => {
    const completedAt = new Date().toISOString();
    const undo = await completeTask(task, currentUser);
    const points = await awardTaskCompletion(task, completedAt, currentUser);
    if (points) {
      showPointsFeedback(
        points,
        points > (task.priority ? { low: 5, normal: 10, high: 20, critical: 35 }[task.priority] : 0)
          ? "Tarea completada antes de tiempo"
          : "Tarea completada",
        currentUser.name,
      );
    }

    showToast({
      message: points
        ? `Tarea completada. Ganaste ${points} Papipuntos.`
        : "Tarea completada.",
      actionLabel: "Deshacer",
      action: async () => {
        const removed = await removeTaskCompletionRewards(task.id);
        await undoComplete(undo);
        if (removed) showPointsFeedback(removed, "Se deshizo la tarea completada", currentUser.name);
        showToast({ message: "La tarea volvió a estar pendiente." }, 3200);
      },
    });
  };

  const handleDuplicate = async (task: Task) => {
    const timestamp = new Date().toISOString();
    const duplicate: Task = {
      ...task,
      id: crypto.randomUUID(),
      status: "pending",
      source: "duplicate",
      assignedBy: currentUser.name,
      createdByUserId: currentUser.uid,
      assignedToUserId: getAppUserByName(task.assignedTo).uid,
      lastModifiedByUserId: currentUser.uid,
      completedAt: undefined,
      completedBy: undefined,
      completedByUserId: undefined,
      cancelledAt: undefined,
      cancelledBy: undefined,
      cancelledByUserId: undefined,
      recurrenceSeriesId:
        task.recurrence.type === "none" ? undefined : crypto.randomUUID(),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await saveTask(duplicate);
    showToast({ message: "Tarea duplicada. No genera Papipuntos por creación." }, 4200);
  };

  const handleReassign = async (task: Task, assignedTo: UserName) => {
    await saveTask({
      ...task,
      assignedTo,
      assignedToUserId: getAppUserByName(assignedTo).uid,
      lastModifiedByUserId: currentUser.uid,
      updatedAt: new Date().toISOString(),
    });
    showToast({ message: `Tarea asignada a ${assignedTo}.` }, 3200);
  };

  const handlePostpone = async (task: Task, dueDate: string) => {
    await saveTask({
      ...task,
      dueDate,
      status: "pending",
      cancelledAt: undefined,
      cancelledBy: undefined,
      cancelledByUserId: undefined,
      lastModifiedByUserId: currentUser.uid,
      updatedAt: new Date().toISOString(),
    });
    overdueCheckRef.current.delete(task.id);
    showToast({ message: "Fecha límite actualizada." }, 3200);
  };

  const handleCancelTask = async (task: Task) => {
    if (!window.confirm(`¿Cancelar la tarea “${task.name}”?`)) return;
    const original = task;
    const removed = await removeTaskCreationReward(task.id);
    await saveTask({
      ...task,
      status: "cancelled",
      cancelledAt: new Date().toISOString(),
      cancelledBy: currentUser.name,
      cancelledByUserId: currentUser.uid,
      lastModifiedByUserId: currentUser.uid,
      updatedAt: new Date().toISOString(),
    });
    if (removed) showPointsFeedback(removed, "Tarea cancelada", currentUser.name);
    showToast({
      message: "Tarea cancelada.",
      actionLabel: "Deshacer",
      action: async () => {
        await saveTask({
          ...original,
          status: "pending",
          cancelledAt: undefined,
          cancelledBy: undefined,
          cancelledByUserId: undefined,
          lastModifiedByUserId: currentUser.uid,
          updatedAt: new Date().toISOString(),
        });
        if (isTaskDataComplete(original)) {
          const restored = await awardTaskCreation(original);
          if (restored) showPointsFeedback(restored, "Tarea restaurada", currentUser.name);
        }
        showToast({ message: "La tarea fue restaurada." }, 3200);
      },
    });
  };

  const handleRestoreCancelled = async (task: Task) => {
    const restoredTask: Task = {
      ...task,
      status: "pending",
      cancelledAt: undefined,
      cancelledBy: undefined,
      cancelledByUserId: undefined,
      lastModifiedByUserId: currentUser.uid,
      updatedAt: new Date().toISOString(),
    };
    await saveTask(restoredTask);
    if (isTaskDataComplete(restoredTask)) {
      const restored = await awardTaskCreation(restoredTask);
      if (restored) showPointsFeedback(restored, "Tarea restaurada", currentUser.name);
    }
    showToast({ message: "Tarea restaurada." }, 3200);
  };

  const handleDelete = async (task: Task) => {
    const taskName = task.name.trim() || "Tarea sin nombre";
    if (!window.confirm(`¿Eliminar permanentemente la tarea “${taskName}”?`)) return;
    await removeAllTaskTransactions(task.id);
    await deleteTask(task.id);
    showToast({
      message: "Tarea eliminada junto con sus movimientos de Papipuntos.",
    }, 4200);
  };

  const handleInstall = async () => {
    const result = await install();
    if (result === "accepted" || result === "already-installed") {
      setInstallBannerHidden(true);
      showToast({ message: "TaskFollower está instalado." }, 3500);
      return;
    }
    if (result === "ios-instructions") {
      showToast(
        {
          message:
            "En iPhone o iPad: abre Compartir y selecciona “Añadir a pantalla de inicio”.",
        },
        12000,
      );
      return;
    }
    if (result === "browser-instructions") {
      showToast(
        {
          message:
            "Abre el menú del navegador y selecciona “Instalar aplicación” o “Añadir a pantalla de inicio”.",
        },
        12000,
      );
    }
  };

  const handleExport = () => {
    const payload: TaskExport = {
      schemaVersion: 3,
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

      const quantityText =
        importedTasks.length === 1 ? "1 tarea" : `${importedTasks.length} tareas`;
      const action =
        importMode === "replace"
          ? "reemplazar todas las tareas actuales"
          : "combinar estas tareas con las actuales";

      if (!window.confirm(`¿Importar ${quantityText} y ${action}?`)) return;

      if (importMode === "replace") await replaceTasks(importedTasks);
      else await mergeTasks(importedTasks);
      showToast({
        message:
          "Importación completada. Las tareas importadas no generan Papipuntos por creación.",
      }, 5200);
    } catch {
      window.alert("El archivo seleccionado no contiene JSON válido.");
    }
  };

  const handleLogout = async () => {
    if (totalPendingCount > 0) {
      const continueLogout = window.confirm(
        "Hay cambios pendientes de sincronizar. Si cierras sesión ahora, permanecerán guardados en este dispositivo hasta el próximo inicio de sesión. ¿Continuar?",
      );
      if (!continueLogout) return;
    }
    await onLogout();
  };

  const retryAllSync = async () => {
    await Promise.all([retryTaskSync(), retryPapipointsSync()]);
  };

  const changeView = (nextView: View) => {
    setView(nextView);
    setMenuOpen(false);
  };

  const runToastAction = async () => {
    const action = toast?.action;
    setToast(null);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    await action?.();
  };

  const dashboardProfiles =
    selectedUser === "all"
      ? [profiles.Yorki, profiles.Yisel]
      : [profiles[selectedUser]];

  return (
    <div className={`app-shell ${menuOpen ? "menu-open" : "menu-collapsed"}`}>
      <header className="mobile-header">
        <button
          className="mobile-menu-button"
          type="button"
          aria-label="Abrir menú"
          onClick={() => setMenuOpen(true)}
        >
          ☰
        </button>
        <button className="mobile-brand" type="button" onClick={() => changeView("dashboard")}>
          <span className="mobile-brand-mark">✓</span>
          <span>TaskFollower</span>
        </button>
        <select
          aria-label="Mostrar tareas de"
          value={selectedUser}
          onChange={(event) => changeSelectedUser(event.target.value as UserFilter)}
        >
          <option value={currentUser.name}>Mis tareas</option>
          {USERS.filter((user) => user !== currentUser.name).map((user) => (
            <option key={user} value={user}>Tareas de {user}</option>
          ))}
          <option value="all">Todas</option>
        </select>
      </header>

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
            className={`sidebar-item ${view === "papipoints" ? "sidebar-item-active" : ""}`}
            type="button"
            title="Papipuntos y recompensas"
            onClick={() => changeView("papipoints")}
          >
            <span className="sidebar-icon">★</span>
            <span className="sidebar-label">Papipuntos</span>
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

          {canInstall && (
            <button
              className="sidebar-item"
              type="button"
              title="Instalar TaskFollower"
              onClick={() => void handleInstall()}
            >
              <span className="sidebar-icon">⇩</span>
              <span className="sidebar-label">Instalar aplicación</span>
            </button>
          )}
        </nav>

        <div className="sidebar-spacer" />

        <div className="sidebar-account">
          <span className="sidebar-account-avatar" aria-hidden="true">
            {currentUser.name.charAt(0)}
          </span>
          <div className="sidebar-label sidebar-account-copy">
            <strong>{currentUser.name}</strong>
            <span>Nivel {profiles[currentUser.name].level}</span>
          </div>
          <button
            className="sidebar-label sidebar-logout"
            type="button"
            onClick={() => void handleLogout()}
          >
            Salir
          </button>
        </div>

        <div className="sidebar-user">
          <label htmlFor="selected-user" className="sidebar-label">Mostrar</label>
          <select
            id="selected-user"
            value={selectedUser}
            onChange={(event) => changeSelectedUser(event.target.value as UserFilter)}
            title="Seleccionar usuario"
          >
            <option value={currentUser.name}>Mis tareas</option>
            {USERS.filter((user) => user !== currentUser.name).map((user) => (
              <option key={user} value={user}>Tareas de {user}</option>
            ))}
            <option value="all">Todas</option>
          </select>
          <span className="sidebar-user-short" aria-hidden="true">
            {selectedUser === "all" ? "T" : selectedUser.charAt(0)}
          </span>
        </div>

        <div className={`sidebar-sync sync-${syncState}`} title={syncMessage}>
          <span className="sync-dot" />
          <div className="sidebar-label sidebar-sync-text">
            <span>{syncMessage}</span>
            {totalPendingCount > 0 && (
              <strong>
                {totalPendingCount === 1
                  ? "1 cambio pendiente"
                  : `${totalPendingCount} cambios pendientes`}
              </strong>
            )}
          </div>
          {(syncState === "error" || syncState === "offline") && (
            <button className="sidebar-label" type="button" onClick={() => void retryAllSync()}>
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
        {view === "dashboard" && (
          <section className="dashboard-section">
            <header className="dashboard-toolbar dashboard-toolbar-compact">
              <h1>
                {selectedUser === "all"
                  ? "Todas las tareas"
                  : selectedUser === currentUser.name
                    ? "Mis tareas"
                    : `Tareas de ${selectedUser}`}
              </h1>

              <div className="dashboard-levels">
                {dashboardProfiles.map((profile) => (
                  <LevelProgress key={profile.userId} profile={profile} />
                ))}
              </div>

              <div className="summary-strip" aria-label="Resumen de tareas">
                <div className={overdueTasks.length ? "summary-danger" : ""}>
                  <strong>{overdueTasks.length}</strong>
                  <span>Vencidas</span>
                </div>
                <div>
                  <strong>{dueTodayTasks.length}</strong>
                  <span>Para hoy</span>
                </div>
                <div>
                  <strong>{pendingTasks.length}</strong>
                  <span>Pendientes</span>
                </div>
                <button
                  type="button"
                  className={incompleteTasks.length ? "summary-incomplete" : ""}
                  onClick={() => changeView("manage")}
                  title="Ver tareas con datos incompletos"
                >
                  <strong>{incompleteTasks.length}</strong>
                  <span>Incompletas</span>
                </button>
              </div>

              <div className="workload-summary">
                <div>
                  <span>Tiempo pendiente entre hoy y vencidas</span>
                  <strong>{formatDuration(workloadMinutes || undefined)}</strong>
                </div>
                <small>
                  Hoy: {formatDuration(todayMinutes || undefined)} · Vencidas: {formatDuration(overdueMinutes || undefined)}
                  {unestimatedWorkloadCount > 0
                    ? ` · ${unestimatedWorkloadCount} ${unestimatedWorkloadCount === 1 ? "tarea sin estimar" : "tareas sin estimar"}`
                    : ""}
                </small>
              </div>
            </header>

            {pendingTasks.length ? (
              <div className="task-grid task-grid-dashboard">
                {pendingTasks.map((task, index) => (
                  <TaskCard
                    key={task.id}
                    featured={index === 0}
                    task={task}
                    onComplete={(item) => void handleComplete(item)}
                    onEdit={openEditForm}
                    onDuplicate={(item) => void handleDuplicate(item)}
                    onReassign={(item, user) => void handleReassign(item, user)}
                    onPostpone={(item, dueDate) => void handlePostpone(item, dueDate)}
                    onCancelTask={(item) => void handleCancelTask(item)}
                    onDelete={(item) => void handleDelete(item)}
                  />
                ))}
              </div>
            ) : (
              <section className="empty-state">
                <span className="empty-icon">✓</span>
                <h2>{incompleteTasks.length ? "No hay tareas listas" : "No hay tareas pendientes"}</h2>
                <p>
                  {incompleteTasks.length
                    ? "Hay tareas guardadas que todavía necesitan nombre, prioridad o fecha límite."
                    : "Todo en esta vista está completado."}
                </p>
                <button
                  className="button button-primary"
                  onClick={() => incompleteTasks.length ? changeView("manage") : openCreateForm()}
                >
                  {incompleteTasks.length ? "Completar datos" : "Crear una tarea"}
                </button>
              </section>
            )}
          </section>
        )}

        {view === "papipoints" && (
          <PapipointsPanel
            currentUser={currentUser}
            profiles={profiles}
            rewards={rewards}
            transactions={transactions}
            onSaveReward={saveReward}
            onDeleteReward={deleteReward}
            onRedeemReward={redeemReward}
            onMessage={(message) => showToast({ message }, 4200)}
          />
        )}

        {view === "manage" && (
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
              <button className="button button-secondary" onClick={handleExport}>Exportar JSON</button>
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

            <div className="task-list-panel incomplete-panel">
              <div className="list-heading">
                <div>
                  <h2>Tareas incompletas</h2>
                  <small>No aparecen en el panel hasta completar los campos requeridos.</small>
                </div>
                <span>{incompleteTasks.length}</span>
              </div>

              {incompleteTasks.length ? (
                <div className="management-list">
                  {incompleteTasks.map((task) => (
                    <article className="management-row incomplete-row" key={task.id}>
                      <span className="incomplete-mark">!</span>
                      <div className="management-main">
                        <strong>{task.name.trim() || "Tarea sin nombre"}</strong>
                        <span>
                          {task.assignedTo} · Faltan: {formatMissingRequiredFields(task)}
                        </span>
                      </div>
                      <span className="status-pill status-incomplete">Incompleta</span>
                      <div className="row-actions">
                        <button className="primary-row-action" onClick={() => openEditForm(task)}>
                          Completar datos
                        </button>
                        <button onClick={() => void handleDuplicate(task)}>Duplicar</button>
                        <button className="danger-action" onClick={() => void handleDelete(task)}>
                          Eliminar
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="list-empty">No hay tareas con datos incompletos.</p>
              )}
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
                      <span className={`priority-dot priority-dot-${task.priority || "normal"}`} />
                      <div className="management-main">
                        <strong>{task.name}</strong>
                        <span>
                          {task.assignedTo} · {formatDueDate(task)} · {formatDuration(task.estimatedMinutes)}
                        </span>
                      </div>
                      <span className={`status-pill ${isTaskOverdue(task) ? "status-overdue" : ""}`}>
                        {isTaskOverdue(task) ? "Vencida" : priorityLabels[task.priority || "normal"]}
                      </span>
                      <div className="row-actions">
                        <button onClick={() => openEditForm(task)}>Editar</button>
                        <button onClick={() => void handleComplete(task)}>Completar</button>
                        <button onClick={() => void handleDuplicate(task)}>Duplicar</button>
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
                          <button onClick={() => void handleDuplicate(task)}>Duplicar</button>
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

            <div className="task-list-panel completed-panel">
              <button className="completed-toggle" onClick={() => setShowCancelled(!showCancelled)}>
                <span>
                  <strong>Tareas canceladas</strong>
                  <small>{cancelledTasks.length} en esta vista</small>
                </span>
                <span>{showCancelled ? "−" : "+"}</span>
              </button>

              {showCancelled && (
                <div className="management-list">
                  {cancelledTasks.length ? (
                    cancelledTasks.map((task) => (
                      <article className="management-row cancelled-row" key={task.id}>
                        <span className="cancelled-mark">×</span>
                        <div className="management-main">
                          <strong>{task.name}</strong>
                          <span>Cancelada por {task.cancelledBy || task.assignedTo}</span>
                        </div>
                        <div className="row-actions">
                          <button onClick={() => void handleRestoreCancelled(task)}>Restaurar</button>
                          <button onClick={() => void handleDuplicate(task)}>Duplicar</button>
                          <button className="danger-action" onClick={() => void handleDelete(task)}>
                            Eliminar
                          </button>
                        </div>
                      </article>
                    ))
                  ) : (
                    <p className="list-empty">No hay tareas canceladas.</p>
                  )}
                </div>
              )}
            </div>
          </section>
        )}
      </main>

      <button
        className="floating-add-button"
        type="button"
        aria-label="Crear nueva tarea"
        onClick={openCreateForm}
      >
        +
      </button>

      {canInstall && !installBannerHidden && (
        <aside className="install-banner" aria-label="Instalar TaskFollower">
          <div>
            <strong>Instala TaskFollower</strong>
            <span>Ábrelo como una aplicación desde tu pantalla de inicio.</span>
          </div>
          <button className="button button-primary" type="button" onClick={() => void handleInstall()}>
            Instalar
          </button>
          <button
            className="install-close"
            type="button"
            aria-label="Cerrar aviso de instalación"
            onClick={() => setInstallBannerHidden(true)}
          >
            ×
          </button>
        </aside>
      )}

      {pointsFeedback && (
        <div className={`points-feedback ${pointsFeedback.amount >= 0 ? "points-gain" : "points-loss"}`} role="status">
          <strong>{pointsFeedback.amount >= 0 ? "+" : ""}{pointsFeedback.amount} Papipuntos</strong>
          <span>{pointsFeedback.title}</span>
          <small>{pointsFeedback.userName}</small>
          {pointsFeedback.levelMessage && <b>{pointsFeedback.levelMessage}</b>}
        </div>
      )}

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <span>{toast.message}</span>
          {toast.actionLabel && (
            <button type="button" onClick={() => void runToastAction()}>
              {toast.actionLabel}
            </button>
          )}
          <button className="toast-close" type="button" aria-label="Cerrar mensaje" onClick={() => setToast(null)}>
            ×
          </button>
        </div>
      )}

      {showForm && (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeForm}>
          <div
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-label={editingTask ? "Editar tarea" : "Nueva tarea"}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <TaskForm
              editingTask={editingTask}
              currentUser={currentUser}
              onSave={handleSave}
              onCancel={closeForm}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function App() {
  const { user, status, error, login, logout } = useAuth();

  if (status === "loading" && !user) {
    return (
      <main className="auth-loading-page">
        <div className="auth-loading-mark">✓</div>
        <strong>Abriendo TaskFollower…</strong>
      </main>
    );
  }

  if (!user) {
    return (
      <LoginScreen
        loading={status === "authenticating"}
        error={error}
        onLogin={login}
      />
    );
  }

  return <TaskFollowerApp currentUser={user} onLogout={logout} />;
}

export default App;
