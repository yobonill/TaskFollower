import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const serviceWorkerUrl = new URL("sw.js", document.baseURI).toString();
    void navigator.serviceWorker.register(serviceWorkerUrl).catch(() => {
      // The application remains usable even if service-worker registration fails.
    });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
