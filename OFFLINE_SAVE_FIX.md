# Offline save fix

Replace `src/hooks/useTasks.ts` with the included file.

The task form now finishes as soon as the task is safely stored in the local cache and persistent pending-operation queue. Firebase synchronization runs in the background.

This fixes the form remaining on `Guardando…` while the device is offline or Firebase is temporarily unavailable.

Validation:

```bash
npm run build
npm run dev
```

Deployment:

```bash
git add src/hooks/useTasks.ts
git commit -m "Fix offline task saving"
git push
```
