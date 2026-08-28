import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { deleteRoutingRule, getSettings, listRoutingRules, setSetting } from "../lib/db";
import { getLlmUsageToday } from "../lib/agent/agentEngine";
import {
  providerConfigured,
} from "../lib/integrations/connectionStatus";
import { describeRule } from "../lib/integrations/captureRouting";
import {
  getConnectProvidersConfig,
  isConnectCancelled,
  startConnectSession,
  waitForConnectCompletion,
  type ConnectProvider,
  type ProviderConfigState,
} from "../lib/integrations/oauthConnect";
import { parseReminderSyntax } from "../lib/parser";
import { testDiscordWebhook } from "../lib/sync/discord";
import { testGoogleCalendarConnection } from "../lib/sync/googleCalendar";
import { testGoogleTasksConnection } from "../lib/sync/googleTasks";
import { testNotionConnection } from "../lib/sync/notion";
import { testAppleNotes } from "../lib/sync/appleNotes";
import { testAppleReminders } from "../lib/sync/appleRemindersSync";
import { testSlackWebhook } from "../lib/sync/slack";
import { runSyncPass } from "../lib/sync/syncManager";
import { isMacOS } from "../lib/platform";
import { useAppStore } from "../store/useAppStore";
import ChuteLogo from "./ChuteLogo";
import type { RoutingRule, ThemeMode } from "../types";

const DEFAULT_BACKEND_URL = "https://klyph-auth.onrender.com";

type SettingsTab = "general" | "agent" | "integrations" | "tools";

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "general", label: "General" },
  { id: "agent", label: "AI Agent" },
  { id: "integrations", label: "Integrations" },
  { id: "tools", label: "Tools" },
];

const SETTING_KEYS = [
  "hotkey",
  "theme",
  "launch_at_login",
  "agent_enabled",
  "agent_auto_apply_threshold",
  "agent_daily_llm_limit",
  "openai_api_key",
  "integration_backend_url",
  "slack_webhook_url",
  "discord_webhook_url",
  "notion_token",
  "notion_page_id",
  "google_tasks_access_token",
  "google_tasks_refresh_token",
  "google_tasks_list_id",
  "google_calendar_id",
  "apple_notes_folder",
  "apple_reminders_list",
] as const;

const IS_MACOS = isMacOS();

const PROVIDER_SETTING_KEYS: Record<ConnectProvider, string[]> = {
  slack: ["slack_webhook_url"],
  discord: ["discord_webhook_url"],
  notion: ["notion_token", "notion_page_id"],
  google: [
    "google_tasks_access_token",
    "google_tasks_refresh_token",
    "google_tasks_list_id",
    "google_calendar_id",
  ],
};

const DEFAULT_PROVIDER_CONFIG: Record<ConnectProvider, ProviderConfigState> = {
  slack: { configured: true, missing: [] },
  discord: { configured: true, missing: [] },
  notion: { configured: true, missing: [] },
  google: { configured: true, missing: [] },
};

function integrationSettingsFromState(input: {
  slackWebhook: string;
  discordWebhook: string;
  notionToken: string;
  notionPageId: string;
  googleAccessToken: string;
  googleListId: string;
  googleCalendarId: string;
}) {
  return {
    slack_webhook_url: input.slackWebhook,
    discord_webhook_url: input.discordWebhook,
    notion_token: input.notionToken,
    notion_page_id: input.notionPageId,
    google_tasks_access_token: input.googleAccessToken,
    google_tasks_refresh_token: null,
    google_tasks_list_id: input.googleListId,
    google_calendar_id: input.googleCalendarId,
  };
}

export default function SettingsPanel() {
  const { hotkey, setHotkey, theme, setTheme } = useAppStore();

  const [hotkeyDraft, setHotkeyDraft] = useState(hotkey);
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [themeDraft, setThemeDraft] = useState<ThemeMode>(theme);

  const [backendUrl, setBackendUrl] = useState(DEFAULT_BACKEND_URL);
  const [agentEnabled, setAgentEnabled] = useState(true);
  const [agentAutoApplyThreshold, setAgentAutoApplyThreshold] = useState("0.88");
  const [agentDailyLlmLimit, setAgentDailyLlmLimit] = useState("200");
  const [llmUsageToday, setLlmUsageToday] = useState(0);
  const [openAiApiKey, setOpenAiApiKey] = useState("");

  const [slackWebhook, setSlackWebhook] = useState("");
  const [discordWebhook, setDiscordWebhook] = useState("");
  const [notionToken, setNotionToken] = useState("");
  const [notionPageId, setNotionPageId] = useState("");
  const [googleAccessToken, setGoogleAccessToken] = useState("");
  const [googleRefreshToken, setGoogleRefreshToken] = useState("");
  const [googleListId, setGoogleListId] = useState("");
  const [googleCalendarId, setGoogleCalendarId] = useState("primary");
  const [appleNotesFolder, setAppleNotesFolder] = useState("Chute");
  const [appleRemindersList, setAppleRemindersList] = useState("Chute");

  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [providerConfig, setProviderConfig] = useState(DEFAULT_PROVIDER_CONFIG);
  const [status, setStatus] = useState("");
  const [syncStatus, setSyncStatus] = useState("");
  const [busyAction, setBusyAction] = useState("");
  // Held so the user can Cancel a connect that's stuck waiting on the browser.
  const connectAbort = useRef<AbortController | null>(null);
  const [parserDebugInput, setParserDebugInput] = useState("testing for tomorrow");
  const [routingRules, setRoutingRules] = useState<RoutingRule[]>([]);
  const [deletingRuleId, setDeletingRuleId] = useState<string | null>(null);

  const connectionState = useMemo(() => {
    const settings = integrationSettingsFromState({
      slackWebhook,
      discordWebhook,
      notionToken,
      notionPageId,
      googleAccessToken,
      googleListId,
      googleCalendarId,
    });
    return {
      slack: providerConfigured("slack", settings),
      discord: providerConfigured("discord", settings),
      notion: providerConfigured("notion", settings),
      google: providerConfigured("google", settings),
    };
  }, [
    discordWebhook,
    googleAccessToken,
    googleCalendarId,
    googleListId,
    notionPageId,
    notionToken,
    slackWebhook,
  ]);

  const parserDebug = useMemo(
    () => parseReminderSyntax(parserDebugInput),
    [parserDebugInput],
  );

  const refreshProviderConfig = useCallback(async (baseUrl: string) => {
    try {
      const next = await getConnectProvidersConfig(baseUrl);
      setProviderConfig(next);
    } catch (error) {
      console.warn("Could not load provider config status", error);
      setProviderConfig(DEFAULT_PROVIDER_CONFIG);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    const saved = await getSettings([...SETTING_KEYS]);

    if (saved.hotkey) {
      setHotkeyDraft(saved.hotkey);
    }
    if (saved.theme === "auto" || saved.theme === "dark" || saved.theme === "light") {
      setThemeDraft(saved.theme);
    }
    setLaunchAtLogin(saved.launch_at_login === "true");
    setAgentEnabled((saved.agent_enabled ?? "true") !== "false");
    setAgentAutoApplyThreshold(saved.agent_auto_apply_threshold ?? "0.88");
    setAgentDailyLlmLimit(saved.agent_daily_llm_limit ?? "200");
    setOpenAiApiKey(saved.openai_api_key ?? "");
    setLlmUsageToday(await getLlmUsageToday());

    const nextBackendUrl = saved.integration_backend_url?.trim() || DEFAULT_BACKEND_URL;
    setBackendUrl(nextBackendUrl);
    await refreshProviderConfig(nextBackendUrl);

    setSlackWebhook(saved.slack_webhook_url ?? "");
    setDiscordWebhook(saved.discord_webhook_url ?? "");
    setNotionToken(saved.notion_token ?? "");
    setNotionPageId(saved.notion_page_id ?? "");
    setGoogleAccessToken(saved.google_tasks_access_token ?? "");
    setGoogleRefreshToken(saved.google_tasks_refresh_token ?? "");
    setGoogleListId(saved.google_tasks_list_id ?? "");
    setGoogleCalendarId(saved.google_calendar_id ?? "primary");
    setAppleNotesFolder(saved.apple_notes_folder?.trim() || "Chute");
    setAppleRemindersList(saved.apple_reminders_list?.trim() || "Chute");

    try {
      setRoutingRules(await listRoutingRules());
    } catch (error) {
      console.error("Failed to load routing rules", error);
    }
  }, [refreshProviderConfig]);

  async function removeRoutingRule(id: string) {
    setDeletingRuleId(id);
    try {
      await deleteRoutingRule(id);
      setRoutingRules(await listRoutingRules());
    } catch (error) {
      console.error("Failed to delete routing rule", error);
      setStatus("Could not delete the routing rule.");
    } finally {
      setDeletingRuleId(null);
    }
  }

  useEffect(() => {
    void loadSettings().catch(console.error);
  }, [loadSettings]);

  async function saveGeneralSettings() {
    setBusyAction("save-general");
    setStatus("");

    try {
      await invoke("set_capture_hotkey", { hotkey: hotkeyDraft.trim() });
      await Promise.all([
        setSetting("hotkey", hotkeyDraft.trim()),
        setSetting("theme", themeDraft),
        setSetting("launch_at_login", launchAtLogin ? "true" : "false"),
      ]);

      setHotkey(hotkeyDraft.trim());
      setTheme(themeDraft);
      // Broadcast so the Library window (and any future webview) can re-skin
      // without having to poll SQLite.
      void emit("chute://theme-changed", { theme: themeDraft });
      setStatus("General settings saved.");
    } catch (error) {
      console.error(error);
      setStatus("Failed to save general settings.");
    } finally {
      setBusyAction("");
    }
  }

  async function saveBackendUrl() {
    setBusyAction("save-backend");
    setStatus("");
    try {
      const nextBackendUrl = backendUrl.trim() || DEFAULT_BACKEND_URL;
      await setSetting("integration_backend_url", nextBackendUrl);
      await refreshProviderConfig(nextBackendUrl);
      setStatus("OAuth backend URL saved.");
    } catch (error) {
      console.error(error);
      setStatus("Failed to save OAuth backend URL.");
    } finally {
      setBusyAction("");
    }
  }

  async function saveAgentSettings() {
    setBusyAction("save-agent");
    setStatus("");

    const parsedThreshold = Number.parseFloat(agentAutoApplyThreshold);
    if (Number.isNaN(parsedThreshold) || parsedThreshold < 0.5 || parsedThreshold > 0.99) {
      setStatus("Auto-apply threshold must be between 0.5 and 0.99.");
      setBusyAction("");
      return;
    }

    const parsedDailyLimit = Number.parseInt(agentDailyLlmLimit, 10);
    if (Number.isNaN(parsedDailyLimit) || parsedDailyLimit < 0) {
      setStatus("Daily AI call limit must be 0 or greater.");
      setBusyAction("");
      return;
    }

    try {
      await Promise.all([
        setSetting("agent_enabled", agentEnabled ? "true" : "false"),
        setSetting("agent_auto_apply_threshold", parsedThreshold.toString()),
        setSetting("agent_daily_llm_limit", parsedDailyLimit.toString()),
        setSetting("openai_api_key", openAiApiKey.trim()),
      ]);
      setStatus("AI agent settings saved.");
      await emit("chute://request-agent");
    } catch (error) {
      console.error(error);
      setStatus("Failed to save AI agent settings.");
    } finally {
      setBusyAction("");
    }
  }

  async function saveAdvancedIntegrations() {
    setBusyAction("save-advanced");
    setStatus("");
    try {
      await Promise.all([
        setSetting("slack_webhook_url", slackWebhook.trim()),
        setSetting("discord_webhook_url", discordWebhook.trim()),
        setSetting("notion_token", notionToken.trim()),
        setSetting("notion_page_id", notionPageId.trim()),
        setSetting("google_tasks_access_token", googleAccessToken.trim()),
        setSetting("google_tasks_refresh_token", googleRefreshToken.trim()),
        setSetting("google_tasks_list_id", googleListId.trim()),
        setSetting("google_calendar_id", googleCalendarId.trim() || "primary"),
      ]);
      setStatus("Advanced integration settings saved.");
      await emit("chute://request-sync");
    } catch (error) {
      console.error(error);
      setStatus("Failed to save advanced integration settings.");
    } finally {
      setBusyAction("");
    }
  }

  async function saveAppleNotes() {
    setBusyAction("save-apple-notes");
    setStatus("");
    try {
      await setSetting("apple_notes_folder", appleNotesFolder.trim() || "Chute");
      setStatus("Apple Notes folder saved.");
      await emit("chute://request-sync");
    } catch (error) {
      console.error(error);
      setStatus("Failed to save Apple Notes folder.");
    } finally {
      setBusyAction("");
    }
  }

  async function saveAppleReminders() {
    setBusyAction("save-apple-reminders");
    setStatus("");
    try {
      await setSetting("apple_reminders_list", appleRemindersList.trim() || "Chute");
      setStatus("Reminders list saved.");
      await emit("chute://request-sync");
    } catch (error) {
      console.error(error);
      setStatus("Failed to save Reminders list.");
    } finally {
      setBusyAction("");
    }
  }

  async function connectProvider(provider: ConnectProvider, label: string) {
    const controller = new AbortController();
    connectAbort.current = controller;
    setBusyAction(`connect-${provider}`);
    setSyncStatus("");

    try {
      const baseUrl = backendUrl.trim() || DEFAULT_BACKEND_URL;
      const configState = providerConfig[provider];
      if (!configState.configured) {
        throw new Error(
          `${label} is not configured on OAuth backend. Missing: ${configState.missing.join(", ")}`,
        );
      }
      const start = await startConnectSession(baseUrl, provider, controller.signal);

      await invoke("open_external_url", { url: start.authorizeUrl });
      setSyncStatus(`Browser opened for ${label}. Finish sign-in there — or press Cancel to stop.`);

      const completion = await waitForConnectCompletion(start.statusUrl, undefined, undefined, controller.signal);

      if (completion.status !== "completed" || !completion.settings) {
        throw new Error(completion.message ?? `${label} connect failed.`);
      }

      await Promise.all(
        Object.entries(completion.settings).map(([key, value]) => setSetting(key, value ?? "")),
      );

      await loadSettings();
      setSyncStatus(`${label} connected.`);
      await emit("chute://request-sync");
    } catch (error) {
      if (isConnectCancelled(error)) {
        setSyncStatus(`${label} sign-in cancelled.`);
      } else {
        console.error(error);
        setSyncStatus(`Connect failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      connectAbort.current = null;
      setBusyAction("");
    }
  }

  function cancelConnect() {
    connectAbort.current?.abort();
  }

  async function disconnectProvider(provider: ConnectProvider, label: string) {
    setBusyAction(`disconnect-${provider}`);
    setSyncStatus("");

    try {
      const keys = PROVIDER_SETTING_KEYS[provider];
      await Promise.all(keys.map((key) => setSetting(key, "")));
      await loadSettings();
      setSyncStatus(`${label} disconnected.`);
    } catch (error) {
      console.error(error);
      setSyncStatus(`Disconnect failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyAction("");
    }
  }

  async function runTest(
    id: string,
    callback: () => Promise<void>,
    successMessage: string,
  ): Promise<void> {
    setBusyAction(id);
    setSyncStatus("");
    try {
      await callback();
      setSyncStatus(successMessage);
    } catch (error) {
      console.error(error);
      setSyncStatus(`Test failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyAction("");
    }
  }

  async function backfillUnsynced() {
    setBusyAction("backfill");
    setSyncStatus("");
    try {
      const { stats } = await runSyncPass();
      setSyncStatus(
        `Backfill complete. Captures synced: ${stats.capturesSynced}, attempts: ${stats.syncAttempts}, failed: ${stats.syncFailed}.`,
      );
      await emit("chute://request-sync");
    } catch (error) {
      console.error(error);
      setSyncStatus(`Backfill failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyAction("");
    }
  }

  return (
    <div className="app-page h-full w-full overflow-y-auto p-5">
      <div className="mb-5 flex items-center gap-2.5">
        <ChuteLogo size={28} />
        <h1 className="codex-panel-title text-[1.4rem] font-medium leading-none">
          Chute <span className="font-serif-italic">Settings</span>
        </h1>
      </div>

      <nav className="mb-4 inline-flex flex-wrap gap-1 rounded-xl border border-[var(--border)] bg-[var(--btn-soft)] p-1">
        {SETTINGS_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={[
              "rounded-lg px-3 py-1.5 text-xs font-medium transition",
              activeTab === tab.id
                ? "codex-btn"
                : "codex-muted hover:bg-[var(--btn-soft-hover)] hover:text-[var(--text)]",
            ].join(" ")}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === "general" ? (
      <section className="codex-surface mb-4 rounded-xl p-4">
        <h2 className="label-micro mb-3">General</h2>

        <label className="mb-3 block">
          <span className="codex-muted mb-1 block text-xs">Global Hotkey</span>
          <input
            value={hotkeyDraft}
            onChange={(event) => setHotkeyDraft(event.currentTarget.value)}
            placeholder="Ctrl+Shift+Space"
            className="codex-input w-full rounded-lg px-3 py-2 text-sm outline-none"
          />
        </label>

        <label className="mb-3 flex items-center justify-between text-sm">
          Launch at login
          <input
            type="checkbox"
            checked={launchAtLogin}
            onChange={(event) => setLaunchAtLogin(event.currentTarget.checked)}
          />
        </label>

        <label className="mb-4 block">
          <span className="codex-muted mb-1 block text-xs">Theme</span>
          <select
            value={themeDraft}
            onChange={(event) => setThemeDraft(event.currentTarget.value as ThemeMode)}
            className="codex-input w-full rounded-lg px-3 py-2 text-sm outline-none"
          >
            <option value="auto">Auto</option>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </label>

        <button
          type="button"
          disabled={busyAction.length > 0}
          onClick={() => void saveGeneralSettings()}
          className="codex-btn rounded-lg px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
        >
          Save General Settings
        </button>

        <div className="mt-4 flex items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
          <div className="min-w-0">
            <div className="text-sm">Welcome tour</div>
            <div className="codex-muted text-[11px]">Replay the intro and app walkthrough.</div>
          </div>
          <button
            type="button"
            onClick={() => void emit("chute://replay-onboarding")}
            className="codex-btn-soft shrink-0 rounded-lg px-3 py-1.5 text-xs"
          >
            Replay tour
          </button>
        </div>
      </section>
      ) : null}

      {activeTab === "agent" ? (
      <section className="codex-surface mb-4 rounded-xl p-4">
        <h2 className="label-micro mb-3">AI Agent</h2>

        <label className="mb-3 flex items-center justify-between text-sm">
          Enable agent suggestions
          <input
            type="checkbox"
            checked={agentEnabled}
            onChange={(event) => setAgentEnabled(event.currentTarget.checked)}
          />
        </label>

        <label className="mb-3 block">
          <span className="codex-muted mb-1 block text-xs">OpenAI API Key (optional)</span>
          <input
            type="password"
            value={openAiApiKey}
            onChange={(event) => setOpenAiApiKey(event.currentTarget.value)}
            placeholder="sk-..."
            className="codex-input w-full rounded-lg px-3 py-2 text-sm outline-none"
          />
        </label>

        <label className="mb-4 block">
          <span className="codex-muted mb-1 block text-xs">Auto-apply threshold (0.5 - 0.99)</span>
          <input
            type="number"
            min={0.5}
            max={0.99}
            step={0.01}
            value={agentAutoApplyThreshold}
            onChange={(event) => setAgentAutoApplyThreshold(event.currentTarget.value)}
            className="codex-input w-full rounded-lg px-3 py-2 text-sm outline-none"
          />
        </label>

        <label className="mb-2 block">
          <span className="codex-muted mb-1 block text-xs">
            Daily AI call limit (0 disables AI calls; rules still run)
          </span>
          <input
            type="number"
            min={0}
            step={1}
            value={agentDailyLlmLimit}
            onChange={(event) => setAgentDailyLlmLimit(event.currentTarget.value)}
            className="codex-input w-full rounded-lg px-3 py-2 text-sm outline-none"
          />
        </label>
        <p className="codex-muted mb-4 text-[11px]">
          AI calls used today: {llmUsageToday}
          {agentDailyLlmLimit.trim() ? ` / ${agentDailyLlmLimit.trim()}` : ""}
        </p>

        <button
          type="button"
          disabled={busyAction.length > 0}
          onClick={() => void saveAgentSettings()}
          className="codex-btn rounded-lg px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
        >
          Save AI Agent Settings
        </button>
      </section>
      ) : null}

      {activeTab === "agent" ? (
      <section className="codex-surface mb-4 rounded-xl p-4">
        <h2 className="label-micro mb-2">Smart Routing Rules</h2>
        <p className="codex-muted mb-3 text-[11px] leading-5">
          Chute learns these when you correct a suggested destination and press{" "}
          <strong className="font-medium text-[var(--text)]">Always</strong> in the capture window.
          A rule sends every matching capture (by tag, list, lane, or keyword) to your chosen apps
          and always beats the built-in heuristics.
        </p>

        {routingRules.length === 0 ? (
          <p className="codex-muted text-xs">
            No rules yet. Change the destination of a tagged capture and Chute will offer to
            remember it.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {routingRules.map((rule) => (
              <li
                key={rule.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-xs"
              >
                <span className="min-w-0 truncate">
                  {describeRule(rule)}
                  <span className="codex-muted"> · used {rule.hit_count ?? 0}×</span>
                </span>
                <button
                  type="button"
                  disabled={deletingRuleId === rule.id}
                  onClick={() => void removeRoutingRule(rule.id)}
                  className="shrink-0 rounded-full border border-red-400/40 px-2 py-0.5 text-[11px] font-medium text-red-500 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {deletingRuleId === rule.id ? "Deleting..." : "Delete"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      ) : null}

      {activeTab === "tools" ? (

      <section className="codex-surface mb-4 rounded-xl p-4">
        <h2 className="label-micro mb-3">Parser Debug</h2>
        <p className="codex-muted mb-2 text-xs">
          Test natural-language reminder parsing locally (free, no API calls).
        </p>

        <textarea
          value={parserDebugInput}
          onChange={(event) => setParserDebugInput(event.currentTarget.value)}
          rows={3}
          className="codex-input mb-3 w-full rounded-lg px-3 py-2 text-xs outline-none"
          placeholder="e.g. remind me to file taxes on 18th at 3pm"
        />

        <div className="space-y-1 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3 text-[11px]">
          <div>Cleaned: {parserDebug.cleanedContent || "N/A"}</div>
          <div>Reminder: {parserDebug.previewLabel ?? "None"}</div>
          <div>Ambiguous: {parserDebug.isAmbiguous ? "Yes" : "No"}</div>
          <div>Confidence: {Math.round(parserDebug.confidence * 100)}%</div>
          <div>All-day: {parserDebug.allDay ? "Yes" : "No"}</div>
          <div>Duration: {parserDebug.durationMinutes ?? "N/A"} min</div>
          {parserDebug.ambiguityReason ? <div>Reason: {parserDebug.ambiguityReason}</div> : null}
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-[var(--border)] bg-[var(--btn-soft)] p-2 text-[10px] codex-muted">
            {parserDebug.debug}
          </pre>
        </div>
      </section>
      ) : null}

      {activeTab === "integrations" ? (
      <>
      <section className="codex-surface mb-4 rounded-xl p-4">
        <h2 className="label-micro mb-2">Integrations</h2>
        <p className="codex-muted mb-3 text-[11px] leading-5">
          Configured means sign-in credentials are saved locally. Captures only sync when you turn
          on the matching chip under <strong className="font-medium text-[var(--text)]">Send to</strong>{" "}
          in the capture window (or tap All).
        </p>

        <label className="mb-2 block">
          <span className="codex-muted mb-1 block text-xs">OAuth Backend URL</span>
          <input
            value={backendUrl}
            onChange={(event) => setBackendUrl(event.currentTarget.value)}
            placeholder="http://127.0.0.1:8787"
            className="codex-input w-full rounded-lg px-3 py-2 text-xs outline-none"
          />
        </label>
        <button
          type="button"
          disabled={busyAction.length > 0}
          onClick={() => void saveBackendUrl()}
          className="codex-btn-soft mb-4 rounded-lg px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
        >
          Save OAuth Backend URL
        </button>

        <div className="space-y-2">
          {([
            ["slack", "Slack", connectionState.slack],
            ["discord", "Discord", connectionState.discord],
            ["notion", "Notion", connectionState.notion],
            ["google", "Google (Tasks + Calendar)", connectionState.google],
          ] as const).map(([provider, label, connected]) => (
            <div
              key={provider}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2"
            >
              <div className="text-xs">
                {label}: {connected ? "Configured" : "Not configured"}
                {!providerConfig[provider].configured ? (
                  <div className="mt-1 text-[11px] text-amber-300/90">
                    Backend missing: {providerConfig[provider].missing.join(", ")}
                  </div>
                ) : connected ? (
                  <div className="mt-1 text-[11px] text-[var(--muted)]">
                    Ready — enable {label} under Send to when capturing.
                  </div>
                ) : null}
              </div>
              <div className="flex gap-2">
                {busyAction === `connect-${provider}` ? (
                  <button
                    type="button"
                    onClick={cancelConnect}
                    className="codex-btn-soft rounded-lg px-3 py-1.5 text-xs font-semibold"
                  >
                    Cancel
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busyAction.length > 0 || !providerConfig[provider].configured}
                    onClick={() => void connectProvider(provider, label)}
                    className="codex-btn rounded-lg px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {connected ? "Reconnect" : "Connect"}
                  </button>
                )}
                {connected && provider === "slack" ? (
                  <button
                    type="button"
                    disabled={busyAction.length > 0}
                    onClick={() =>
                      void runTest(
                        "test-slack-quick",
                        () => testSlackWebhook(slackWebhook.trim()),
                        "Slack test message sent.",
                      )
                    }
                    className="codex-btn-soft rounded-lg px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Test
                  </button>
                ) : null}
                {connected && provider === "discord" ? (
                  <button
                    type="button"
                    disabled={busyAction.length > 0}
                    onClick={() =>
                      void runTest(
                        "test-discord-quick",
                        () => testDiscordWebhook(discordWebhook.trim()),
                        "Discord test message sent.",
                      )
                    }
                    className="codex-btn-soft rounded-lg px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Test
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={busyAction.length > 0 || !connected}
                  onClick={() => void disconnectProvider(provider, label)}
                  className="codex-btn-soft rounded-lg px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Disconnect
                </button>
              </div>
            </div>
          ))}
        </div>

        {IS_MACOS ? (
          <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-3">
            <div className="mb-1 text-xs font-medium">Apple Notes</div>
            <p className="codex-muted mb-3 text-[11px]">
              Built in — no setup. Notes are created right on this Mac. The first save asks macOS
              for permission to control Notes; just click OK.
            </p>
            <label className="mb-2 block">
              <span className="codex-muted mb-1 block text-xs">Notes folder</span>
              <input
                value={appleNotesFolder}
                onChange={(event) => setAppleNotesFolder(event.currentTarget.value)}
                placeholder="Chute"
                className="codex-input w-full rounded-lg px-3 py-2 text-xs outline-none"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busyAction.length > 0}
                onClick={() => void saveAppleNotes()}
                className="codex-btn rounded-lg px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
              >
                Save Folder
              </button>
              <button
                type="button"
                disabled={busyAction.length > 0}
                onClick={() =>
                  void runTest(
                    "test-apple-notes",
                    () => testAppleNotes(appleNotesFolder.trim()),
                    "Test note created in Apple Notes.",
                  )
                }
                className="codex-btn-soft rounded-lg px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
              >
                Send Test Note
              </button>
            </div>
          </div>
        ) : null}

        {IS_MACOS ? (
          <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-3">
            <div className="mb-1 text-xs font-medium">Reminders</div>
            <p className="codex-muted mb-3 text-[11px]">
              Built in — no setup. Reminders are created right on this Mac and sync via iCloud.
              Timed captures automatically get a due date. The first save asks macOS for Automation
              permission; just click OK.
            </p>
            <label className="mb-2 block">
              <span className="codex-muted mb-1 block text-xs">Reminders list</span>
              <input
                value={appleRemindersList}
                onChange={(event) => setAppleRemindersList(event.currentTarget.value)}
                placeholder="Chute"
                className="codex-input w-full rounded-lg px-3 py-2 text-xs outline-none"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busyAction.length > 0}
                onClick={() => void saveAppleReminders()}
                className="codex-btn rounded-lg px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
              >
                Save List
              </button>
              <button
                type="button"
                disabled={busyAction.length > 0}
                onClick={() =>
                  void runTest(
                    "test-apple-reminders",
                    () => testAppleReminders(appleRemindersList.trim()),
                    "Test reminder created in Reminders.",
                  )
                }
                className="codex-btn-soft rounded-lg px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
              >
                Send Test Reminder
              </button>
            </div>
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => setAdvancedOpen((value) => !value)}
          className="codex-btn-soft mt-4 rounded-lg px-3 py-2 text-xs"
        >
          {advancedOpen ? "Hide Advanced" : "Show Advanced"}
        </button>

        {advancedOpen ? (
          <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3">
            <p className="codex-muted mb-3 text-xs">
              Advanced mode is for manual webhooks/tokens only.
            </p>

            <label className="mb-2 block">
              <span className="codex-muted mb-1 block text-xs">Slack Webhook URL</span>
              <input
                value={slackWebhook}
                onChange={(event) => setSlackWebhook(event.currentTarget.value)}
                placeholder="https://hooks.slack.com/services/..."
                className="codex-input w-full rounded-lg px-3 py-2 text-xs outline-none"
              />
            </label>
            <button
              type="button"
              disabled={busyAction.length > 0 || slackWebhook.trim().length === 0}
              onClick={() =>
                void runTest("test-slack", () => testSlackWebhook(slackWebhook.trim()), "Slack test sent.")
              }
              className="codex-btn-soft mb-3 rounded-lg px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
            >
              Test Slack
            </button>

            <label className="mb-2 block">
              <span className="codex-muted mb-1 block text-xs">Discord Webhook URL</span>
              <input
                value={discordWebhook}
                onChange={(event) => setDiscordWebhook(event.currentTarget.value)}
                placeholder="https://discord.com/api/webhooks/..."
                className="codex-input w-full rounded-lg px-3 py-2 text-xs outline-none"
              />
            </label>
            <button
              type="button"
              disabled={busyAction.length > 0 || discordWebhook.trim().length === 0}
              onClick={() =>
                void runTest(
                  "test-discord",
                  () => testDiscordWebhook(discordWebhook.trim()),
                  "Discord test sent.",
                )
              }
              className="codex-btn-soft mb-3 rounded-lg px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
            >
              Test Discord
            </button>

            <label className="mb-2 block">
              <span className="codex-muted mb-1 block text-xs">Notion Token</span>
              <input
                value={notionToken}
                onChange={(event) => setNotionToken(event.currentTarget.value)}
                placeholder="secret_xxx"
                className="codex-input w-full rounded-lg px-3 py-2 text-xs outline-none"
              />
            </label>
            <label className="mb-2 block">
              <span className="codex-muted mb-1 block text-xs">Notion Parent ID (Page or Database)</span>
              <input
                value={notionPageId}
                onChange={(event) => setNotionPageId(event.currentTarget.value)}
                placeholder="page_or_database_id"
                className="codex-input w-full rounded-lg px-3 py-2 text-xs outline-none"
              />
            </label>
            <button
              type="button"
              disabled={busyAction.length > 0 || notionToken.trim().length === 0 || notionPageId.trim().length === 0}
              onClick={() =>
                void runTest(
                  "test-notion",
                  () => testNotionConnection(notionToken.trim(), notionPageId.trim()),
                  "Notion connection works.",
                )
              }
              className="codex-btn-soft mb-3 rounded-lg px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
            >
              Test Notion
            </button>

            <label className="mb-2 block">
              <span className="codex-muted mb-1 block text-xs">Google Tasks Access Token</span>
              <input
                value={googleAccessToken}
                onChange={(event) => setGoogleAccessToken(event.currentTarget.value)}
                placeholder="ya29..."
                className="codex-input w-full rounded-lg px-3 py-2 text-xs outline-none"
              />
            </label>
            <label className="mb-2 block">
              <span className="codex-muted mb-1 block text-xs">
                Google Tasks Refresh Token (optional)
              </span>
              <input
                value={googleRefreshToken}
                onChange={(event) => setGoogleRefreshToken(event.currentTarget.value)}
                placeholder="1//..."
                className="codex-input w-full rounded-lg px-3 py-2 text-xs outline-none"
              />
            </label>
            <label className="mb-2 block">
              <span className="codex-muted mb-1 block text-xs">Google Tasks List ID</span>
              <input
                value={googleListId}
                onChange={(event) => setGoogleListId(event.currentTarget.value)}
                placeholder="@default or list id"
                className="codex-input w-full rounded-lg px-3 py-2 text-xs outline-none"
              />
            </label>
            <button
              type="button"
              disabled={busyAction.length > 0 || googleAccessToken.trim().length === 0 || googleListId.trim().length === 0}
              onClick={() =>
                void runTest(
                  "test-google",
                  () => testGoogleTasksConnection(googleAccessToken.trim(), googleListId.trim()),
                  "Google Tasks connection works.",
                )
              }
              className="codex-btn-soft mb-4 rounded-lg px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
              >
              Test Google Tasks
            </button>

            <label className="mb-2 block">
              <span className="codex-muted mb-1 block text-xs">Google Calendar ID</span>
              <input
                value={googleCalendarId}
                onChange={(event) => setGoogleCalendarId(event.currentTarget.value)}
                placeholder="primary or calendar id"
                className="codex-input w-full rounded-lg px-3 py-2 text-xs outline-none"
              />
            </label>
            <button
              type="button"
              disabled={busyAction.length > 0 || googleAccessToken.trim().length === 0 || googleCalendarId.trim().length === 0}
              onClick={() =>
                void runTest(
                  "test-google-calendar",
                  () => testGoogleCalendarConnection(googleAccessToken.trim(), googleCalendarId.trim()),
                  "Google Calendar connection works.",
                )
              }
              className="codex-btn-soft mb-4 rounded-lg px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
            >
              Test Google Calendar
            </button>

            <button
              type="button"
              disabled={busyAction.length > 0}
              onClick={() => void saveAdvancedIntegrations()}
              className="codex-btn rounded-lg px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            >
              Save Advanced Integration Settings
            </button>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busyAction.length > 0}
            onClick={() => void backfillUnsynced()}
            className="codex-btn-soft rounded-lg px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
          >
            Backfill Unsynced Captures
          </button>
        </div>
      </section>

      <section className="codex-surface rounded-xl p-4 text-xs">
        <p className="mb-2">Slack, Discord, Notion, and Google connect with one click via OAuth.</p>
        <p>Apple Notes and Reminders work natively on macOS — no setup or helper app required.</p>
      </section>
      </>
      ) : null}

      <div className="codex-muted mt-4 space-y-1 text-xs">
        <div>{status}</div>
        <div>{syncStatus}</div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            void invoke("hide_capture_window");
          }}
          className="codex-btn-soft rounded-lg px-3 py-2 text-xs"
        >
          Close settings
        </button>
        <button
          type="button"
          onClick={() => {
            void invoke("exit_app");
          }}
          className="codex-btn rounded-lg px-3 py-2 text-xs font-semibold"
        >
          Quit Chute
        </button>
      </div>
      <p className="codex-muted mt-2 text-[11px] leading-4">
        Chute runs in your system tray. Closing a window hides it. Use Quit to fully exit.
      </p>
    </div>
  );
}
