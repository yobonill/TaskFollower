import { useCallback, useEffect, useState } from "react";
import type { FirebaseError } from "firebase/app";
import type { AppUserDefinition } from "../config/appUsers";
import { isFirebaseConfigured } from "../config/firebaseConfig";
import type { UserName } from "../models/task";
import {
  observeAuthentication,
  signInAppUser,
  signOutAppUser,
} from "../services/firebase";

type AuthStatus =
  | "loading"
  | "authenticating"
  | "authenticated"
  | "unauthenticated"
  | "error";

export interface UseAuthResult {
  user: AppUserDefinition | null;
  status: AuthStatus;
  error: string;
  login: (name: UserName, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

const getLoginErrorMessage = (error: unknown): string => {
  const code = (error as FirebaseError | undefined)?.code;

  if (!navigator.onLine) {
    return "Necesitas conexión a internet para iniciar sesión por primera vez en este dispositivo.";
  }

  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "La contraseña no es correcta para el usuario seleccionado.";
    case "auth/too-many-requests":
      return "Se realizaron demasiados intentos. Espera un momento y vuelve a intentarlo.";
    case "auth/network-request-failed":
      return "No se pudo conectar con Firebase. Revisa la conexión e inténtalo otra vez.";
    case "auth/user-disabled":
      return "Esta cuenta está deshabilitada en Firebase.";
    default:
      return error instanceof Error && error.message
        ? error.message
        : "No se pudo iniciar sesión.";
  }
};

export const useAuth = (): UseAuthResult => {
  const [user, setUser] = useState<AppUserDefinition | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setStatus("error");
      setError("Firebase todavía no está configurado en esta aplicación.");
      return () => undefined;
    }

    return observeAuthentication((appUser, firebaseUser) => {
      if (firebaseUser && !appUser) {
        setUser(null);
        setStatus("unauthenticated");
        setError("La sesión guardada no pertenece a Yorki ni a Yisel. Inicia sesión nuevamente.");
        void signOutAppUser();
        return;
      }

      setUser(appUser);
      setStatus(appUser ? "authenticated" : "unauthenticated");
      if (appUser) setError("");
    });
  }, []);

  const login = useCallback(
    async (name: UserName, password: string): Promise<boolean> => {
      setError("");
      setStatus("authenticating");
      try {
        const authenticatedUser = await signInAppUser(name, password);
        setUser(authenticatedUser);
        setStatus("authenticated");
        return true;
      } catch (loginError) {
        setUser(null);
        setStatus("unauthenticated");
        setError(getLoginErrorMessage(loginError));
        return false;
      }
    },
    [],
  );

  const logout = useCallback(async () => {
    await signOutAppUser();
    setUser(null);
    setStatus("unauthenticated");
    setError("");
  }, []);

  return { user, status, error, login, logout };
};
