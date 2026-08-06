import type { UserName } from "../models/task";

export interface AppUserDefinition {
  name: UserName;
  uid: string;
  email: string;
}

/**
 * The email addresses are internal Firebase Authentication identifiers.
 * The application only displays the Spanish user names.
 *
 * If the Firebase users were created with different email addresses, change
 * only the email values below. Never put passwords in this file.
 */
export const APP_USERS_BY_NAME: Record<UserName, AppUserDefinition> = {
  Yisel: {
    name: "Yisel",
    uid: "Z0Kf2S6iCvVOYQycexiJoPE6sPG2",
    email: "yisel@taskfollower.invalid",
  },
  Yorki: {
    name: "Yorki",
    uid: "iF4VXsQ31TT12A44grdEvRAni9S2",
    email: "yorki@taskfollower.invalid",
  },
};

export const APP_USERS = Object.values(APP_USERS_BY_NAME);

export const getAppUserByName = (name: UserName): AppUserDefinition =>
  APP_USERS_BY_NAME[name];

export const getAppUserByUid = (
  uid: string | null | undefined,
): AppUserDefinition | undefined =>
  uid ? APP_USERS.find((user) => user.uid === uid) : undefined;

export const getOtherAppUser = (name: UserName): AppUserDefinition =>
  name === "Yorki" ? APP_USERS_BY_NAME.Yisel : APP_USERS_BY_NAME.Yorki;
