# Actualización combinada: usuarios y Papipuntos

Esta versión incorpora el inicio de sesión de Yorki/Yisel y el sistema completo de Papipuntos.

## Usuarios configurados

- Yisel: `yisel@taskfollower.invalid`
- Yorki: `yorki@taskfollower.invalid`

Las direcciones solo se usan internamente para Firebase Authentication. La interfaz muestra únicamente el nombre y solicita la contraseña.

## Reglas de Papipuntos

| Acción | Baja | Normal | Alta | Crítica |
|---|---:|---:|---:|---:|
| Completar tarea | +5 | +10 | +20 | +35 |
| Bono por terminar antes | +1 | +2 | +4 | +7 |
| Tarea vencida | -2 | -4 | -8 | -12 |

- Crear manualmente una tarea completa: **+2 Papipuntos**.
- Importar, duplicar o recrear una tarea recurrente no otorga puntos por creación.
- Una tarea existente antes de esta actualización no otorga puntos retroactivos por creación, pero sí otorga puntos al completarse.
- Las tareas que ya estaban vencidas antes de activar esta versión no reciben una penalización retroactiva.
- Los Papipuntos nunca se muestran por debajo de 0.
- Canjear recompensas y recibir penalizaciones puede bajar el nivel.

## Niveles

Hay 100 niveles. El inicio de cada nivel se calcula con:

`5 × (nivel - 1) × (nivel + 8)`

Ejemplos:

- Nivel 2: 50 Papipuntos
- Nivel 10: 810 Papipuntos
- Nivel 50: 14,210 Papipuntos
- Nivel 100: 53,460 Papipuntos

## Repetición

Las tareas recurrentes ahora pueden definir **Repetir hasta**. La siguiente tarea solo se crea si su nueva fecha límite no supera esa fecha.

## Despliegue

1. Reemplaza los archivos del proyecto con esta versión.
2. Ejecuta `npm install`.
3. Ejecuta `npm run build`.
4. Prueba ambos usuarios con `npm run dev`.
5. Publica mediante GitHub.
6. Después de confirmar ambos inicios de sesión, publica `firebase-database-rules.json`.
7. Deshabilita Anonymous Authentication en Firebase.

## Firebase Realtime Database

La aplicación utiliza:

- `/tasks`
- `/papipoints/transactions`
- `/papipoints/rewards`

Cada movimiento de Papipuntos usa un identificador estable para evitar duplicarlo al reintentar una sincronización sin conexión.
