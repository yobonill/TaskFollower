# Papipuntos: un solo resultado por tarea

Esta versión consolida la regla de Papipuntos para que cada tarea tenga un único resultado final.

## Regla principal

Una tarea puede afectar Papipuntos una sola vez:

- Si se completa antes de vencer, recibe un resultado positivo.
- Si vence, recibe un resultado negativo.
- Una vez premiada o penalizada, esa misma tarea no puede volver a sumar ni restar Papipuntos.

## Tareas completadas

El resultado positivo se registra en una sola transacción por participante e incluye:

- Puntos base según la prioridad.
- +2 Papipuntos si la tarea fue creada manualmente.
- Bono por completar antes de tiempo cuando corresponda.

Los bonos ya no se guardan como movimientos separados para tareas nuevas.

## Tareas vencidas

Al vencer una tarea se registra su penalización una sola vez. Si el saldo del usuario ya es cero, se registra igualmente un resultado de 0 Papipuntos para marcar la tarea como penalizada y evitar que luego genere una recompensa.

## Posponer

- Posponer antes del vencimiento no genera penalización y la tarea sigue siendo elegible para recompensa.
- Posponer después del vencimiento aplica la penalización si todavía no había sido aplicada.
- Después de ser penalizada, cambiar la fecha no reinicia la elegibilidad de Papipuntos.
- Completar una tarea que ya fue penalizada otorga 0 Papipuntos.

## Tareas compartidas

Las tareas asignadas a `Ambos` resuelven el mismo resultado para los dos usuarios:

- Si se completan a tiempo, ambos reciben la recompensa correspondiente.
- Si vencen, ambos reciben la penalización correspondiente.
- Cada usuario recibe el resultado una sola vez.

## Compatibilidad

Las transacciones creadas por versiones anteriores se reconocen para evitar recompensas o penalizaciones duplicadas. Los movimientos históricos existentes no se reescriben automáticamente.
