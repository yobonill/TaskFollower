import { getApp, getApps, initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
  type User,
} from "firebase/auth";
import { getDatabase, type Database } from "firebase/database";
import {
  getAppUserByName,
  getAppUserByUid,
  type AppUserDefinition,
} from "../config/appUsers";
import { firebaseConfig, isFirebaseConfigured } from "../config/firebaseConfig";
import type { UserName } from "../models/task";

interface FirebaseServices {
  auth: Auth;
  database: Database;
}

let services: FirebaseServices | null = null;

export const getFirebaseServices = (): FirebaseServices | null => {
  if (!isFirebaseConfigured()) return null;
  if (services) return services;

  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  services = {
    auth: getAuth(app),
    database: getDatabase(app),
  };
  return services;
};

export const resolveAppUser = (
  firebaseUser: User | null,
): AppUserDefinition | null =>
  firebaseUser ? getAppUserByUid(firebaseUser.uid) || null : null;

export const observeAuthentication = (
  callback: (user: AppUserDefinition | null, firebaseUser: User | null) => void,
): (() => void) => {
  const firebaseServices = getFirebaseServices();
  if (!firebaseServices) {
    callback(null, null);
    return () => undefined;
  }

  return onAuthStateChanged(firebaseServices.auth, (firebaseUser) => {
    callback(resolveAppUser(firebaseUser), firebaseUser);
  });
};

export const signInAppUser = async (
  name: UserName,
  password: string,
): Promise<AppUserDefinition> => {
  const firebaseServices = getFirebaseServices();
  if (!firebaseServices) {
    throw new Error("Firebase todavía no está configurado.");
  }

  const appUser = getAppUserByName(name);
  await setPersistence(firebaseServices.auth, browserLocalPersistence);
  const credential = await signInWithEmailAndPassword(
    firebaseServices.auth,
    appUser.email,
    password,
  );

  if (credential.user.uid !== appUser.uid) {
    await signOut(firebaseServices.auth);
    throw new Error("La cuenta no corresponde al usuario seleccionado.");
  }

  return appUser;
};

export const signOutAppUser = async (): Promise<void> => {
  const firebaseServices = getFirebaseServices();
  if (!firebaseServices) return;
  await signOut(firebaseServices.auth);
};

export const getAuthenticatedFirebaseServices = (): FirebaseServices => {
  const firebaseServices = getFirebaseServices();
  if (!firebaseServices) {
    throw new Error("Firebase todavía no está configurado.");
  }

  const currentUser = firebaseServices.auth.currentUser;
  if (!currentUser || !getAppUserByUid(currentUser.uid)) {
    throw new Error("Debes iniciar sesión para sincronizar las tareas.");
  }

  return firebaseServices;
};
