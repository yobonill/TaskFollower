import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, type Auth } from "firebase/auth";
import { getDatabase, type Database } from "firebase/database";
import { firebaseConfig, isFirebaseConfigured } from "../config/firebaseConfig";

interface FirebaseServices {
  auth: Auth;
  database: Database;
}

let services: FirebaseServices | null = null;
let authenticationPromise: Promise<void> | null = null;

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

export const ensureAnonymousAuthentication = async (): Promise<FirebaseServices> => {
  const firebaseServices = getFirebaseServices();
  if (!firebaseServices) {
    throw new Error("Firebase todavía no está configurado.");
  }

  if (firebaseServices.auth.currentUser) return firebaseServices;

  authenticationPromise ??= signInAnonymously(firebaseServices.auth).then(() => undefined);
  await authenticationPromise;
  return firebaseServices;
};
