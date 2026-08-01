import { useEffect, useMemo, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import CaptureWindow from "./components/CaptureWindow";
import CaptureList from "./components/CaptureList";
import SettingsPanel from "./components/SettingsPanel";
import Onboarding from "./components/Onboarding";
import LibraryWindow from "./components/library/LibraryWindow";
import ErrorBoundary from "./components/ErrorBoundary";
import { runAgentPass } from "./lib/agent/agentEngine";
import { bootstrapDatabase, getCapturesTodayCount, getSetting, setSetting } from "./lib/db";
import { getLastSyncLabel, runRecurringReminderPass, runSyncPass } from "./lib/sync/syncManager";
import { useAppStore } from "./store/useAppStore";

import type { ThemeMode } from "./types";

type MainView = "capture" | "history" | "settings";

function resolveTheme(saved: string | null | undefined): ThemeMode {
  if (saved === "light" || saved === "dark") {
    return saved;
  }
  return "dark";
}

function App() {
  const isTauriRuntime = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const forceOnboarding = import.meta.env.DEV && import.meta.env.VITE_CHUTE_FORCE_ONBOARDING === "true";
  const [ready, setReady] = useState<boolean>(() => !isTauriRuntime);
  const [initError, setInitError] = useState<string | null>(null);
  const [mainView, setMainView] = useState<MainView>(() => (forceOnboarding ? "settings" : "capture"));
  const [needsOnboarding, setNeedsOnboarding] = useState(forceOnboarding);
  const windowLabel = useMemo(
    () => (isTauriRuntime ? getCurrentWebviewWindow().label : "main"),
    [isTauriRuntime],
  );
  const isMainWindow = windowLabel === "main";
  const isLibraryWindow = windowLabel === "library";
  const { setCapturesToday, setHotkey, hotkey, theme, setTheme, setLastSyncLabel, lastSyncLabel } =
    useAppStore();

  useEffect(() => {
    if (!isTauriRuntime) {
      return;
    }

    if (isLibraryWindow) {
      document.documentElement.dataset.window = "library";
    } else if (isMainWindow && mainView === "settings") {
      document.documentElement.dataset.window = "settings";
    } else {
      delete document.documentElement.dataset.window;
    }
    return () => {
      delete document.documentElement.dataset.window;
    };
  }, [isLibraryWindow, isMainWindow, isTauriRuntime, mainView]);

  // The Library window is owned by a separate webview that does NOT run the
  // main-only init. Pull the saved theme directly from SQLite so it matches the
  // user's choice, and listen for cross-window theme changes broadcast from main.
  useEffect(() => {
    if (!isTauriRuntime || !isLibraryWindow) {
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        const saved = await getSetting("theme");
        if (cancelled) return;
        const next = resolveTheme(saved ?? "dark");
        document.documentElement.dataset.theme = next;
        setTheme(next);
      } catch (error) {
        console.error("Library theme bootstrap failed", error);
      } finally {
        if (!cancelled) {
          setReady(true);
        }
      }
    })();

    const unlisten = listen<{ theme: ThemeMode }>(
      "chute://theme-changed",
      (event) => {
        const next = resolveTheme(event.payload?.theme);
        document.documentElement.dataset.theme = next;
        setTheme(next);
      },
    );

    return () => {
      cancelled = true;
      unlisten.then((dispose) => dispose()).catch(() => {});
    };
  }, [isLibraryWindow, isTauriRuntime, setTheme]);

  useEffect(() => {
    if (!isTauriRuntime || !isMainWindow) {
      return;
    }

    const unlistenHistory = listen("chute://show-history", () => {
      setMainView("history");
    });

    const unlistenCapture = listen("chute://show-capture", () => {
      setMainView("capture");
    });

    const unlistenSettings = listen("chute://show-settings", () => {
      setMainView("settings");
    });

    const unlistenSecondInstance = listen("chute://second-instance", () => {
      void (async () => {
        const onboardingComplete = await getSetting("onboarding_complete");
        if (forceOnboarding || onboardingComplete !== "true") {
          setNeedsOnboarding(true);
          setMainView("settings");
          await invoke("open_settings_window");
          return;
        }
        await invoke("show_capture_window");
      })().catch((error) => {
        console.error("Second-instance handler failed", error);
      });
    });

    return () => {
      unlistenHistory.then((dispose) => dispose()).catch(() => {});
      unlistenCapture.then((dispose) => dispose()).catch(() => {});
      unlistenSettings.then((dispose) => dispose()).catch(() => {});
      unlistenSecondInstance.then((dispose) => dispose()).catch(() => {});
    };
  }, [forceOnboarding, isMainWindow, isTauriRuntime]);

  useEffect(() => {
    if (!isTauriRuntime || !isMainWindow) {
      return;
    }

    let active = true;

    async function init() {
      await bootstrapDatabase();

      const [savedHotkey, defaultHotkey, savedTheme, todayCount, initialLastSyncLabel, onboardingComplete] =
        await Promise.all([
          getSetting("hotkey"),
          invoke<string>("get_default_hotkey"),
          getSetting("theme"),
          getCapturesTodayCount(),
          getLastSyncLabel(),
          getSetting("onboarding_complete"),
        ]);

      const needsSetup = forceOnboarding || onboardingComplete !== "true";

      if (needsSetup) {
        setNeedsOnboarding(true);
        setMainView("settings");
        setReady(true);
        try {
          await invoke("open_settings_window");
        } catch (error) {
          console.error("Could not open onboarding window", error);
        }
      }

      let effectiveHotkey = savedHotkey ?? defaultHotkey;
      if (!savedHotkey) {
        await setSetting("hotkey", effectiveHotkey);
      }

      const isFirstRun = needsSetup;
      let effectiveTheme = resolveTheme(savedTheme ?? "dark");
      if (isFirstRun || !savedTheme || savedTheme === "auto") {
        effectiveTheme = "dark";
        await setSetting("theme", "dark");
      }
      document.documentElement.dataset.theme = effectiveTheme;
      setTheme(effectiveTheme);

      try {
        await invoke("set_capture_hotkey", { hotkey: effectiveHotkey });
      } catch {
        effectiveHotkey = defaultHotkey;
        await invoke("set_capture_hotkey", { hotkey: effectiveHotkey });
        await setSetting("hotkey", effectiveHotkey);
      }
      await invoke("update_tray_tooltip", {
        capturesToday: todayCount,
        lastSync: initialLastSyncLabel,
      });

      if (!active) {
        return;
      }

      setHotkey(effectiveHotkey);
      setCapturesToday(todayCount);
      setLastSyncLabel(initialLastSyncLabel);

      if (!needsSetup) {
        setNeedsOnboarding(false);
        setReady(true);
      }
    }

    init().catch((error) => {
      console.error("Initialization failed", error);
      if (active) {
        setInitError(error instanceof Error ? error.message : String(error));
        setReady(true);
      }
    });

    return () => {
      active = false;
    };
  }, [forceOnboarding, isMainWindow, isTauriRuntime, setCapturesToday, setHotkey, setLastSyncLabel, setTheme]);

  useEffect(() => {
    if (!isTauriRuntime || !isMainWindow || initError) {
      return;
    }

    let active = true;

    async function syncNow() {
      try {
        const [{ lastSyncLabel: nextLastSync }, todayCount] = await Promise.all([
          runSyncPass(),
          getCapturesTodayCount(),
        ]);

        if (!active) {
          return;
        }

        setLastSyncLabel(nextLastSync);
        setCapturesToday(todayCount);
        await invoke("update_tray_tooltip", {
          capturesToday: todayCount,
          lastSync: nextLastSync,
        });
      } catch (error) {
        console.error("Background sync failed", error);
      }
    }

    void syncNow();

    const intervalId = window.setInterval(() => {
      void syncNow();
    }, 5 * 60_000);

    const onlineHandler = () => {
      void syncNow();
    };
    window.addEventListener("online", onlineHandler);
    const unlistenPromise = listen("chute://request-sync", () => {
      void syncNow();
    });

    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener("online", onlineHandler);
      unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [forceOnboarding, initError, isTauriRuntime, setCapturesToday, setLastSyncLabel, isMainWindow]);

  useEffect(() => {
    if (!isTauriRuntime || !isMainWindow || initError) {
      return;
    }

    let active = true;

    async function runRecurringNow() {
      try {
        const stats = await runRecurringReminderPass();
        if (active && (stats.created > 0 || stats.failed > 0)) {
          void emit("chute://captures-changed");
        }
      } catch (error) {
        if (active) {
          console.error("Recurring reminder pass failed", error);
        }
      }
    }

    void runRecurringNow();

    const intervalId = window.setInterval(() => {
      void runRecurringNow();
    }, 60_000);

    const onlineHandler = () => {
      void runRecurringNow();
    };
    window.addEventListener("online", onlineHandler);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener("online", onlineHandler);
    };
  }, [initError, isMainWindow, isTauriRuntime]);

  useEffect(() => {
    if (!isTauriRuntime || !isMainWindow || initError) {
      return;
    }

    let active = true;

    async function runAgentNow() {
      try {
        await runAgentPass();
      } catch (error) {
        if (active) {
          console.error("Background agent run failed", error);
        }
      }
    }

    void runAgentNow();

    const intervalId = window.setInterval(() => {
      void runAgentNow();
    }, 60_000);

    const unlistenPromise = listen("chute://request-agent", () => {
      void runAgentNow();
    });

    return () => {
      active = false;
      window.clearInterval(intervalId);
      unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [initError, isMainWindow, isTauriRuntime]);

  useEffect(() => {
    if (theme === "auto") {
      delete document.documentElement.dataset.theme;
      return;
    }
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.hotkey = hotkey;
    document.documentElement.dataset.lastSync = lastSyncLabel;
  }, [hotkey, lastSyncLabel]);

  if (!ready) {
    if (isMainWindow && mainView === "settings") {
      return (
        <div className="app-page flex h-full w-full items-center justify-center p-6">
          <p className="codex-muted text-sm">Loading settings…</p>
        </div>
      );
    }
    return <div className="h-full w-full bg-transparent" />;
  }

  if (!isTauriRuntime && !forceOnboarding) {
    return (
      <div className="app-page flex h-full w-full items-center justify-center p-6">
        <div className="codex-surface max-w-md rounded-xl p-4 text-sm">
          <p className="mb-2 font-semibold">Chute Web Preview</p>
          <p className="codex-muted">
            This app is Tauri-first. Use <code>npm run tauri dev</code> and open capture via{" "}
            <code>Ctrl+Shift+Space</code> or tray menu.
          </p>
        </div>
      </div>
    );
  }

  if (initError) {
    return (
      <div className="app-page flex h-full w-full items-center justify-center p-6">
        <div className="max-w-md rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-white">
          <p className="mb-2 font-semibold">Chute initialization error</p>
          <p className="break-words text-red-100/90">{initError}</p>
        </div>
      </div>
    );
  }

  let content: ReactNode;
  if (isLibraryWindow) {
    content = <LibraryWindow />;
  } else if (mainView === "settings") {
    content = needsOnboarding ? (
      <Onboarding onDone={() => setNeedsOnboarding(false)} />
    ) : (
      <SettingsPanel />
    );
  } else if (isMainWindow && mainView === "history") {
    content = <CaptureList onBack={() => void invoke("show_capture_window")} />;
  } else {
    content = <CaptureWindow />;
  }

  return <ErrorBoundary windowLabel={windowLabel}>{content}</ErrorBoundary>;
}

export default App;
