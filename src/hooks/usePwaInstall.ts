import { useCallback, useEffect, useMemo, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export type InstallResult =
  | "accepted"
  | "dismissed"
  | "ios-instructions"
  | "browser-instructions"
  | "already-installed";

const isStandaloneMode = (): boolean =>
  window.matchMedia("(display-mode: standalone)").matches ||
  Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);

export const usePwaInstall = () => {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandaloneMode);

  const isIos = useMemo(
    () => /iphone|ipad|ipod/i.test(window.navigator.userAgent),
    [],
  );

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = useCallback(async (): Promise<InstallResult> => {
    if (installed || isStandaloneMode()) return "already-installed";

    if (promptEvent) {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      setPromptEvent(null);
      if (choice.outcome === "accepted") setInstalled(true);
      return choice.outcome;
    }

    return isIos ? "ios-instructions" : "browser-instructions";
  }, [installed, isIos, promptEvent]);

  return {
    canInstall: !installed,
    installed,
    install,
  };
};
