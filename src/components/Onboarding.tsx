import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getSettings, setSetting } from "../lib/db";
import { useAppStore } from "../store/useAppStore";
import { testAppleNotes } from "../lib/sync/appleNotes";
import { isMacOS } from "../lib/platform";
import {
  assertConnectBackendReachable,
  getConnectProvidersConfig,
  startConnectSession,
  waitForConnectCompletion,
  type ConnectProvider,
  type ProviderConfigState,
} from "../lib/integrations/oauthConnect";
import ProviderLogo, { type ProviderLogoId } from "./ProviderLogo";
import ChuteLogo from "./ChuteLogo";
import { providerConfigured, loadIntegrationSettings } from "../lib/integrations/connectionStatus";

const DEFAULT_BACKEND_URL = "https://klyph-auth.onrender.com";
const IS_MACOS = isMacOS();
const TOTAL_STEPS = 4;

const FEATURE_SLIDES = [
  {
    title: "Capture from anywhere",
    body: "Pop open the box, type a thought, hit Enter. Times like \"tomorrow at 5pm\" parse automatically.",
    visual: "capture" as const,
  },
  {
    title: "Focus or Distraction",
    body: "Stay on-task with Focus, or park interruptions in Distraction — they go to Parking Lot.",
    visual: "lanes" as const,
  },
  {
    title: "Tag by context",
    body: "Work, Personal, or Idea — mark captures so history stays scannable.",
    visual: "tags" as const,
  },
  {
    title: "Organize with lists",
    body: "Route captures to Inbox or custom lists for projects and areas.",
    visual: "lists" as const,
  },
  {
    title: "Apple Notes — thoughts land here",
    body: "The default home. Ideas, links, questions — anything without a deadline files itself as a note. Zero setup.",
    visual: "app" as const,
    example: "ideas for dad's birthday",
    dest: "Apple Notes",
  },
  {
    title: "Reminders — to-dos that ping you",
    body: "Anything with a time, or phrased like a task, becomes a reminder with the right due date. \"Remind me to…\" always lands here.",
    visual: "app" as const,
    example: "pay rent tomorrow at 9am",
    dest: "Reminders",
  },
  {
    title: "Apple Calendar — plans become events",
    body: "Meetings, lunches, appointments — anything that occupies a slot goes on your calendar, not your to-do list.",
    visual: "app" as const,
    example: "lunch with Priya Friday 1pm",
    dest: "Apple Calendar",
  },
  {
    title: "Slack — post without switching",
    body: "Send a capture straight to a channel: standup lines, quick updates. Connect your workspace in the next step.",
    visual: "app" as const,
    example: "standup: shipped the routing fix",
    dest: "Slack",
  },
  {
    title: "Discord — same, for your server",
    body: "Drop a capture into a Discord channel without opening the app.",
    visual: "app" as const,
    example: "patch notes draft for v0.2",
    dest: "Discord",
  },
  {
    title: "Notion — file it in your workspace",
    body: "Append captures to a page or database — reference material and longer notes organize themselves.",
    visual: "app" as const,
    example: "competitor pricing research",
    dest: "Notion",
  },
  {
    title: "Google Tasks & Calendar",
    body: "Google-first? Tasks and timed captures can sync to your Google account instead — one sign-in in the next step.",
    visual: "app" as const,
    example: "ship the beta Friday 5pm",
    dest: "Google Calendar",
  },
  {
    title: "Browse history",
    body: "Review, edit, and re-sync anything you've captured from the history view.",
    visual: "history" as const,
  },
];

const PROVIDERS: Array<{
  id: ConnectProvider;
  logoId: ProviderLogoId;
  label: string;
  blurb: string;
  keys: string[];
}> = [
  {
    id: "slack",
    logoId: "slack",
    label: "Slack",
    blurb: "Post captures to a channel",
    keys: ["slack_webhook_url"],
  },
  {
    id: "discord",
    logoId: "discord",
    label: "Discord",
    blurb: "Send to a Discord channel",
    keys: ["discord_webhook_url"],
  },
  {
    id: "notion",
    logoId: "notion",
    label: "Notion",
    blurb: "Append to a page or database",
    keys: ["notion_token", "notion_page_id"],
  },
  {
    id: "google",
    logoId: "google",
    label: "Google Tasks & Calendar",
    blurb: "Tasks and calendar events",
    keys: ["google_tasks_access_token", "google_calendar_id"],
  },
];

const ALL_DESTINATIONS: Array<{ logoId: ProviderLogoId; label: string }> = [
  { logoId: "slack", label: "Slack" },
  { logoId: "discord", label: "Discord" },
  { logoId: "notion", label: "Notion" },
  { logoId: "google", label: "Google" },
  { logoId: "apple-notes", label: "Apple Notes" },
];

const DEFAULT_PROVIDER_CONFIG: Record<ConnectProvider, ProviderConfigState> = {
  slack: { configured: true, missing: [] },
  discord: { configured: true, missing: [] },
  notion: { configured: true, missing: [] },
  google: { configured: true, missing: [] },
};

function prettyKey(part: string): string {
  switch (part.toLowerCase()) {
    case "commandorcontrol":
      return IS_MACOS ? "\u2318" : "Ctrl";
    case "command":
    case "cmd":
    case "super":
    case "meta":
      return IS_MACOS ? "\u2318" : "Win";
    case "control":
    case "ctrl":
      return IS_MACOS ? "\u2303" : "Ctrl";
    case "shift":
      return IS_MACOS ? "\u21e7" : "Shift";
    case "alt":
    case "option":
      return IS_MACOS ? "\u2325" : "Alt";
    case "space":
      return "Space";
    default:
      return part.length === 1 ? part.toUpperCase() : part;
  }
}

function WelcomeStep() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <div className="onboard-brand-hero mb-5">
        <div className="onboard-brand-orb-shell">
          <ChuteLogo size={168} animated className="onboard-brand-orb" />
        </div>
      </div>
      <h1 className="onboard-brand mb-4">
        <span className="onboard-brand-word" style={{ animationDelay: "0ms" }}>
          Chute
        </span>
      </h1>
      <p className="onboard-brand-tagline max-w-xs text-sm leading-6 text-[var(--text)]">
        Type once. <span className="font-serif-italic">It knows</span> where it goes.
      </p>
      <p className="onboard-brand-sub codex-muted mt-3 max-w-sm text-xs leading-5">
        Reminders, Notes, Calendar, Slack — one keystroke, with the reason shown.
      </p>
    </div>
  );
}

type FeatureSlide = (typeof FEATURE_SLIDES)[number];

function TourMock({ slide }: { slide: FeatureSlide }) {
  const visual = slide.visual;

  if (visual === "app") {
    return (
      <div className="tour-mock">
        <div className="tour-mock-bar">
          <span className="tour-mock-title">Chute</span>
          <span className="tour-mock-pill">
            <span className="tour-mock-dot" />
            {slide.dest}
          </span>
        </div>
        <div className="tour-mock-body">
          <div className="tour-mock-chips" style={{ marginTop: 0 }}>
            <span className="tour-mock-chip">{slide.example}</span>
          </div>
          <div className="tour-mock-chips">
            <span className="tour-mock-chip tour-mock-chip-active">→ {slide.dest}</span>
          </div>
        </div>
      </div>
    );
  }

  if (visual === "capture") {
    return (
      <div className="tour-mock">
        <div className="tour-mock-bar">
          <span className="tour-mock-title">Chute</span>
          <span className="tour-mock-pill">
            <span className="tour-mock-dot" />
            Capture
          </span>
        </div>
        <div className="tour-mock-body">
          <div className="tour-mock-line medium" />
          <div className="tour-mock-line short" style={{ marginTop: "0.35rem" }} />
          <div className="tour-mock-chips">
            <span className="tour-mock-chip">Call mom tomorrow at 5pm</span>
            <span className="tour-mock-chip">Standup notes</span>
          </div>
        </div>
      </div>
    );
  }

  if (visual === "lanes") {
    return (
      <div className="tour-mock">
        <div className="tour-mock-chips" style={{ marginTop: 0 }}>
          <span className="tour-mock-chip tour-mock-chip-active">Focus</span>
          <span className="tour-mock-chip">Distraction</span>
        </div>
        <div className="tour-mock-body" style={{ marginTop: "0.55rem" }}>
          <div className="tour-mock-line medium" />
          <div className="tour-mock-chip" style={{ marginTop: "0.45rem", display: "inline-flex" }}>
            Parking Lot
          </div>
        </div>
      </div>
    );
  }

  if (visual === "tags") {
    return (
      <div className="tour-mock">
        <div className="tour-mock-chips" style={{ marginTop: 0, justifyContent: "center" }}>
          <span className="tour-mock-chip tour-mock-chip-active">Work</span>
          <span className="tour-mock-chip">Personal</span>
          <span className="tour-mock-chip">Idea</span>
        </div>
        <div className="tour-mock-body" style={{ marginTop: "0.55rem" }}>
          <div className="tour-mock-line medium" />
          <div className="tour-mock-line short" style={{ marginTop: "0.35rem" }} />
        </div>
      </div>
    );
  }

  if (visual === "lists") {
    return (
      <div className="tour-mock">
        <div className="tour-mock-body">
          <div className="tour-mock-chips" style={{ marginTop: 0 }}>
            <span className="tour-mock-chip tour-mock-chip-active">Inbox</span>
            <span className="tour-mock-chip">Projects</span>
            <span className="tour-mock-chip">Reading</span>
          </div>
          <div className="tour-mock-line medium" style={{ marginTop: "0.55rem" }} />
        </div>
      </div>
    );
  }

  return (
    <div className="tour-mock">
      <div className="tour-mock-bar">
        <span className="tour-mock-title">History</span>
        <span className="tour-mock-pill">
          <svg viewBox="0 0 24 24" width="10" height="10" aria-hidden>
            <path
              d="M3 3v5h5M3.05 13A9 9 0 1 0 6 5.3L3 8M12 7v5l4 2"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </span>
      </div>
      <div className="tour-mock-body space-y-2">
        <div className="tour-mock-line medium" />
        <div className="tour-mock-line short" />
        <div className="tour-mock-line medium" />
      </div>
    </div>
  );
}

function FeaturesTourStep({
  slideIndex,
  onSelectSlide,
}: {
  slideIndex: number;
  onSelectSlide: (index: number) => void;
}) {
  const slide = FEATURE_SLIDES[slideIndex];

  return (
    <div className="tour-slide-shell onboard-panel mx-auto w-full">
      <TourMock slide={slide} key={slide.title} />
      <div className="tour-slide-copy max-w-xs" key={slide.title}>
        <h2 className="text-base font-semibold tracking-tight">{slide.title}</h2>
        <p className="codex-muted mt-2 text-xs leading-5">{slide.body}</p>
      </div>
      <div className="tour-slide-dots" aria-label="Feature slides">
        {FEATURE_SLIDES.map((item, index) => (
          <button
            key={item.title}
            type="button"
            aria-label={`Show ${item.title}`}
            aria-current={index === slideIndex ? "true" : undefined}
            className={["tour-slide-dot", index === slideIndex ? "tour-slide-dot-active" : ""].join(" ")}
            onClick={() => onSelectSlide(index)}
          />
        ))}
      </div>
    </div>
  );
}

interface OnboardingProps {
  onDone: () => void;
}

export default function Onboarding({ onDone }: OnboardingProps) {
  const setTheme = useAppStore((state) => state.setTheme);
  const [step, setStep] = useState(1);
  const [backendUrl, setBackendUrl] = useState(DEFAULT_BACKEND_URL);
  const [providerConfig, setProviderConfig] = useState(DEFAULT_PROVIDER_CONFIG);
  const [connected, setConnected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [hotkey, setHotkey] = useState("Ctrl+Shift+Space");
  const [hotkeyTried, setHotkeyTried] = useState(false);
  const [appleTested, setAppleTested] = useState(false);
  const [featureSlide, setFeatureSlide] = useState(0);

  const hotkeyParts = useMemo(() => hotkey.split("+").map((part) => prettyKey(part.trim())), [hotkey]);

  const refreshConnected = useCallback(async () => {
    const saved = await loadIntegrationSettings();
    const next: Record<string, boolean> = {};
    for (const provider of PROVIDERS) {
      next[provider.id] = providerConfigured(provider.id, saved);
    }
    setConnected(next);
  }, []);

  useEffect(() => {
    // The wizard gets a tall, dead-center window — not the capture bar's
    // Spotlight placement it would otherwise inherit.
    void invoke("show_onboarding_window").catch(() => {});

    document.documentElement.dataset.theme = "dark";
    setTheme("dark");
    void setSetting("theme", "dark");

    void (async () => {
      const saved = await getSettings(["integration_backend_url", "hotkey"]);
      const nextBackend = saved.integration_backend_url?.trim() || DEFAULT_BACKEND_URL;
      setBackendUrl(nextBackend);
      if (saved.hotkey?.trim()) {
        setHotkey(saved.hotkey.trim());
      } else {
        try {
          setHotkey(await invoke<string>("get_active_hotkey"));
        } catch {
          // keep default
        }
      }
      await refreshConnected();
      try {
        setProviderConfig(await getConnectProvidersConfig(nextBackend));
      } catch {
        setProviderConfig(DEFAULT_PROVIDER_CONFIG);
      }
    })().catch(console.error);
  }, [refreshConnected, setTheme]);

  useEffect(() => {
    if (step !== 2) {
      return;
    }

    const timer = window.setInterval(() => {
      setFeatureSlide((current) => (current + 1) % FEATURE_SLIDES.length);
    }, 3500);

    return () => {
      window.clearInterval(timer);
    };
  }, [step]);

  useEffect(() => {
    if (step !== 4) {
      return;
    }

    let hideTimer: number | undefined;
    const unlisten = listen("chute://show-capture", () => {
      setHotkeyTried(true);
      if (hideTimer !== undefined) {
        window.clearTimeout(hideTimer);
      }
      hideTimer = window.setTimeout(() => {
        void invoke("hide_capture_window").catch(() => {});
      }, 1100);
    });

    return () => {
      if (hideTimer !== undefined) {
        window.clearTimeout(hideTimer);
      }
      unlisten.then((dispose) => dispose()).catch(() => {});
    };
  }, [step]);

  async function connectProvider(provider: ConnectProvider, label: string) {
    setBusy(`connect-${provider}`);
    setMessage("");
    try {
      if (!providerConfig[provider].configured) {
        throw new Error(`${label} isn't set up on the backend yet (${providerConfig[provider].missing.join(", ")}).`);
      }
      await assertConnectBackendReachable(backendUrl);
      const start = await startConnectSession(backendUrl, provider);
      await invoke("open_external_url", { url: start.authorizeUrl });
      setMessage(`Finish signing in to ${label} in your browser\u2026`);
      const completion = await waitForConnectCompletion(start.statusUrl);
      if (completion.status !== "completed" || !completion.settings) {
        throw new Error(completion.message ?? `${label} connection didn't finish.`);
      }
      await Promise.all(
        Object.entries(completion.settings).map(([key, value]) => setSetting(key, value ?? "")),
      );
      await refreshConnected();
      setMessage(`${label} connected.`);
      await emit("chute://request-sync");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  async function sendAppleTest() {
    setBusy("apple");
    setMessage("");
    try {
      await testAppleNotes();
      setAppleTested(true);
      setMessage("Test note created in Apple Notes.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  async function finish() {
    setBusy("finish");
    try {
      await setSetting("onboarding_complete", "true");
      onDone();
      await invoke("hide_capture_window");
    } catch (error) {
      console.error(error);
      setBusy("");
    }
  }

  const connectedCount = Object.values(connected).filter(Boolean).length;
  const appleDone = IS_MACOS && appleTested;

  function isDestinationDone(logoId: ProviderLogoId): boolean {
    if (logoId === "apple-notes") {
      return appleDone;
    }
    const provider = PROVIDERS.find((item) => item.logoId === logoId);
    return provider ? connected[provider.id] : false;
  }

  return (
    <div
      className={[
        "onboard-scene app-page flex h-full w-full flex-col overflow-hidden",
        step === 1 ? "onboard-scene-welcome" : "",
      ].join(" ")}
    >
      <div className="onboard-moon-glow" aria-hidden />

      <div className="relative z-10 flex min-h-0 flex-1 flex-col px-5 pb-5 pt-6">
        {step > 1 ? (
          <div className="mb-4 flex justify-center">
            <div className="onboard-progress" aria-label={`Step ${step} of ${TOTAL_STEPS}`}>
              {Array.from({ length: TOTAL_STEPS }, (_, index) => (
                <span
                  key={index}
                  className={[
                    "onboard-progress-dot",
                    index + 1 <= step ? "onboard-progress-dot-active" : "",
                  ].join(" ")}
                />
              ))}
            </div>
          </div>
        ) : null}

        <div key={step} className="step-fade flex min-h-0 flex-1 flex-col">
          {step === 1 ? <WelcomeStep /> : null}

          {step === 2 ? (
            <FeaturesTourStep slideIndex={featureSlide} onSelectSlide={setFeatureSlide} />
          ) : null}

          {step === 3 ? (
            <div className="onboard-panel mx-auto flex min-h-0 w-full flex-1 flex-col">
              <div className="onboard-connect-head mb-5 shrink-0">
                <h2 className="text-lg font-semibold tracking-tight">Connect your apps</h2>
                <p className="codex-muted mx-auto mt-2 max-w-sm text-xs leading-5">
                  Sign in so Chute can send captures outward — each Connect opens your browser
                  for a normal sign-in. Connected apps auto-enable under Send to when you capture.
                  The first Connect can take up to a minute while the service wakes up.
                </p>
              </div>

              <div className="mb-4 flex flex-wrap justify-center gap-2">
                {ALL_DESTINATIONS.map((dest) => {
                  const done = isDestinationDone(dest.logoId);
                  return (
                    <span
                      key={dest.logoId}
                      className={[
                        "onboard-connect-chip",
                        done ? "onboard-connect-chip-done" : "",
                      ].join(" ")}
                    >
                      <ProviderLogo id={dest.logoId} size={26} />
                      {dest.label}
                    </span>
                  );
                })}
              </div>

              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
                {PROVIDERS.map((provider) => {
                  const isConnected = connected[provider.id];
                  const configured = providerConfig[provider.id].configured;
                  return (
                    <div
                      key={provider.id}
                      className="cmd-row flex items-center justify-between gap-3 px-3 py-2.5"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <ProviderLogo id={provider.logoId} size={38} />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{provider.label}</div>
                          <div className="codex-muted truncate text-[11px]">
                            {isConnected ? "Signed in — will sync when Send to is on" : provider.blurb}
                            {!configured ? " — backend not configured" : ""}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={busy.length > 0 || isConnected || !configured}
                        onClick={() => void connectProvider(provider.id, provider.label)}
                        className={[
                          "shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed",
                          isConnected ? "codex-btn-soft opacity-70" : "codex-btn",
                          busy === `connect-${provider.id}` ? "opacity-60" : "",
                        ].join(" ")}
                      >
                        {isConnected
                          ? "Connected"
                          : busy === `connect-${provider.id}`
                            ? "Waiting\u2026"
                            : "Connect"}
                      </button>
                    </div>
                  );
                })}

                <div className="cmd-row flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <ProviderLogo id="apple-notes" size={38} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium">Apple Notes</div>
                      <div className="codex-muted text-[11px]">
                        {appleDone
                          ? "Working"
                          : IS_MACOS
                            ? "Built in — no OAuth needed"
                            : "Available on macOS only"}
                      </div>
                    </div>
                  </div>
                  {IS_MACOS ? (
                    <button
                      type="button"
                      disabled={busy.length > 0}
                      onClick={() => void sendAppleTest()}
                      className="codex-btn-soft shrink-0 rounded-lg px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busy === "apple" ? "Testing\u2026" : appleDone ? "Test again" : "Enable"}
                    </button>
                  ) : (
                    <span className="codex-muted shrink-0 text-[11px]">macOS</span>
                  )}
                </div>
              </div>

              {connectedCount > 0 || appleDone ? (
                <p className="codex-muted mt-3 shrink-0 text-center text-[11px]">
                  {connectedCount + (appleDone ? 1 : 0)} destination
                  {connectedCount + (appleDone ? 1 : 0) === 1 ? "" : "s"} ready
                </p>
              ) : null}
            </div>
          ) : null}

          {step === 4 ? (
            <div className="onboard-panel mx-auto flex flex-1 flex-col justify-center space-y-5">
              <div className="text-center">
                <h2 className="text-lg font-semibold tracking-tight">Your capture shortcut</h2>
                <p className="codex-muted mt-2 text-xs leading-5">
                  From anywhere on your computer, press this to pop open the capture box.
                </p>
              </div>
              <div className="flex items-center justify-center gap-2 py-2">
                {hotkeyParts.map((part, index) => (
                  <span key={`${part}-${index}`} className={`keycap ${hotkeyTried ? "" : "keycap-press"}`}>
                    {part}
                  </span>
                ))}
              </div>
              <div
                className={[
                  "rounded-xl border px-3 py-2.5 text-sm transition",
                  hotkeyTried
                    ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-500"
                    : "border-[var(--border)] bg-[var(--panel-2)] text-[var(--muted)]",
                ].join(" ")}
              >
                {hotkeyTried
                  ? "Nice — that's it! Type a thought, hit Enter, and it's captured."
                  : "Try it now: press the keys above. The capture box will appear, then tuck away."}
              </div>
              <p className="codex-muted text-center text-xs">
                Change this anytime in Settings → General.
              </p>
            </div>
          ) : null}
        </div>

        {message ? <div className="codex-muted relative z-10 mt-3 text-center text-xs">{message}</div> : null}

        <div className="onboard-footer relative z-10 mt-5 flex shrink-0 items-center justify-between gap-2 pt-4">
          <button
            type="button"
            disabled={busy === "finish"}
            onClick={() => void finish()}
            className="codex-muted text-xs underline-offset-2 hover:underline disabled:opacity-50"
          >
            Skip setup
          </button>
          <div className="flex gap-2">
            {step > 1 ? (
              <button
                type="button"
                disabled={busy.length > 0}
                onClick={() => setStep((value) => Math.max(1, value - 1))}
                className="codex-btn-soft rounded-lg px-4 py-2 text-xs disabled:opacity-50"
              >
                Back
              </button>
            ) : null}
            {step < TOTAL_STEPS ? (
              <button
                type="button"
                disabled={busy.length > 0}
                onClick={() => setStep((value) => value + 1)}
                className="codex-btn rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50"
              >
                {step === 1 ? "Get started" : "Next"}
              </button>
            ) : (
              <button
                type="button"
                disabled={busy === "finish"}
                onClick={() => void finish()}
                className="codex-btn rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50"
              >
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
