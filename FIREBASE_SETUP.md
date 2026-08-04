# Firebase setup

This app uses Firebase Realtime Database only for shared task synchronization. The website itself remains a static Vite/React build hosted by GitHub Pages.

## 1. Create the Firebase project

1. Open the Firebase Console.
2. Select **Create a project**.
3. Name it something such as `app-task-follower`.
4. Google Analytics is optional and can be disabled for this project.

## 2. Register the web application

1. In **Project Overview**, click the web icon `</>`.
2. Use a name such as `TaskFollower Web`.
3. Firebase Hosting is not required because GitHub Pages will host the site.
4. Register the app.
5. Copy the generated `firebaseConfig` values.
6. Paste them into:

   `src/config/firebaseConfig.ts`

Make sure `databaseURL` is present. If it is not in the first config shown, create the Realtime Database first and then copy the updated configuration from **Project settings > Your apps**.

## 3. Create the Realtime Database

1. Open **Build > Realtime Database**.
2. Click **Create Database**.
3. Select a region near the users.
4. Choose **Locked mode**.
5. Open the **Rules** tab and replace the rules with:

```json
{
  "rules": {
    ".read": "auth != null",
    ".write": "auth != null"
  }
}
```

6. Click **Publish**.

A copy of these rules is included as `firebase-database-rules.json`.

## 4. Enable invisible anonymous authentication

1. Open **Build > Authentication**.
2. Click **Get started** if necessary.
3. Open **Sign-in method**.
4. Enable **Anonymous**.
5. Save.

The application will sign each browser in automatically. Yisel/Yorki remains the visible task filter and assigner selection; there is no login screen.

## 5. Run locally

```bash
npm install
npm run dev
```

The terminal will show a local URL, normally `http://localhost:5173`.

## 6. Publish through GitHub Pages

1. Create a GitHub repository and push this project to its `main` branch.
2. In the GitHub repository, open **Settings > Pages**.
3. Under **Build and deployment**, select **GitHub Actions** as the source.
4. Push to `main` again if the deployment workflow has not started.
5. Open the URL displayed by the `Deploy GitHub Pages` workflow.

The included `.github/workflows/deploy-pages.yml` builds and publishes the site automatically.

## Important scope note

These simple rules allow any anonymously authenticated copy of this web application to use the database. This matches the current private-household/no-login scope, but it is not strong identity-based security for a public multi-user product.
