import type { FirebaseOptions } from "firebase/app";

/**
 * Paste the configuration copied from:
 * Firebase Console -> Project settings -> Your apps -> Web app.
 *
 * Firebase's web config is client-side configuration, not a private server secret.
 * Data access is controlled by Realtime Database Security Rules.
 */
const firebaseConfig = {
  apiKey: "AIzaSyABQsP0Cglpb9mV0mezqfYHKvpuNEcM4dU",
  authDomain: "app-taskfollower.firebaseapp.com",
  databaseURL: "https://app-taskfollower-default-rtdb.firebaseio.com/",
  projectId: "app-taskfollower",
  storageBucket: "app-taskfollower.firebasestorage.app",
  messagingSenderId: "71859963691",
  appId: "1:71859963691:web:cf7056735b3e28fdd5276e"
};

export const isFirebaseConfigured = (): boolean =>
  Boolean(
    firebaseConfig.apiKey &&
      firebaseConfig.databaseURL &&
      !String(firebaseConfig.apiKey).startsWith("PASTE_") &&
      !String(firebaseConfig.databaseURL).startsWith("PASTE_"),
  );
