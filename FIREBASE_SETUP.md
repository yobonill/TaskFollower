# Firebase setup for TaskFollower

TaskFollower remains a static React application hosted on GitHub Pages. Firebase is used only for Authentication and Realtime Database synchronization.

## 1. Web application

In Firebase Console:

1. Open **Project settings**.
2. Under **Your apps**, register a Web app if it does not already exist.
3. Copy the Firebase configuration into `src/config/firebaseConfig.ts`.
4. Do not enable Firebase Hosting; GitHub Pages hosts this project.

## 2. Realtime Database

1. Open **Realtime Database**.
2. Create the database.
3. Copy its URL into the `databaseURL` field in `src/config/firebaseConfig.ts`.

The app stores data under:

- `/tasks`
- `/papipoints/transactions`
- `/papipoints/rewards`

## 3. Email/Password authentication

1. Open **Authentication → Sign-in method**.
2. Click **Add new provider**.
3. Select **Email/Password**.
4. Enable Email/Password and save.
5. Under **Authentication → Users**, create:
   - `yisel@taskfollower.invalid`
   - `yorki@taskfollower.invalid`
6. Use the private passwords selected for each person. Never place passwords in the source code.

The configured Firebase UIDs are:

- Yisel: `Z0Kf2S6iCvVOYQycexiJoPE6sPG2`
- Yorki: `iF4VXsQ31TT12A44grdEvRAni9S2`

## 4. Database rules

After confirming both password accounts can log in, publish the contents of `firebase-database-rules.json` under **Realtime Database → Rules**.

The rules restrict all reads and writes to the two exact Firebase UIDs.

## 5. Disable anonymous authentication

Only after the new deployment and both accounts have been tested:

1. Open **Authentication → Sign-in method**.
2. Open **Anonymous**.
3. Disable it.

## 6. Local and production tests

```bash
npm install
npm run build
npm run dev
```

After local validation, commit and push to `master`. The included GitHub Actions workflow deploys the static build to GitHub Pages.
