# TaskFollower — actualización móvil y PWA

Extrae el contenido del ZIP directamente en la raíz del proyecto y permite que reemplace los archivos existentes.

Esta actualización **no incluye** `src/config/firebaseConfig.ts`, por lo que conserva tu configuración actual de Firebase.

## Incluye

- Registro rápido de tareas optimizado para teléfono.
- Botón flotante `+` siempre visible.
- Formulario de pantalla completa en móvil.
- Valores rápidos para fecha, urgencia y duración.
- Plantillas de tareas.
- Borrador automático en el dispositivo.
- `Guardar y crear otra`.
- Deshacer al completar o cancelar.
- Menú por tarea: editar, duplicar, reasignar, posponer, cancelar y eliminar.
- Panel de tareas canceladas con restauración.
- Barra móvil compacta.
- PWA instalable con manifiesto, iconos y service worker.
- Aviso de instalación visible inmediatamente mientras la app no esté instalada.
- Flujo de GitHub Pages configurado para la rama `master`.

## Validación local

```bash
npm run build
npm run dev
```

## Publicar

```bash
git add .
git commit -m "Add mobile task workflow and PWA support"
git push
```
