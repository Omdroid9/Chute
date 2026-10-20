import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { useCaptures } from "../../hooks/useCaptures";
import {
  loadIntegrationSettings,
  providerConfigured,
  type IntegrationSettings,
} from "../../lib/integrations/connectionStatus";
import {
  setCaptureListName,
  setCaptureSyncError,
  updateCapture,
  bootstrapDatabase,
} from "../../lib/db";
import type { Capture, CaptureLane, CaptureTag } from "../../types";
import LibrarySidebar, {
  type LibraryView,
  type SmartViewId,
} from "./LibrarySidebar";
import LibraryCaptureList from "./LibraryCaptureList";
import LibraryCaptureDetail from "./LibraryCaptureDetail";
import LibraryTopBar from "./LibraryTopBar";
import { isStoredToday, parseStoredTimestamp } from "../../lib/timestamps";
import { isMacOS } from "../../lib/platform";

function isWithinDay(iso: string, daysBack: number): boolean {
  const ts = parseStoredTimestamp(iso).getTime();
  if (!Number.isFinite(ts)) return false;
  const cutoff = Date.now() - daysBack * 24 * 60 * 60_000;
  return ts >= cutoff;
}

function isToday(iso: string): boolean {
  return isStoredToday(iso);
}

function hasFailedSync(capture: Capture): boolean {
  return Boolean(capture.last_sync_error && capture.last_sync_error.trim());
}

function needsReview(capture: Capture): boolean {
  return Boolean(capture.agent_needs_review);
}

export default function LibraryWindow() {
  const { captures, loading, refresh } = useCaptures(500);
  const [view, setView] = useState<LibraryView>({ kind: "smart", id: "all" });
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settings, setSettings] = useState<IntegrationSettings | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");

  useEffect(() => {
    void bootstrapDatabase().catch((error) => {
      console.error("Library bootstrapDatabase failed", error);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const next = await loadIntegrationSettings();
        if (!cancelled) setSettings(next);
      } catch (error) {
        console.error("Library integration settings load failed", error);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [captures.length]);

  const filtered = useMemo(() => {
    let rows = captures;
    if (view.kind === "list") {
      rows = rows.filter((c) => c.list_name === view.id);
    } else if (view.kind === "tag") {
      rows = rows.filter((c) => c.tag === view.id);
    } else {
      switch (view.id) {
        case "today":
          rows = rows.filter((c) => isToday(c.created_at));
          break;
        case "week":
          rows = rows.filter((c) => isWithinDay(c.created_at, 7));
          break;
        case "review":
          rows = rows.filter(needsReview);
          break;
        case "failed":
          rows = rows.filter(hasFailedSync);
          break;
        case "all":
        default:
          break;
      }
    }
    const query = search.trim().toLowerCase();
    if (query) {
      rows = rows.filter((c) => c.content.toLowerCase().includes(query));
    }
    return rows;
  }, [captures, view, search]);

  useEffect(() => {
    if (filtered.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !filtered.some((c) => c.id === selectedId)) {
      setSelectedId(filtered[0]!.id);
    }
  }, [filtered, selectedId]);

  const selected = useMemo(
    () => captures.find((c) => c.id === selectedId) ?? null,
    [captures, selectedId],
  );

  const lists = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of captures) {
      counts.set(c.list_name, (counts.get(c.list_name) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [captures]);

  const tagCounts = useMemo(() => {
    const counts = new Map<CaptureTag, number>();
    for (const c of captures) {
      counts.set(c.tag, (counts.get(c.tag) ?? 0) + 1);
    }
    return counts;
  }, [captures]);

  const smartCounts = useMemo<Record<SmartViewId, number>>(() => {
    let today = 0;
    let week = 0;
    let review = 0;
    let failed = 0;
    for (const c of captures) {
      if (isToday(c.created_at)) today += 1;
      if (isWithinDay(c.created_at, 7)) week += 1;
      if (needsReview(c)) review += 1;
      if (hasFailedSync(c)) failed += 1;
    }
    return { all: captures.length, today, week, review, failed };
  }, [captures]);

  const failedCount = smartCounts.failed;
  const reviewCount = smartCounts.review;
  const autoRoutedShare = useMemo(() => {
    const weekRows = captures.filter((c) => isWithinDay(c.created_at, 7));
    if (weekRows.length === 0) return null;
    const auto = weekRows.filter(
      (c) =>
        (c.agent_intent ?? "").trim().length > 0 &&
        !c.agent_needs_review &&
        c.agent_status !== "queued",
    );
    return Math.round((auto.length / weekRows.length) * 100);
  }, [captures]);

  async function handleQuickCapture() {
    try {
      await invoke("show_capture_window");
    } catch (error) {
      console.error("Could not open capture window", error);
    }
  }

  async function handleRetry(capture: Capture) {
    setActionBusy(`retry:${capture.id}`);
    try {
      await setCaptureSyncError(capture.id, null);
      await updateCapture({
        id: capture.id,
        content: capture.content,
        tag: capture.tag as CaptureTag,
        lane: capture.capture_lane as CaptureLane,
        listName: capture.list_name,
        destinations: {
          slack: Boolean(capture.target_slack),
          discord: Boolean(capture.target_discord),
          notion: Boolean(capture.target_notion),
          googleTasks: Boolean(capture.target_google_tasks),
          googleCalendar: Boolean(capture.target_google_calendar),
          appleReminders: Boolean(capture.target_apple_reminders),
          reminders: Boolean(capture.target_reminders),
          appleCalendar: Boolean(capture.target_apple_calendar),
        },
        reminderTime: capture.reminder_time,
        recurrenceRule: capture.recurrence_rule,
      });
      await emit("chute://request-sync");
      setStatusMessage("Retrying sync.");
      void refresh();
    } catch (error) {
      console.error("Retry failed", error);
      setStatusMessage("Could not retry sync.");
    } finally {
      setActionBusy(null);
    }
  }

  async function handleReassignList(capture: Capture, list: string) {
    setActionBusy(`list:${capture.id}`);
    try {
      await setCaptureListName(capture.id, list);
      await emit("chute://request-sync");
      setStatusMessage(`Moved to ${list}.`);
      void refresh();
    } catch (error) {
      console.error("Reassign failed", error);
      setStatusMessage("Could not move capture.");
    } finally {
      setActionBusy(null);
    }
  }

  const integrations = useMemo(() => {
    if (!settings) return [];
    // Apple's apps need no setup on a Mac; they were missing from this list.
    const apple = isMacOS()
      ? [
          { id: "reminders", label: "Reminders", connected: true },
          { id: "apple_calendar", label: "Calendar", connected: true },
          { id: "apple_notes", label: "Notes", connected: true },
        ]
      : [];
    return [
      ...apple,
      { id: "slack", label: "Slack", connected: providerConfigured("slack", settings) },
      { id: "notion", label: "Notion", connected: providerConfigured("notion", settings) },
      { id: "google", label: "Google", connected: providerConfigured("google", settings) },
      {
        id: "discord",
        label: "Discord",
        connected: providerConfigured("discord", settings),
      },
    ];
  }, [settings]);

  return (
    <div className="library-shell">
      <LibraryTopBar
        search={search}
        onSearch={setSearch}
        statusMessage={statusMessage}
        onClearStatus={() => setStatusMessage("")}
        onQuickCapture={() => void handleQuickCapture()}
        onOpenSettings={() => void invoke("open_settings_window")}
        smartCounts={smartCounts}
        autoRoutedShare={autoRoutedShare}
        failedCount={failedCount}
        reviewCount={reviewCount}
      />

      <div className="library-body">
        <LibrarySidebar
          view={view}
          onView={setView}
          smartCounts={smartCounts}
          lists={lists}
          tagCounts={tagCounts}
          integrations={integrations}
        />

        <LibraryCaptureList
          captures={filtered}
          loading={loading}
          selectedId={selectedId}
          onSelect={setSelectedId}
          view={view}
          totalCount={captures.length}
        />

        <LibraryCaptureDetail
          capture={selected}
          lists={lists}
          actionBusy={actionBusy}
          onRetry={handleRetry}
          onReassignList={handleReassignList}
          onOpenSettings={() => void invoke("open_settings_window")}
        />
      </div>
    </div>
  );
}
