import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { LoginScreen } from "./components/LoginScreen";
import { LevelProgress, PapipointsPanel } from "./components/PapipointsPanel";
import { TaskCard } from "./components/TaskCard";
import { getTaskFormDraftKey, TaskForm } from "./components/TaskForm";
import { TaskTemplatesPanel } from "./components/TaskTemplatesPanel";
import { getAppUserByName, type AppUserDefinition } from "./config/appUsers";
import { useAuth } from "./hooks/useAuth";
import { usePapipoints, type PapipointsChange } from "./hooks/usePapipoints";
import { usePwaInstall } from "./hooks/usePwaInstall";
import { useTasks } from "./hooks/useTasks";
import { useTemplates } from "./hooks/useTemplates";
import {
  USERS,
  type Task,
  type TaskAssignee,
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
  getNextDueDate,
  getTaskDate,
  isTaskDueToday,
  isTaskOverdue,
  sortPendingTasks,
} from "./utils/taskDates";
import {
  getLevelFromPapipoints,
  isCompletedEarly,
  OVERDUE_PENALTY,
} from "./utils/papipoints";
import { findSimilarOpenTasks } from "./utils/taskSimilarity";
import { getAssigneeUserIds, isTaskAssignedTo } from "./utils/taskAssignment";
import "./styles.css";

const USER_FILTER_KEY = "taskFollower.taskFilter.v1";
const APP_LOCALE = "es-DO";

type View = "dashboard" | "manage" | "papipoints";
type DashboardFilter = "all" | "overdue" | "today" | "pending" | "undated" | "incomplete" | "similar";
type ImportMode = "merge" | "replace";

interface ToastState {
  message: string;
  actionLabel?: string;
  action?: () => void | Promise<void>;
}

interface PointsFeedbackState {
  amountText: string;
  positive: boolean;
  title: string;
  userName: string;
  levelMessage?: string;
}

type TaskActionDialog =
  | { kind: "cancel"; task: Task }
  | { kind: "delete"; task: Task }
  | { kind: "stop-recurrence"; task: Task };

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
    rewardClaims,
    profiles,
    pendingCount: papipointsPendingCount,
    removePendingTaskCreationReward,
    awardTaskCompletion,
    removeTaskCompletionRewards,
    applyOverduePenalty,
    hasTaskOverduePenalty,
    saveReward,
    configureReward,
    rejectReward,
    deleteReward,
    redeemReward,
    completeRewardClaim,
    cancelRewardClaim,
    retrySync: retryPapipointsSync,
  } = usePapipoints(currentUser);
  const {
    templates,
    pendingCount: templatesPendingCount,
    saveTemplate,
    deleteTemplate,
    retrySync: retryTemplatesSync,
  } = useTemplates(currentUser);
  const { canInstall, install } = usePwaInstall();

  const [selectedUser, setSelectedUser] = useState<UserFilter>(() =>
    readSelectedUser(currentUser.name),
  );
  const [view, setView] = useState<View>("dashboard");
  const [dashboardFilter, setDashboardFilter] = useState<DashboardFilter>("all");
  const [similarTaskIds, setSimilarTaskIds] = useState<string[]>([]);
  const [reviewDraft, setReviewDraft] = useState<Task | null>(null);
  const [reviewEditing, setReviewEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [showCancelled, setShowCancelled] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>("merge");
  const [toast, setToast] = useState<ToastState | null>(null);
  const [pointsFeedback, setPointsFeedback] = useState<PointsFeedbackState | null>(null);
  const [taskActionDialog, setTaskActionDialog] = useState<TaskActionDialog | null>(null);
  const [installBannerHidden, setInstallBannerHidden] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toastTimerRef = useRef<number | null>(null);
  const pointsTimerRef = useRef<number | null>(null);

  const totalPendingCount = taskPendingCount + papipointsPendingCount + templatesPendingCount;

  const showToast = useCallback((nextToast: ToastState, duration = 9000) => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast(nextToast);
    toastTimerRef.current = window.setTimeout(() => setToast(null), duration);
  }, []);

  const buildLevelMessage = useCallback(
    (amount: number, userName: UserName): string | undefined => {
      const currentBalance = profiles[userName].balance;
      const previousBalance = Math.max(0, currentBalance);
      const nextBalance = Math.max(0, previousBalance + amount);
      const previousLevel = getLevelFromPapipoints(previousBalance);
      const nextLevel = getLevelFromPapipoints(nextBalance);
      if (nextLevel > previousLevel) return `${userName}: ¡subió al nivel ${nextLevel}!`;
      if (nextLevel < previousLevel) return `${userName}: ahora está en el nivel ${nextLevel}.`;
      return undefined;
    },
    [profiles],
  );

  const showPointsFeedback = useCallback(
    (amount: number, title: string, userName: UserName) => {
      if (!amount) return;
      const levelMessage = buildLevelMessage(amount, userName);

      if (pointsTimerRef.current) window.clearTimeout(pointsTimerRef.current);
      setPointsFeedback({
        amountText: `${amount >= 0 ? "+" : ""}${amount} Papipuntos`,
        positive: amount >= 0,
        title,
        userName,
        levelMessage,
      });
      pointsTimerRef.current = window.setTimeout(
        () => setPointsFeedback(null),
        levelMessage ? 5200 : 3400,
      );
    },
    [buildLevelMessage],
  );

  const showPointsChangesFeedback = useCallback(
    (changes: PapipointsChange[], title: string) => {
      const relevant = changes.filter((change) => change.amount !== 0);
      if (!relevant.length) return;
      if (relevant.length === 1) {
        const change = relevant[0];
        showPointsFeedback(change.amount, title, change.userName);
        return;
      }

      const levelMessages = relevant
        .map((change) => buildLevelMessage(change.amount, change.userName))
        .filter((message): message is string => Boolean(message));

      if (pointsTimerRef.current) window.clearTimeout(pointsTimerRef.current);
      setPointsFeedback({
        amountText: relevant
          .map((change) => `${change.userName}: ${change.amount >= 0 ? "+" : ""}${change.amount} PP`)
          .join(" · "),
        positive: relevant.every((change) => change.amount >= 0),
        title,
        userName: "Tarea compartida",
        levelMessage: levelMessages.length ? levelMessages.join(" · ") : undefined,
      });
      pointsTimerRef.current = window.setTimeout(
        () => setPointsFeedback(null),
        levelMessages.length ? 6200 : 4400,
      );
    },
    [buildLevelMessage, showPointsFeedback],
  );

  const filteredTasks = useMemo(
    () =>
      selectedUser === "all"
        ? tasks
        : tasks.filter((task) => isTaskAssignedTo(task, selectedUser)),
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
  const undatedTasks = useMemo(
    () => pendingTasks.filter((task) => !task.dueDate),
    [pendingTasks],
  );
  const todaySectionTasks = useMemo(
    () => pendingTasks.filter((task) => isTaskOverdue(task) || isTaskDueToday(task)),
    [pendingTasks],
  );
  const upcomingTasks = useMemo(
    () =>
      pendingTasks.filter(
        (task) => task.dueDate && !isTaskOverdue(task) && !isTaskDueToday(task),
      ),
    [pendingTasks],
  );
  const similarReviewTasks = useMemo(
    () =>
      sortPendingTasks(
        tasks.filter(
          (task) =>
            similarTaskIds.includes(task.id) &&
            task.status === "pending",
        ),
      ),
    [similarTaskIds, tasks],
  );
  const dashboardFilteredTasks = useMemo(() => {
    if (dashboardFilter === "overdue") return overdueTasks;
    if (dashboardFilter === "today") return dueTodayTasks;
    if (dashboardFilter === "pending") return pendingTasks;
    if (dashboardFilter === "undated") return undatedTasks;
    if (dashboardFilter === "similar") return similarReviewTasks;
    return pendingTasks;
  }, [dashboardFilter, dueTodayTasks, overdueTasks, pendingTasks, similarReviewTasks, undatedTasks]);
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

  const visibleRewardClaims = useMemo(() => {
    const pending = rewardClaims.filter((claim) => claim.status === "pending");
    if (selectedUser === "all") return pending;
    const selectedUid = getAppUserByName(selectedUser).uid;
    return pending.filter((claim) => claim.providerUserId === selectedUid);
  }, [currentUser, rewardClaims, selectedUser]);



  const changeSelectedUser = (value: UserFilter) => {
    setSelectedUser(value);
    localStorage.setItem(USER_FILTER_KEY, value);
  };

  const openCreateForm = () => {
    setEditingTask(null);
    setReviewEditing(false);
    setShowForm(true);
    setMenuOpen(false);
  };

  const openEditForm = (task: Task) => {
    setEditingTask(task);
    setReviewEditing(false);
    setShowForm(true);
  };

  const closeForm = () => {
    setEditingTask(null);
    setShowForm(false);
  };

  const persistTask = async (task: Task, wasEditing: boolean) => {
    const complete = isTaskDataComplete(task);
    await saveTask(task);

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
  };

  const clearSimilarReview = (clearDraft = false) => {
    setReviewDraft(null);
    setSimilarTaskIds([]);
    setReviewEditing(false);
    if (dashboardFilter === "similar") setDashboardFilter("all");
    if (clearDraft) localStorage.removeItem(getTaskFormDraftKey(currentUser.uid));
  };

  const handleSave = async (task: Task, createAnother: boolean) => {
    const wasEditing = Boolean(editingTask);

    // Editing the deadline of an already-overdue task is equivalent to
    // postponing it: the missed deadline must be resolved before the date can
    // be moved or removed.
    if (
      editingTask &&
      isTaskOverdue(editingTask) &&
      (task.dueDate !== editingTask.dueDate ||
        task.dueTime !== editingTask.dueTime)
    ) {
      const changes = await applyOverduePenalty(editingTask, true);
      showPointsChangesFeedback(
        changes,
        `Tarea vencida: ${editingTask.name}`,
      );
    }

    await persistTask(task, wasEditing);
    if (reviewEditing) clearSimilarReview(true);
    if (!createAnother) closeForm();
  };

  const handleReviewSimilar = (draft: Task, similarTasks: Task[]) => {
    setReviewDraft(draft);
    setSimilarTaskIds(similarTasks.map((task) => task.id));
    setDashboardFilter("similar");
    setReviewEditing(false);
    setView("dashboard");
    setShowForm(false);
    setEditingTask(null);
    setMenuOpen(false);
  };

  const createReviewedDraft = async () => {
    if (!reviewDraft) return;
    await persistTask(reviewDraft, false);
    clearSimilarReview(true);
  };

  const editReviewedDraft = () => {
    if (!reviewDraft) return;
    setReviewEditing(true);
    setEditingTask(null);
    setShowForm(true);
  };

  const handleComplete = async (task: Task) => {
    const completedAt = new Date().toISOString();
    const wasOverdue = isTaskOverdue(task);
    const hadPreviousPenalty = hasTaskOverduePenalty(task.id);
    const undo = await completeTask(task, currentUser);
    const pointChanges = await awardTaskCompletion(task, completedAt, currentUser);

    const positiveChanges = pointChanges.filter((change) => change.amount > 0);
    const negativeChanges = pointChanges.filter((change) => change.amount < 0);
    const hasPenaltyHistory = hadPreviousPenalty || hasTaskOverduePenalty(task.id);
    const early = Boolean(
      positiveChanges.length &&
        !wasOverdue &&
        task.priority &&
        isCompletedEarly(task, completedAt),
    );

    showPointsChangesFeedback(
      pointChanges,
      negativeChanges.length
        ? "Penalización acumulada por vencimiento"
        : early
          ? "Tarea completada antes de tiempo"
          : "Tarea completada",
    );

    const totalPositive = positiveChanges.reduce(
      (total, change) => total + change.amount,
      0,
    );

    let message = "Tarea completada.";
    if (negativeChanges.length) {
      message =
        "Tarea completada. Se descontaron los Papipuntos acumulados por los días de atraso. No se otorgaron Papipuntos por completar esta tarea.";
    } else if (hasPenaltyHistory) {
      message =
        "Tarea completada sin recompensa. Esta tarea ya había recibido penalizaciones por vencimiento, por eso no otorga Papipuntos al completarse.";
    } else if (!positiveChanges.length) {
      message =
        "Tarea completada. Su recompensa de Papipuntos ya había sido procesada y no se generan puntos adicionales.";
    } else if (task.assignedTo === "Ambos" && positiveChanges.length > 1) {
      message = "Tarea compartida completada. Ambos recibieron Papipuntos.";
    } else if (totalPositive > 0) {
      message = `Tarea completada. Ganaste ${totalPositive} Papipuntos.`;
    }

    showToast({
      message,
      actionLabel: "Deshacer",
      action: async () => {
        const removed = await removeTaskCompletionRewards(task.id);
        await undoComplete(undo);
        showPointsChangesFeedback(removed, "Se deshizo la tarea completada");
        showToast(
          {
            message: removed.length
              ? "La tarea volvió a estar pendiente y se retiró su recompensa."
              : hasPenaltyHistory || negativeChanges.length
                ? "La tarea volvió a estar pendiente. Las penalizaciones por vencimiento se mantienen."
                : "La tarea volvió a estar pendiente.",
          },
          4200,
        );
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
      assignedTo: task.isPrivate ? currentUser.name : task.assignedTo,
      assignedToUserId: task.isPrivate
        ? currentUser.uid
        : task.assignedTo === "Ambos"
          ? undefined
          : getAssigneeUserIds(task.assignedTo)[0],
      assignedToUserIds: task.isPrivate
        ? [currentUser.uid]
        : getAssigneeUserIds(task.assignedTo),
      isPrivate: task.isPrivate === true,
      privateOwnerUserId: task.isPrivate ? currentUser.uid : undefined,
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

  const handleReassign = async (task: Task, assignedTo: TaskAssignee) => {
    if (task.isPrivate) {
      showToast({
        message: "Las tareas privadas solo pueden estar asignadas al usuario que las creó.",
      }, 4200);
      return;
    }

    await saveTask({
      ...task,
      assignedTo,
      assignedToUserId:
        assignedTo === "Ambos" ? undefined : getAssigneeUserIds(assignedTo)[0],
      assignedToUserIds: getAssigneeUserIds(assignedTo),
      lastModifiedByUserId: currentUser.uid,
      updatedAt: new Date().toISOString(),
    });
    showToast({ message: `Tarea asignada a ${assignedTo}.` }, 3200);
  };

  const handlePostpone = async (task: Task, dueDate: string) => {
    if (isTaskOverdue(task)) {
      const changes = await applyOverduePenalty(task, true);
      showPointsChangesFeedback(changes, `Tarea vencida: ${task.name}`);
    }

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
    showToast({
      message: isTaskOverdue(task)
        ? "Tarea pospuesta. Se aplicaron las penalizaciones acumuladas por los días de atraso. Esta tarea ya no otorgará Papipuntos al completarse; si vuelve a vencerse, acumulará nuevas penalizaciones."
        : "Fecha límite actualizada sin penalización. La tarea mantiene su elegibilidad para recibir Papipuntos.",
    }, 5200);
  };

  const detachRecurrence = (task: Task): Task => ({
    ...task,
    recurrence: { type: "none", interval: 1 },
  });

  const createNextRecurringOccurrence = async (task: Task): Promise<string | undefined> => {
    if (task.recurrence.type === "none" || !task.dueDate) return undefined;
    const timestamp = new Date().toISOString();
    const nextDueDate = getNextDueDate(task.dueDate, task.recurrence, timestamp);
    if (task.recurrence.endDate && nextDueDate > task.recurrence.endDate) return undefined;

    const nextTaskId = crypto.randomUUID();
    await saveTask({
      ...task,
      id: nextTaskId,
      dueDate: nextDueDate,
      status: "pending",
      source: "recurrence",
      recurrenceSeriesId: task.recurrenceSeriesId || task.id,
      completedAt: undefined,
      completedBy: undefined,
      completedByUserId: undefined,
      cancelledAt: undefined,
      cancelledBy: undefined,
      cancelledByUserId: undefined,
      lastModifiedByUserId: currentUser.uid,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return nextTaskId;
  };

  const stopOtherActiveOccurrencesInSeries = async (task: Task): Promise<void> => {
    const seriesId = task.recurrenceSeriesId || task.id;
    const activeSeriesTasks = tasks.filter((item) => {
      if (item.id === task.id || item.status !== "pending" || item.recurrence.type === "none") return false;
      return (item.recurrenceSeriesId || item.id) === seriesId;
    });
    for (const item of activeSeriesTasks) {
      await saveTask({
        ...item,
        recurrence: { type: "none", interval: 1 },
        lastModifiedByUserId: currentUser.uid,
        updatedAt: new Date().toISOString(),
      });
    }
  };

  const handleCancelTask = (task: Task) => {
    setTaskActionDialog({ kind: "cancel", task });
  };

  const executeCancelTask = async (task: Task, continueRecurrence: boolean) => {
    setTaskActionDialog(null);
    const original = task;

    let overdueChanges: PapipointsChange[] = [];
    if (isTaskOverdue(task)) {
      overdueChanges = await applyOverduePenalty(task, true);
      showPointsChangesFeedback(overdueChanges, `Tarea vencida: ${task.name}`);
    }

    const removedLegacyCreation = await removePendingTaskCreationReward(task.id);
    const timestamp = new Date().toISOString();
    await saveTask({
      ...detachRecurrence(task),
      status: "cancelled",
      cancelledAt: timestamp,
      cancelledBy: currentUser.name,
      cancelledByUserId: currentUser.uid,
      lastModifiedByUserId: currentUser.uid,
      updatedAt: timestamp,
    });

    const generatedTaskId =
      continueRecurrence && task.recurrence.type !== "none"
        ? await createNextRecurringOccurrence(task)
        : undefined;

    if (removedLegacyCreation && !overdueChanges.length) {
      showPointsFeedback(
        removedLegacyCreation.amount,
        "Se corrigió el bono de creación pendiente",
        removedLegacyCreation.userName,
      );
    }

    showToast({
      message: overdueChanges.length
        ? continueRecurrence
          ? "Ocurrencia cancelada. Se aplicó la penalización por vencimiento y la serie continuará con la próxima fecha."
          : "Tarea recurrente cancelada. Se aplicó la penalización por vencimiento y la recurrencia quedó detenida."
        : continueRecurrence
          ? "Ocurrencia cancelada. No otorgará Papipuntos y la serie continuará con la próxima fecha."
          : task.recurrence.type !== "none"
            ? "Tarea cancelada y recurrencia detenida."
            : "Tarea cancelada.",
      actionLabel: "Deshacer",
      action: async () => {
        if (generatedTaskId) await deleteTask(generatedTaskId);
        await saveTask({
          ...original,
          status: "pending",
          cancelledAt: undefined,
          cancelledBy: undefined,
          cancelledByUserId: undefined,
          lastModifiedByUserId: currentUser.uid,
          updatedAt: new Date().toISOString(),
        });
        showToast(
          {
            message: overdueChanges.length
              ? "La tarea fue restaurada. La penalización por vencimiento se mantiene."
              : "La tarea y su configuración de recurrencia fueron restauradas.",
          },
          4200,
        );
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
    showToast({ message: "Tarea restaurada." }, 3200);
  };

  const handleDelete = (task: Task) => {
    setTaskActionDialog({ kind: "delete", task });
  };

  const executeDeleteTask = async (task: Task, continueRecurrence: boolean) => {
    setTaskActionDialog(null);

    let overdueChanges: PapipointsChange[] = [];
    if (isTaskOverdue(task)) {
      overdueChanges = await applyOverduePenalty(task, true);
      showPointsChangesFeedback(overdueChanges, `Tarea vencida: ${task.name}`);
    }

    if (!continueRecurrence && task.recurrence.type !== "none") {
      await stopOtherActiveOccurrencesInSeries(task);
    }

    await deleteTask(task.id);

    if (
      continueRecurrence &&
      task.status === "pending" &&
      task.recurrence.type !== "none"
    ) {
      await createNextRecurringOccurrence(task);
    }

    showToast({
      message: overdueChanges.length
        ? continueRecurrence
          ? "Ocurrencia eliminada. La penalización aplicada permanece y la serie continuará."
          : "Tarea eliminada y recurrencia detenida. La penalización aplicada permanece en el historial de Papipuntos."
        : continueRecurrence && task.recurrence.type !== "none"
          ? "Ocurrencia eliminada. La próxima ocurrencia de la serie se mantiene o fue creada."
          : task.recurrence.type !== "none"
            ? "Tarea eliminada y recurrencia detenida. Las ocurrencias anteriores permanecen en el historial."
            : "Tarea eliminada. Los movimientos de Papipuntos ya resueltos se conservan.",
    }, 5200);
  };

  const handleStopRecurrence = (task: Task) => {
    setTaskActionDialog({ kind: "stop-recurrence", task });
  };

  const executeStopRecurrence = async (task: Task) => {
    setTaskActionDialog(null);
    await saveTask({
      ...task,
      recurrence: { type: "none", interval: 1 },
      lastModifiedByUserId: currentUser.uid,
      updatedAt: new Date().toISOString(),
    });
    showToast({
      message: "Recurrencia detenida. La tarea actual sigue pendiente y podrá completarse normalmente, pero no creará otra ocurrencia.",
    }, 5200);
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
      schemaVersion: 5,
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
    await Promise.all([retryTaskSync(), retryPapipointsSync(), retryTemplatesSync()]);
  };

  const changeView = (nextView: View) => {
    setView(nextView);
    setMenuOpen(false);
  };

  const toggleDashboardFilter = (filter: DashboardFilter) => {
    setView("dashboard");
    setDashboardFilter((current) => (current === filter ? "all" : filter));
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

  const renderDashboardTasks = (items: Task[]) => (
    <div className="task-grid task-grid-dashboard">
      {items.map((task, index) =>
        isTaskDataComplete(task) ? (
          <TaskCard
            key={task.id}
            featured={index === 0}
            task={task}
            onComplete={(item) => void handleComplete(item)}
            onEdit={openEditForm}
            onDuplicate={(item) => void handleDuplicate(item)}
            onReassign={(item, user) => void handleReassign(item, user)}
            onPostpone={(item, dueDate) => void handlePostpone(item, dueDate)}
            onCancelTask={(item) => handleCancelTask(item)}
            onStopRecurrence={(item) => handleStopRecurrence(item)}
            onDelete={(item) => handleDelete(item)}
          />
        ) : (
          <article className="dashboard-incomplete-card" key={task.id}>
            <div className="task-card-topline">
              <span className="status-pill status-incomplete">Incompleta</span>
              {task.isPrivate && <span className="private-task-label">🔒 Privada</span>}
            </div>
            <h2>{task.name.trim() || "Tarea sin nombre"}</h2>
            <p>Faltan: {formatMissingRequiredFields(task)}</p>
            <small>Asignada a {task.assignedTo}</small>
            <button className="button button-primary" type="button" onClick={() => openEditForm(task)}>
              Completar datos
            </button>
          </article>
        ),
      )}
    </div>
  );

  const renderRewardClaims = () => (
    <section className="dashboard-task-group reward-obligation-section">
      <div className="dashboard-section-heading">
        <div>
          <span className="eyebrow">Entrega prioritaria</span>
          <h2>🎁 Recompensas por entregar</h2>
        </div>
        <span className="section-count">{visibleRewardClaims.length}</span>
      </div>
      <div className="reward-obligation-grid">
        {visibleRewardClaims.map((claim) => {
          const requesterName = claim.requesterUserId === currentUser.uid
            ? currentUser.name
            : currentUser.name === "Yorki" ? "Yisel" : "Yorki";
          const providerName = claim.providerUserId === currentUser.uid
            ? currentUser.name
            : currentUser.name === "Yorki" ? "Yisel" : "Yorki";
          const [year, month, day] = claim.dueDate.split("-").map(Number);
          const dueDate = new Date(year, month - 1, day);
          const dueLabel = new Intl.DateTimeFormat(APP_LOCALE, { weekday: "short", day: "numeric", month: "short" })
            .format(dueDate);
          const today = new Date();
          const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
          const overdueDays = Math.max(0, Math.floor((todayStart.getTime() - dueDate.getTime()) / 86_400_000));
          const isRewardOverdue = overdueDays > 0;
          const dailyPenalty = Math.max(1, Math.ceil(claim.cost * claim.overdueTransferPercent / 100));
          const isProvider = claim.providerUserId === currentUser.uid;
          const isRequester = claim.requesterUserId === currentUser.uid;
          return (
            <article className={`reward-obligation-card ${isRewardOverdue ? "reward-obligation-overdue" : ""}`} key={claim.id}>
              <div className="reward-obligation-topline"><span>{isRewardOverdue ? `⚠ VENCIDA · ${overdueDays} ${overdueDays === 1 ? "día" : "días"}` : "🎁 RECOMPENSA"}</span><strong>PRIORIDAD MÁXIMA</strong></div>
              <h3>{claim.rewardName}</h3>
              {claim.rewardDescription && <p>{claim.rewardDescription}</p>}
              <div className="reward-obligation-meta">
                <span>Para: <b>{requesterName}</b></span>
                <span>La entrega: <b>{providerName}</b></span>
                <span>Fecha límite: <b>{dueLabel}</b></span>
                <span>Vencida: <b>{dailyPenalty} PP/día</b> se transfieren a {requesterName}</span>
              </div>
              <div className="reward-actions">
                {isProvider && <button className="button button-primary" type="button" onClick={() => {
                  if (!window.confirm(`Confirmar entrega de “${claim.rewardName}”.\n\nAl completarla se detendrán las penalizaciones diarias por atraso.`)) return;
                  void completeRewardClaim(claim).then((result) => showToast({ message: result.message }, 5200));
                }}>Marcar como entregada</button>}
                {isRequester && <button className="button button-quiet danger-action" type="button" onClick={() => {
                  const refund = Math.floor(claim.cost * 0.7);
                  if (!window.confirm(`Cancelar recompensa\n\nRecuperarás solo el 70% (${refund} Papipuntos). Las compensaciones por atraso ya transferidas no se devolverán.\n\n¿Continuar?`)) return;
                  void cancelRewardClaim(claim).then((result) => showToast({ message: result.message }, 5200));
                }}>Cancelar canje</button>}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );

  const filterLabels: Record<Exclude<DashboardFilter, "all" | "similar">, string> = {
    overdue: "Tareas vencidas",
    today: "Tareas para hoy",
    pending: "Todas las tareas pendientes",
    undated: "Tareas sin fecha",
    incomplete: "Tareas incompletas",
  };

  const getPenaltyPreview = (task: Task): string => {
    if (!isTaskOverdue(task) || !task.priority || !task.dueDate) return "";
    const due = getTaskDate(task);
    if (!due) return "";
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const dueStart = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    const calendarDifference = Math.max(
      0,
      Math.round((todayStart.getTime() - dueStart.getTime()) / 86_400_000),
    );
    const overdueDays = task.dueTime
      ? Math.max(1, calendarDifference + 1)
      : Math.max(1, calendarDifference);
    const dailyPenalty = OVERDUE_PENALTY[task.priority];
    const maximumPenalty = overdueDays * dailyPenalty;

    if (task.assignedTo === "Ambos") {
      const yorkiPenalty = Math.min(maximumPenalty, profiles.Yorki.balance);
      const yiselPenalty = Math.min(maximumPenalty, profiles.Yisel.balance);
      if (!yorkiPenalty && !yiselPenalty) {
        return `Esta tarea lleva ${overdueDays} ${overdueDays === 1 ? "día" : "días"} vencida. No hay Papipuntos disponibles para descontar, pero el atraso quedará registrado para ambos y esta ocurrencia no podrá otorgar Papipuntos.`;
      }
      return `Esta tarea lleva ${overdueDays} ${overdueDays === 1 ? "día" : "días"} vencida. Antes de continuar se aplicarán las penalizaciones pendientes: hasta ${yorkiPenalty} Papipuntos a Yorki y ${yiselPenalty} a Yisel.`;
    }

    const assignee = task.assignedTo;
    const availableBalance = profiles[assignee].balance;
    const actualMaximum = Math.min(maximumPenalty, availableBalance);
    if (!actualMaximum) {
      return `Esta tarea lleva ${overdueDays} ${overdueDays === 1 ? "día" : "días"} vencida. ${assignee} no tiene Papipuntos disponibles para descontar, pero el atraso quedará registrado y esta tarea no podrá otorgar Papipuntos.`;
    }
    return `Esta tarea lleva ${overdueDays} ${overdueDays === 1 ? "día" : "días"} vencida. Antes de continuar se descontarán hasta ${actualMaximum} Papipuntos a ${assignee} por los días de atraso pendientes.`;
  };

  const taskActionContent = taskActionDialog
    ? (() => {
        const task = taskActionDialog.task;
        const recurring = task.recurrence.type !== "none";
        const penaltyText = getPenaltyPreview(task);

        if (taskActionDialog.kind === "stop-recurrence") {
          return {
            title: "Detener recurrencia",
            paragraphs: [
              "La tarea actual seguirá pendiente y podrás completarla normalmente.",
              "Después de detener la recurrencia, completar esta tarea no creará una nueva ocurrencia.",
              penaltyText
                ? `${penaltyText} Detener la recurrencia por sí sola no aplica ni elimina esa penalización.`
                : "Detener la recurrencia no modifica los Papipuntos de la tarea actual.",
            ],
          };
        }

        if (taskActionDialog.kind === "cancel") {
          return {
            title: recurring ? "Cancelar tarea recurrente" : "Cancelar tarea",
            paragraphs: recurring
              ? [
                  penaltyText,
                  "Si cancelas solo esta ocurrencia, quedará registrada como cancelada, no otorgará Papipuntos y se creará la próxima ocurrencia válida de la serie.",
                  "Si cancelas esta y detienes la recurrencia, esta ocurrencia quedará cancelada y no se crearán nuevas tareas de esta serie.",
                ].filter(Boolean)
              : [
                  penaltyText,
                  "La tarea quedará registrada como cancelada y no otorgará Papipuntos. Podrás restaurarla posteriormente; cualquier penalización por vencimiento aplicada permanecerá.",
                ].filter(Boolean),
          };
        }

        const historical = task.status !== "pending";
        return {
          title: recurring ? "Eliminar tarea recurrente" : "Eliminar tarea",
          paragraphs: recurring
            ? [
                penaltyText,
                historical
                  ? "Eliminar solo esta ocurrencia borrará únicamente este registro histórico. La ocurrencia activa de la serie no será duplicada ni eliminada."
                  : "Eliminar solo esta ocurrencia la borrará permanentemente y se creará la próxima ocurrencia válida para que la serie continúe.",
                historical
                  ? "Eliminar esta y detener la recurrencia borrará este registro y hará que la ocurrencia activa de la serie deje de repetirse. El resto del historial se conservará."
                  : "Eliminar esta y detener la recurrencia borrará esta ocurrencia y no se crearán nuevas tareas de la serie. Las ocurrencias anteriores permanecerán en el historial.",
                "Los movimientos de Papipuntos que ya hayan sido resueltos no se eliminan al borrar la tarea.",
              ].filter(Boolean)
            : [
                penaltyText,
                "La tarea será eliminada permanentemente y no podrá restaurarse. Los movimientos de Papipuntos ya resueltos se conservarán.",
              ].filter(Boolean),
        };
      })()
    : null;

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
                {dashboardFilter === "similar"
                  ? "Revisar tareas similares"
                  : selectedUser === "all"
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

              <div className="summary-strip" aria-label="Resumen y filtros de tareas">
                <button
                  type="button"
                  className={`${overdueTasks.length ? "summary-danger" : ""} ${dashboardFilter === "overdue" ? "summary-active" : ""}`}
                  onClick={() => toggleDashboardFilter("overdue")}
                >
                  <strong>{overdueTasks.length}</strong>
                  <span>Vencidas</span>
                </button>
                <button
                  type="button"
                  className={dashboardFilter === "today" ? "summary-active" : ""}
                  onClick={() => toggleDashboardFilter("today")}
                >
                  <strong>{dueTodayTasks.length}</strong>
                  <span>Para hoy</span>
                </button>
                <button
                  type="button"
                  className={dashboardFilter === "pending" ? "summary-active" : ""}
                  onClick={() => toggleDashboardFilter("pending")}
                >
                  <strong>{pendingTasks.length}</strong>
                  <span>Pendientes</span>
                </button>
                <button
                  type="button"
                  className={dashboardFilter === "undated" ? "summary-active" : ""}
                  onClick={() => toggleDashboardFilter("undated")}
                >
                  <strong>{undatedTasks.length}</strong>
                  <span>Sin fecha</span>
                </button>
                <button
                  type="button"
                  className={`${incompleteTasks.length ? "summary-incomplete" : ""} ${dashboardFilter === "incomplete" ? "summary-active" : ""}`}
                  onClick={() => toggleDashboardFilter("incomplete")}
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

            {reviewDraft && (
              <section className="similar-review-banner">
                <div>
                  <span className="eyebrow">Revisión antes de crear</span>
                  <strong>“{reviewDraft.name || "Tarea sin nombre"}”</strong>
                  <small>Revisa las tareas similares. Tu nueva tarea todavía no ha sido creada.</small>
                </div>
                <div className="similar-review-actions">
                  <button className="button button-primary" type="button" onClick={() => void createReviewedDraft()}>
                    Crear tarea
                  </button>
                  <button className="button button-secondary" type="button" onClick={editReviewedDraft}>
                    Editar antes de crear
                  </button>
                  <button className="button button-quiet" type="button" onClick={() => clearSimilarReview(true)}>
                    Cancelar
                  </button>
                </div>
              </section>
            )}

            {visibleRewardClaims.length > 0 && renderRewardClaims()}

            {dashboardFilter !== "all" ? (
              <section className="dashboard-filtered-section">
                <div className="dashboard-section-heading">
                  <div>
                    <span className="eyebrow">Filtro activo</span>
                    <h2>
                      {dashboardFilter === "similar"
                        ? "Tareas similares"
                        : filterLabels[dashboardFilter as Exclude<DashboardFilter, "all" | "similar">]}
                    </h2>
                  </div>
                  <button className="button button-quiet" type="button" onClick={() => setDashboardFilter("all")}>
                    Quitar filtro
                  </button>
                </div>

                {dashboardFilter === "incomplete"
                  ? incompleteTasks.length
                    ? renderDashboardTasks(incompleteTasks)
                    : <p className="section-empty">No hay tareas incompletas.</p>
                  : dashboardFilteredTasks.length
                    ? renderDashboardTasks(dashboardFilteredTasks)
                    : <p className="section-empty">No hay tareas en este filtro.</p>}
              </section>
            ) : pendingTasks.length ? (
              <div className="dashboard-groups">
                <section className="dashboard-task-group today-task-group">
                  <div className="dashboard-section-heading">
                    <div>
                      <span className="eyebrow">Prioridad del día</span>
                      <h2>Hoy</h2>
                    </div>
                    <span className="section-count">{todaySectionTasks.length}</span>
                  </div>
                  {todaySectionTasks.length
                    ? renderDashboardTasks(todaySectionTasks)
                    : <p className="section-empty">No tienes tareas para hoy ni tareas vencidas.</p>}
                </section>

                {upcomingTasks.length > 0 && (
                  <section className="dashboard-task-group">
                    <div className="dashboard-section-heading">
                      <h2>Próximas</h2>
                      <span className="section-count">{upcomingTasks.length}</span>
                    </div>
                    {renderDashboardTasks(upcomingTasks)}
                  </section>
                )}

                {undatedTasks.length > 0 && (
                  <section className="dashboard-task-group undated-task-group">
                    <div className="dashboard-section-heading">
                      <div>
                        <h2>Sin fecha</h2>
                        <small>Tareas válidas que no tienen una fecha límite.</small>
                      </div>
                      <span className="section-count">{undatedTasks.length}</span>
                    </div>
                    {renderDashboardTasks(undatedTasks)}
                  </section>
                )}
              </div>
            ) : (
              <section className="empty-state">
                <span className="empty-icon">✓</span>
                <h2>{incompleteTasks.length ? "No hay tareas listas" : "No hay tareas pendientes"}</h2>
                <p>
                  {incompleteTasks.length
                    ? "Hay tareas guardadas que todavía necesitan nombre o prioridad."
                    : "Todo en esta vista está completado."}
                </p>
                <button
                  className="button button-primary"
                  onClick={() => incompleteTasks.length ? toggleDashboardFilter("incomplete") : openCreateForm()}
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
            rewardClaims={rewardClaims}
            transactions={transactions}
            onSaveReward={saveReward}
            onConfigureReward={configureReward}
            onRejectReward={rejectReward}
            onDeleteReward={deleteReward}
            onRedeemReward={redeemReward}
            onCompleteRewardClaim={completeRewardClaim}
            onCancelRewardClaim={cancelRewardClaim}
            onMessage={(message) => showToast({ message }, 4200)}
          />
        )}

        {view === "manage" && (
          <section className="manage-section">
            <div className="manage-heading">
              <div>
                <span className="eyebrow">Gestión</span>
                <h1>Tareas y datos</h1>
                <p>Crea, edita, completa, importa o exporta tus tareas. Las tareas privadas solo son visibles para su dueño.</p>
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

            <TaskTemplatesPanel
              currentUser={currentUser}
              templates={templates}
              onSave={saveTemplate}
              onDelete={deleteTemplate}
              onMessage={(message) => showToast({ message }, 3600)}
            />

            <div className="task-list-panel incomplete-panel">
              <div className="list-heading">
                <div>
                  <h2>Tareas incompletas</h2>
                  <small>No aparecen en el panel hasta completar el nombre y la prioridad.</small>
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
        <div className={`points-feedback ${pointsFeedback.positive ? "points-gain" : "points-loss"}`} role="status">
          <strong>{pointsFeedback.amountText}</strong>
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

      {taskActionDialog && taskActionContent && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setTaskActionDialog(null)}>
          <div
            className="action-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-action-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <span className="eyebrow">Confirmar acción</span>
            <h2 id="task-action-dialog-title">{taskActionContent.title}</h2>
            <strong className="action-task-name">“{taskActionDialog.task.name || "Tarea sin nombre"}”</strong>
            <div className="action-confirm-copy">
              {taskActionContent.paragraphs.map((paragraph, index) => (
                <p key={`${index}-${paragraph}`}>{paragraph}</p>
              ))}
            </div>

            <div className="action-confirm-buttons">
              {taskActionDialog.kind === "stop-recurrence" && (
                <button className="button button-primary" type="button" onClick={() => void executeStopRecurrence(taskActionDialog.task)}>
                  Detener recurrencia
                </button>
              )}

              {taskActionDialog.kind === "cancel" && taskActionDialog.task.recurrence.type === "none" && (
                <button className="button button-primary" type="button" onClick={() => void executeCancelTask(taskActionDialog.task, false)}>
                  Cancelar tarea
                </button>
              )}

              {taskActionDialog.kind === "cancel" && taskActionDialog.task.recurrence.type !== "none" && (
                <>
                  <button className="button button-primary" type="button" onClick={() => void executeCancelTask(taskActionDialog.task, true)}>
                    Cancelar solo esta ocurrencia
                  </button>
                  <button className="button button-secondary" type="button" onClick={() => void executeCancelTask(taskActionDialog.task, false)}>
                    Cancelar esta y detener la recurrencia
                  </button>
                </>
              )}

              {taskActionDialog.kind === "delete" && taskActionDialog.task.recurrence.type === "none" && (
                <button className="button button-primary danger-button" type="button" onClick={() => void executeDeleteTask(taskActionDialog.task, false)}>
                  Eliminar permanentemente
                </button>
              )}

              {taskActionDialog.kind === "delete" && taskActionDialog.task.recurrence.type !== "none" && (
                <>
                  <button className="button button-primary danger-button" type="button" onClick={() => void executeDeleteTask(taskActionDialog.task, true)}>
                    Eliminar solo esta ocurrencia
                  </button>
                  <button className="button button-secondary danger-outline-button" type="button" onClick={() => void executeDeleteTask(taskActionDialog.task, false)}>
                    Eliminar esta y detener la recurrencia
                  </button>
                </>
              )}

              <button className="button button-quiet" type="button" onClick={() => setTaskActionDialog(null)}>
                Volver
              </button>
            </div>
          </div>
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
              templates={templates}
              findSimilarTasks={(candidate) => findSimilarOpenTasks(candidate, tasks)}
              skipSimilarityCheck={reviewEditing}
              onReviewSimilar={handleReviewSimilar}
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
