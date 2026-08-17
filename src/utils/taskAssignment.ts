import {
  APP_USERS_BY_NAME,
  getAppUserByUid,
  type AppUserDefinition,
} from "../config/appUsers";
import type { Task, TaskAssignee, UserName } from "../models/task";

export const getAssigneeUserNames = (assignee: TaskAssignee): UserName[] =>
  assignee === "Ambos" ? ["Yisel", "Yorki"] : [assignee];

export const getAssigneeUserIds = (assignee: TaskAssignee): string[] =>
  getAssigneeUserNames(assignee).map((name) => APP_USERS_BY_NAME[name].uid);

export const getTaskAssigneeUsers = (task: Task): AppUserDefinition[] => {
  if (task.isUnassigned) return [];

  if (task.assignedTo === "Ambos") {
    return [APP_USERS_BY_NAME.Yisel, APP_USERS_BY_NAME.Yorki];
  }

  if (task.assignedToUserIds?.length) {
    const users = task.assignedToUserIds
      .map((uid) => getAppUserByUid(uid))
      .filter((user): user is AppUserDefinition => Boolean(user));
    if (users.length > 1) return users;
    if (users.length === 1) return users;
  }

  if (task.assignedToUserId) {
    const user = getAppUserByUid(task.assignedToUserId);
    if (user) return [user];
  }

  return [APP_USERS_BY_NAME[task.assignedTo]];
};

export const isTaskAssignedTo = (task: Task, user: UserName): boolean =>
  task.isUnassigned || task.assignedTo === "Ambos" || task.assignedTo === user;
