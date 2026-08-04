# Priority and incomplete-task update

Copy the `src` folder into the root of the existing TaskFollower project and allow these files to be replaced.

This update:

- Renames the visible and persisted task field from `urgency` to `priority`.
- Automatically reads existing Firebase/local/imported tasks that still use `urgency` and maps them to `priority`.
- Defines task data completeness from three required fields: task name, priority, and due date.
- Allows saving tasks even when one or more required fields are empty.
- Excludes incomplete pending tasks from the dashboard.
- Adds a separate, prominent incomplete-tasks section under Manage.
- Lists exactly which required fields are missing.
- Adds an incomplete-task counter to the compact dashboard summary.
- Moves a task automatically between incomplete and pending sections after editing its required fields.
- Exports new backups as schema version 2 using `priority`.

The Firebase configuration file is not included and will not be overwritten.

Validate locally:

```bash
npm run build
npm run dev
```

Then commit and deploy:

```bash
git add src
git commit -m "Add task priority and incomplete task workflow"
git push
```
