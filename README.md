# TaskFollower

A focused shared task dashboard for Yisel and Yorki.

## Current first version

- Dashboard showing the next task by deadline.
- Urgency-based visual accents.
- All / Yisel / Yorki filtering.
- Create and edit tasks.
- Complete tasks directly from the dashboard.
- Simple daily, weekly, and monthly recurrence.
- Completed-task history.
- JSON export, merge import, and replace import.
- Firebase Realtime Database synchronization.
- Local browser cache and retry queue when synchronization fails.
- Responsive desktop and phone layout.
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
