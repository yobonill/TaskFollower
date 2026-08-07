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
