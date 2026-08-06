import { useState, type FormEvent } from "react";
import { USERS, type UserName } from "../models/task";

const LAST_LOGIN_USER_KEY = "taskFollower.lastLoginUser.v1";

const readLastUser = (): UserName =>
  localStorage.getItem(LAST_LOGIN_USER_KEY) === "Yisel" ? "Yisel" : "Yorki";

interface LoginScreenProps {
  loading: boolean;
  error: string;
  onLogin: (name: UserName, password: string) => Promise<boolean>;
}

export function LoginScreen({ loading, error, onLogin }: LoginScreenProps) {
  const [selectedUser, setSelectedUser] = useState<UserName>(readLastUser);
  const [password, setPassword] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password || loading) return;
    localStorage.setItem(LAST_LOGIN_USER_KEY, selectedUser);
    const succeeded = await onLogin(selectedUser, password);
    if (succeeded) {
      setPassword("");
    }
  };

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-brand-mark" aria-hidden="true">✓</div>
        <span className="eyebrow">Tareas compartidas</span>
        <h1 id="login-title">Entrar a TaskFollower</h1>
        <p className="login-intro">
          Selecciona tu usuario e ingresa tu contraseña. La sesión quedará guardada en este dispositivo.
        </p>

        <form onSubmit={submit}>
          <fieldset className="login-user-selector">
            <legend>Usuario</legend>
            <div className="segmented-options two-options">
              {USERS.map((user) => (
                <button
                  key={user}
                  type="button"
                  className={selectedUser === user ? "selected" : ""}
                  onClick={() => setSelectedUser(user)}
                >
                  {user}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="field field-wide login-password-field">
            <span>Contraseña</span>
            <input
              autoFocus
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Ingresa tu contraseña"
            />
          </label>

          {error && <p className="login-error" role="alert">{error}</p>}

          <button
            className="button button-primary login-submit"
            type="submit"
            disabled={!password || loading}
          >
            {loading ? "Entrando…" : `Entrar como ${selectedUser}`}
          </button>
        </form>

        <p className="login-help">
          La primera entrada en un dispositivo requiere internet. Después podrás abrir la aplicación sin conexión con la sesión guardada.
        </p>
      </section>
    </main>
  );
}
