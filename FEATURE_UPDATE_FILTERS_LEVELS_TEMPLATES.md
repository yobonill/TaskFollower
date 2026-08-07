# Actualización: filtros, duplicados, niveles, Sin fecha y plantillas

## Panel

- Los contadores `Vencidas`, `Para hoy`, `Pendientes`, `Sin fecha` e `Incompletas` funcionan como filtros.
- Al pulsar otra vez el filtro activo se vuelve a la vista agrupada.
- La vista normal separa las tareas en `Hoy`, `Próximas` y `Sin fecha`.
- Las tareas vencidas aparecen dentro del bloque `Hoy`, antes que las tareas que vencen hoy.

## Prevención de tareas duplicadas

Al crear una tarea, TaskFollower compara su nombre con tareas abiertas. Si encuentra coincidencias, muestra:

- `Revisar tareas similares primero`
- `Crear tarea`
- `Cancelar`

Al revisar primero, el borrador permanece guardado localmente y el panel muestra solo las tareas similares. Desde allí se puede crear el borrador, editarlo o cancelarlo.

## Niveles

Hay 100 niveles.

- Nivel 1 → 2: 100 Papipuntos.
- Cada requisito siguiente aumenta 40%.
- El requisito por nivel tiene un límite de 500 Papipuntos para evitar crecimiento exponencial excesivo.
- Desde Nivel 6 → 7 en adelante, cada nuevo nivel requiere 500 Papipuntos.
- Nivel 100 se alcanza con 48,094 Papipuntos acumulados en el saldo actual.
- El progreso visual se reinicia al inicio de cada nivel y muestra solo los Papipuntos conseguidos dentro del nivel actual.
- Perder o canjear Papipuntos puede bajar el nivel.

## Tareas sin fecha

`Sin fecha` es una opción válida. Una tarea se considera completa si tiene:

- Nombre de la tarea.
- Prioridad.

La fecha límite es opcional. Las tareas sin fecha nunca se consideran vencidas y se muestran después de las tareas fechadas.

## Plantillas

Las plantillas ahora son datos compartidos y pueden crearse, editarse y eliminarse desde `Gestionar`.

Las plantillas iniciales se cargan una sola vez. Si se eliminan, no vuelven a crearse automáticamente.

Firebase usa:

- `/taskTemplates/items`
- `/taskTemplates/initialized`

## Posponer y penalizaciones

- Posponer antes de que una tarea venza no resta Papipuntos.
- Posponer una tarea que ya está vencida aplica la penalización antes de mover su fecha.
- La penalización por vencimiento mantiene un identificador único por tarea, por lo que no se duplica al sincronizar o reintentar.
