# TaskFollower

A focused shared task dashboard for Yisel and Yorki.

## Current first version

- Dashboard showing the next task by deadline.
- Priority-based visual accents.
- User filtering plus clickable counters for overdue, today, pending, undated, and incomplete tasks.
- Create and edit tasks, with similar-task warnings before creating possible duplicates.
- Complete tasks directly from the dashboard.
- Daily, weekly, and monthly recurrence with an optional end date.
- Completed-task history.
- JSON export, merge import, and replace import.
- Firebase Realtime Database synchronization.
- Local browser cache and retry queue when synchronization fails.
- Editable shared task templates and responsive desktop/phone layout.
- GitHub Pages deployment workflow.

## Start

1. Follow `FIREBASE_SETUP.md`.
2. Install and run:

```bash
npm install
npm run dev
```

Until Firebase is configured, the app runs in local preview mode with sample tasks.

## Usuarios y Papipuntos

La aplicación incluye dos usuarios autenticados, Yorki y Yisel, con asignación de tareas entre ambos. También incorpora 100 niveles, Papipuntos por creación y finalización de tareas, bonos por completar antes de la fecha límite, penalizaciones por tareas vencidas, recompensas canjeables, historial de movimientos, tiempo total pendiente para hoy y tareas vencidas, y fecha final para tareas recurrentes.

Consulta `COMBINED_AUTH_PAPIPOINTS_UPDATE.md` para las reglas y el orden de despliegue.

## PWA isolation and coexistence

- TaskFollower owns only Cache Storage entries beginning with `taskfollower-shell-`; service-worker activation removes obsolete caches only within that prefix.
- `manifest.webmanifest` keeps `id`, `start_url`, and `scope` as `./`; at the GitHub Pages deployment they resolve to `/TaskFollower/`, separate from Daily Expenses (`/daily-expenses-budget-manager/`).
- The TaskFollower service worker is registered relative to `document.baseURI` with an explicit app-root scope; in production its scope is `/TaskFollower/`, so it does not control the Daily Expenses path.
- Local development uses `http://localhost:43861`; production preview uses `http://localhost:43862`. Both ports use Vite `strictPort: true`.
- Existing TaskFollower browser data keeps its `taskFollower.` local-storage namespace and is not renamed or cleared by this isolation change.
- TaskFollower continues to use the Firebase project `app-taskfollower`; Daily Expenses uses the separate `app-daily-expenses-budget` Firebase project. Do not merge their Firebase rules or data.

### Same-origin two-PWA validation

1. Deploy TaskFollower and Daily Expenses to their existing GitHub Pages repository paths.
2. Open each PWA online once, verify its own name/icon, install it if needed, and confirm it launches its own repository path.
3. In browser DevTools, confirm TaskFollower registers a worker scoped to the TaskFollower path and uses only the current `taskfollower-shell-*` cache.
4. Confirm an obsolete `taskfollower-shell-*` cache is removed after a TaskFollower update while `daily-expenses-budget-shell-*` remains untouched.
5. Load both apps online, then test each offline. Updating either PWA must not break offline loading of the other.
6. Confirm existing TaskFollower tasks, Papipuntos, templates, drafts, and pending offline operations remain available after the update.
