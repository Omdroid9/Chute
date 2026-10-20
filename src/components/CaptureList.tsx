import { useCallback, useEffect, useMemo, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import {
  clearCaptureRecurrence,
  createManagedList,
  deleteManagedList,
  listManagedLists,
  renameManagedList,
  setSetting,
  updateCapture,
} from "../lib/db";
import { approveAgentSuggestion, dismissAgentSuggestion } from "../lib/agent/agentEngine";
import { useCaptures } from "../hooks/useCaptures";
import { parseReminderSyntax } from "../lib/parser";
import { recurrenceLabelFromRule } from "../lib/recurrence";
import { useAppStore } from "../store/useAppStore";
import type { Capture, CaptureDestinations, CaptureLane, CaptureTag } from "../types";

const TAG_OPTIONS: CaptureTag[] = ["untagged", "work", "personal", "idea"];
const DEFAULT_LIST = "Inbox";
const DISTRACTION_LIST = "Parking Lot";
const IS_MACOS = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);

type LaneFilter = "all" | CaptureLane;

function normalizeListName(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : DEFAULT_LIST;
}

function listKey(value: string | null | undefined): string {
  return normalizeListName(value).toLowerCase();
}

function normalizeLane(value: CaptureLane | string | null | undefined): CaptureLane {
  return value === "distraction" ? "distraction" : "focus";
}

function isDefaultList(value: string): boolean {
  return normalizeListName(value).toLowerCase() === DEFAULT_LIST.toLowerCase();
}

function sortListNames(values: Iterable<string>): string[] {
  const canonical = new Map<string, string>();
  for (const raw of values) {
    const name = normalizeListName(raw);
    const key = listKey(name);
    if (!canonical.has(key)) {
      canonical.set(key, name);
    }
  }
  const names = Array.from(canonical.values());
  return names.sort((a, b) => {
    if (isDefaultList(a) && !isDefaultList(b)) return -1;
    if (!isDefaultList(a) && isDefaultList(b)) return 1;
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  });
}

function captureDestinations(capture: Capture): CaptureDestinations {
  return {
    slack: capture.target_slack === 1,
    discord: capture.target_discord === 1,
    notion: capture.target_notion === 1,
    googleTasks: capture.target_google_tasks === 1,
    googleCalendar: capture.target_google_calendar === 1,
    appleReminders: capture.target_apple_reminders === 1,
    reminders: capture.target_reminders === 1,
    appleCalendar: capture.target_apple_calendar === 1,
  };
}

function enabledDestinationLabels(destinations: CaptureDestinations): string {
  const labels: string[] = [];
  if (destinations.slack) labels.push("Slack");
  if (destinations.discord) labels.push("Discord");
  if (destinations.notion) labels.push("Notion");
  if (destinations.googleTasks) labels.push("Google Tasks");
  if (destinations.googleCalendar) labels.push("Google Calendar");
  if (destinations.appleReminders) labels.push("Apple Notes");
  if (destinations.reminders) labels.push("Reminders");
  if (destinations.appleCalendar) labels.push("Apple Calendar");
  return labels.length > 0 ? labels.join(", ") : "None";
}

function toTitleCase(value: string | null | undefined): string {
  const normalized = (value ?? "").trim();
  if (!normalized) {
    return "N/A";
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

type IconProps = { size?: number };

function svgProps(size: number) {
  return {
    viewBox: "0 0 24 24",
    width: size,
    height: size,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
}

const IconSearch = ({ size = 16 }: IconProps) => (
  <svg {...svgProps(size)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

const IconSun = ({ size = 16 }: IconProps) => (
  <svg {...svgProps(size)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </svg>
);

const IconMoon = ({ size = 16 }: IconProps) => (
  <svg {...svgProps(size)}>
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

const IconRefresh = ({ size = 16 }: IconProps) => (
  <svg {...svgProps(size)}>
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    <path d="M3 21v-5h5" />
  </svg>
);

const IconBack = ({ size = 16 }: IconProps) => (
  <svg {...svgProps(size)}>
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </svg>
);

interface CaptureListProps {
  onBack?: () => void;
}

export default function CaptureList({ onBack }: CaptureListProps) {
  const { captures, loading, refresh } = useCaptures();
  const { theme, setTheme } = useAppStore();
  const [status, setStatus] = useState("");
  const [agentBusyId, setAgentBusyId] = useState<string | null>(null);
  const [stoppingRecurrenceId, setStoppingRecurrenceId] = useState<string | null>(null);
  const [managedLists, setManagedLists] = useState<string[]>([DEFAULT_LIST, DISTRACTION_LIST]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftContent, setDraftContent] = useState("");
  const [draftTag, setDraftTag] = useState<CaptureTag>("untagged");
  const [draftLane, setDraftLane] = useState<CaptureLane>("focus");
  const [draftList, setDraftList] = useState(DEFAULT_LIST);
  const [draftDestinations, setDraftDestinations] = useState<CaptureDestinations>({
    slack: false,
    discord: false,
    notion: false,
    googleTasks: false,
    googleCalendar: false,
    appleReminders: false,
    reminders: false,
    appleCalendar: false,
  });
  const [draftReminderTime, setDraftReminderTime] = useState<string | null>(null);
  const [draftRecurrenceRule, setDraftRecurrenceRule] = useState<string | null>(null);
  const [listFilter, setListFilter] = useState("all");
  const [laneFilter, setLaneFilter] = useState<LaneFilter>("all");
  const [reviewOnly, setReviewOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [newListName, setNewListName] = useState("");
  const [renamingList, setRenamingList] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const refreshManagedLists = useCallback(async () => {
    try {
      const names = await listManagedLists();
      const nextNames = names.length > 0 ? names : [DEFAULT_LIST];
      if (!nextNames.includes(DISTRACTION_LIST)) {
        nextNames.push(DISTRACTION_LIST);
      }
      setManagedLists(nextNames);
    } catch (error) {
      console.error("Failed to load managed lists", error);
      setManagedLists([DEFAULT_LIST, DISTRACTION_LIST]);
    }
  }, []);

  useEffect(() => {
    void refreshManagedLists();
  }, [refreshManagedLists]);

  async function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    await setSetting("theme", nextTheme);
  }

  const availableLists = useMemo(() => {
    const names = new Set<string>();
    for (const name of managedLists) {
      names.add(normalizeListName(name));
    }
    for (const capture of captures) {
      names.add(normalizeListName(capture.list_name));
    }
    names.add(DEFAULT_LIST);
    names.add(DISTRACTION_LIST);
    return ["all", ...sortListNames(names)];
  }, [captures, managedLists]);

  const effectiveListFilter = availableLists.includes(listFilter) ? listFilter : "all";

  const listCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const capture of captures) {
      const key = listKey(capture.list_name);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [captures]);

  const filteredCaptures = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return captures.filter((capture) => {
      if (effectiveListFilter !== "all" && listKey(capture.list_name) !== listKey(effectiveListFilter)) {
        return false;
      }
      if (laneFilter !== "all" && normalizeLane(capture.capture_lane) !== laneFilter) {
        return false;
      }
      if (reviewOnly && capture.agent_needs_review !== 1) {
        return false;
      }
      if (needle && !capture.content.toLowerCase().includes(needle)) {
        return false;
      }
      return true;
    });
  }, [captures, effectiveListFilter, laneFilter, reviewOnly, query]);

  const reviewCount = useMemo(
    () => captures.filter((capture) => capture.agent_needs_review === 1).length,
    [captures],
  );

  function startEditing(capture: Capture) {
    setEditingId(capture.id);
    setDraftContent(capture.content);
    setDraftTag(capture.tag);
    setDraftLane(normalizeLane(capture.capture_lane));
    setDraftList(normalizeListName(capture.list_name));
    setDraftDestinations(captureDestinations(capture));
    setDraftReminderTime(capture.reminder_time);
    setDraftRecurrenceRule(capture.recurrence_rule);
    setStatus("");
  }

  function stopEditing() {
    setEditingId(null);
    setDraftReminderTime(null);
    setDraftRecurrenceRule(null);
  }

  function toggleDestination(key: keyof CaptureDestinations) {
    setDraftDestinations((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function onDraftLaneChange(nextLane: CaptureLane) {
    setDraftLane(nextLane);
    setDraftList((prev) => {
      const normalized = normalizeListName(prev);
      if (nextLane === "distraction" && normalized.toLowerCase() === DEFAULT_LIST.toLowerCase()) {
        return DISTRACTION_LIST;
      }
      if (nextLane === "focus" && normalized.toLowerCase() === DISTRACTION_LIST.toLowerCase()) {
        return DEFAULT_LIST;
      }
      return prev;
    });
  }

  async function saveEdit() {
    if (!editingId) {
      return;
    }

    const parsed = parseReminderSyntax(draftContent);
    const cleanedContent = parsed.cleanedContent.trim();
    if (!cleanedContent) {
      setStatus("Note content cannot be empty.");
      return;
    }

    try {
      await updateCapture({
        id: editingId,
        content: cleanedContent,
        tag: draftTag,
        lane: draftLane,
        listName: normalizeListName(draftList),
        destinations: draftDestinations,
        reminderTime: parsed.reminderTime ?? draftReminderTime,
        recurrenceRule: parsed.recurrenceRule ?? draftRecurrenceRule,
      });

      await refresh();
      await refreshManagedLists();
      setEditingId(null);
      setDraftReminderTime(null);
      setDraftRecurrenceRule(null);
      setStatus("Note updated.");
      await emit("chute://request-sync");
      await emit("chute://request-agent");
    } catch (error) {
      console.error(error);
      setStatus(`Update failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function stopRepeating(capture: Capture) {
    if (!capture.recurrence_rule) {
      return;
    }

    setStoppingRecurrenceId(capture.id);
    setStatus("");
    try {
      await clearCaptureRecurrence(capture.id);
      await refresh();
      setStatus("Repeat stopped. Chute will not create more reminders for that item.");
      await emit("chute://captures-changed");
    } catch (error) {
      console.error(error);
      setStatus(`Could not stop repeat: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setStoppingRecurrenceId(null);
    }
  }

  async function addManagedList() {
    const normalized = normalizeListName(newListName);
    try {
      await createManagedList(normalized);
      setNewListName("");
      await refreshManagedLists();
      setStatus(`List "${normalized}" saved.`);
    } catch (error) {
      console.error(error);
      setStatus(`Failed to add list: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function beginRenameList(name: string) {
    if (isDefaultList(name)) {
      return;
    }
    setRenamingList(name);
    setRenameDraft(name);
  }

  async function saveRenameList() {
    if (!renamingList) {
      return;
    }

    const previous = renamingList;
    const next = normalizeListName(renameDraft);

    try {
      const renamedTo = await renameManagedList(previous, next);
      await Promise.all([refresh(), refreshManagedLists()]);
      if (listFilter !== "all" && listKey(listFilter) === listKey(previous)) {
        setListFilter(renamedTo);
      }
      setRenamingList(null);
      setRenameDraft("");
      setStatus(`List renamed to "${renamedTo}".`);
      await emit("chute://request-sync");
    } catch (error) {
      console.error(error);
      setStatus(`Rename failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function removeManagedList(name: string) {
    if (isDefaultList(name)) {
      setStatus("Inbox cannot be deleted.");
      return;
    }

    const confirmed = window.confirm(
      `Delete "${name}"? Existing notes will be moved to ${DEFAULT_LIST}.`,
    );
    if (!confirmed) {
      return;
    }

    try {
      await deleteManagedList(name);
      await Promise.all([refresh(), refreshManagedLists()]);
      if (listFilter !== "all" && listKey(listFilter) === listKey(name)) {
        setListFilter("all");
      }
      setStatus(`List "${name}" deleted and notes moved to ${DEFAULT_LIST}.`);
      await emit("chute://request-sync");
    } catch (error) {
      console.error(error);
      setStatus(`Delete failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function handleApproveAgent(captureId: string) {
    setAgentBusyId(captureId);
    setStatus("");
    try {
      await approveAgentSuggestion(captureId);
      await refresh();
      await emit("chute://request-sync");
      setStatus("Agent suggestion approved.");
    } catch (error) {
      console.error(error);
      setStatus(`Approve failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setAgentBusyId(null);
    }
  }

  async function handleDismissAgent(captureId: string) {
    setAgentBusyId(captureId);
    setStatus("");
    try {
      await dismissAgentSuggestion(captureId);
      await refresh();
      setStatus("Agent suggestion dismissed.");
    } catch (error) {
      console.error(error);
      setStatus(`Dismiss failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setAgentBusyId(null);
    }
  }

  return (
    <div className="capture-overlay h-full w-full overflow-hidden p-3" data-tauri-drag-region>
      <div className="capture-shell relative h-full w-full shadow-floating">
        <div className="h-full w-full overflow-y-auto p-5">
          <div className="mx-auto max-w-4xl">
        <div className="codex-surface mb-4 rounded-2xl p-4">
          <div className="mb-3 flex items-center justify-between gap-3" data-tauri-drag-region>
            <div className="pointer-events-none flex items-center gap-2.5">
              <h1 className="codex-panel-title text-[1.4rem] font-medium leading-none">
                Capture <span className="font-serif-italic">History</span>
              </h1>
              <span className="meta-chip">{filteredCaptures.length}</span>
            </div>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => void toggleTheme()}
                className="icon-btn"
                title={theme === "dark" ? "Switch to light" : "Switch to dark"}
                aria-label="Toggle theme"
              >
                {theme === "dark" ? <IconSun /> : <IconMoon />}
              </button>
              <button
                type="button"
                onClick={() => void refresh()}
                className="icon-btn"
                title="Refresh"
                aria-label="Refresh"
              >
                <IconRefresh />
              </button>
              {onBack ? (
                <button
                  type="button"
                  onClick={onBack}
                  className="icon-btn"
                  title="Back"
                  aria-label="Back"
                >
                  <IconBack />
                </button>
              ) : null}
            </div>
          </div>

          <label className="search-field mb-3">
            <span className="text-[var(--muted)]">
              <IconSearch />
            </span>
            <input
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search captures…"
              type="search"
              aria-label="Search captures"
            />
            {query ? <span className="kbd">{filteredCaptures.length}</span> : null}
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={effectiveListFilter}
              onChange={(event) => setListFilter(event.currentTarget.value)}
              className="codex-input rounded-lg px-2 py-1.5 text-xs"
            >
              {availableLists.map((name) => (
                <option key={name} value={name}>
                  {name === "all" ? "All lists" : name}
                </option>
              ))}
            </select>
            <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--btn-soft)] p-1 text-xs">
              {([
                ["all", "All"],
                ["focus", "Focus"],
                ["distraction", "Distraction"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setLaneFilter(value)}
                  className={[
                    "rounded-md px-2 py-1",
                    laneFilter === value ? "codex-btn" : "codex-muted hover:bg-[var(--btn-soft-hover)]",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setReviewOnly((value) => !value)}
              className={[
                "rounded-lg border px-2.5 py-1.5 text-xs",
                reviewOnly ? "codex-chip-active" : "codex-chip",
              ].join(" ")}
            >
              Review Queue ({reviewCount})
            </button>
          </div>
          {status ? <p className="codex-muted mt-3 text-xs">{status}</p> : null}
        </div>

        {loading ? <p className="codex-muted mb-3 text-sm">Loading...</p> : null}

        <section className="codex-surface mb-4 rounded-2xl p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="label-micro">Lists</h2>
            <span className="codex-muted text-[11px]">{managedLists.length} saved</span>
          </div>

          <div className="mb-3 flex items-center gap-2">
            <input
              value={newListName}
              onChange={(event) => setNewListName(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void addManagedList();
                }
              }}
              placeholder="Create a list"
              className="codex-input w-full rounded-lg px-2 py-1.5 text-xs outline-none"
            />
            <button
              type="button"
              onClick={() => void addManagedList()}
              className="codex-btn-soft rounded-lg px-3 py-1.5 text-xs"
            >
              Add
            </button>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {sortListNames(managedLists).map((name) => {
              const isRenaming = renamingList === name;
              const isInbox = isDefaultList(name);
              return (
                <div key={name} className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2 py-2 text-xs">
                  {isRenaming ? (
                    <div className="flex items-center gap-2">
                      <input
                        value={renameDraft}
                        onChange={(event) => setRenameDraft(event.currentTarget.value)}
                        className="codex-input w-full rounded-md px-2 py-1 text-xs outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => void saveRenameList()}
                        className="codex-btn-soft rounded-md px-2 py-1 text-[11px]"
                      >
                        Save
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span>{name}</span>
                        <span className="rounded bg-[var(--btn-soft)] px-1.5 py-0.5 text-[10px] codex-muted">
                          {listCounts.get(listKey(name)) ?? 0}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={isInbox}
                          onClick={() => beginRenameList(name)}
                          className={[
                            "rounded-md border px-2 py-0.5 text-[11px]",
                            isInbox ? "cursor-not-allowed opacity-45 border-[var(--border)] codex-muted" : "codex-chip",
                          ].join(" ")}
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          disabled={isInbox}
                          onClick={() => void removeManagedList(name)}
                          className={[
                            "rounded-md border px-2 py-0.5 text-[11px]",
                            isInbox ? "cursor-not-allowed opacity-45 border-[var(--border)] codex-muted" : "border-red-400/40 text-red-500 hover:bg-red-500/10",
                          ].join(" ")}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {!loading && filteredCaptures.length === 0 ? (
          <div className="codex-surface flex flex-col items-center justify-center rounded-2xl px-6 py-14 text-center">
            <div className="empty-float mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] text-[var(--accent)]">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M22 12h-6l-2 3h-4l-2-3H2" />
                <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
              </svg>
            </div>
            {captures.length === 0 ? (
              <>
                <p className="font-display text-base font-semibold">No captures yet</p>
                <p className="codex-muted mt-1.5 max-w-sm text-xs leading-5">
                  Press your global shortcut anywhere to jot a thought. Try something like
                  <span className="text-[var(--text)]"> “call mom tomorrow 5pm” </span>
                  — Chute parses the reminder for you.
                </p>
              </>
            ) : (
              <>
                <p className="font-display text-base font-semibold">
                  {query ? "No matches" : "Nothing matches these filters"}
                </p>
                <p className="codex-muted mt-1.5 max-w-sm text-xs leading-5">
                  {query
                    ? `No captures contain “${query}”. Try a different search.`
                    : "Try a different list or lane, or turn off the Review Queue toggle."}
                </p>
              </>
            )}
          </div>
        ) : null}

        <div className="space-y-2">
          {filteredCaptures.map((capture) => {
            const editing = editingId === capture.id;
            const destinations = captureDestinations(capture);
            const lane = normalizeLane(capture.capture_lane);
            const recurrenceLabel = recurrenceLabelFromRule(capture.recurrence_rule);

            return (
              <article
                key={capture.id}
                className="cmd-row p-3.5 text-sm"
              >
                {!editing ? (
                  <>
                    <div className="mb-2.5 whitespace-pre-wrap leading-6">{capture.content}</div>
                    <div className="mb-2 flex flex-wrap items-center gap-1.5">
                      <span className="meta-chip">{normalizeListName(capture.list_name)}</span>
                      <span className="meta-chip uppercase">{capture.tag}</span>
                      <span className="meta-chip uppercase">{lane}</span>
                      {recurrenceLabel ? <span className="meta-chip">{recurrenceLabel}</span> : null}
                      {recurrenceLabel ? (
                        <button
                          type="button"
                          disabled={stoppingRecurrenceId === capture.id}
                          onClick={() => void stopRepeating(capture)}
                          className="rounded-full border border-red-400/40 px-2 py-0.5 text-[11px] font-medium text-red-500 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {stoppingRecurrenceId === capture.id ? "Stopping..." : "Stop repeating"}
                        </button>
                      ) : null}
                      <time
                        dateTime={new Date(capture.created_at).toISOString()}
                        className="text-[11px] codex-muted font-mono"
                      >
                        {new Date(capture.created_at).toLocaleString()}
                      </time>
                    </div>
                    <div className="mb-2 text-[11px] codex-muted">
                      Destinations: {enabledDestinationLabels(destinations)}
                      {capture.routing_reason ? (
                        <span title={`Routing: ${capture.routing_source ?? "unknown"}`}>
                          {" "}· Why: {capture.routing_reason}
                        </span>
                      ) : null}
                    </div>
                    <div className="mb-2 flex flex-wrap items-center gap-1.5">
                      <span className="meta-chip">Agent: {toTitleCase(capture.agent_status)}</span>
                      <span className="meta-chip">Intent: {toTitleCase(capture.agent_intent)}</span>
                      <span className="meta-chip">
                        Confidence:{" "}
                        {capture.agent_confidence != null ? `${Math.round(capture.agent_confidence * 100)}%` : "N/A"}
                      </span>
                    </div>
                    {capture.agent_error ? (
                      <div className="mb-2 text-[11px] text-red-200/80">Agent error: {capture.agent_error}</div>
                    ) : null}
                    {capture.last_sync_error ? (
                      <div className="mb-2 rounded border border-red-400/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-500">
                        Sync error: {capture.last_sync_error}
                      </div>
                    ) : null}
                    {capture.agent_needs_review === 1 ? (
                      <div className="mb-2 flex items-center gap-2">
                        <button
                          type="button"
                          disabled={agentBusyId === capture.id}
                          onClick={() => void handleApproveAgent(capture.id)}
                          className="codex-btn rounded-lg px-2 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Approve Suggestion
                        </button>
                        <button
                          type="button"
                          disabled={agentBusyId === capture.id}
                          onClick={() => void handleDismissAgent(capture.id)}
                          className="codex-btn-soft rounded-lg px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Dismiss
                        </button>
                      </div>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => startEditing(capture)}
                      className="codex-btn-soft rounded-lg px-2 py-1 text-xs"
                    >
                      Edit
                    </button>
                  </>
                ) : (
                  <div className="space-y-2">
                    <textarea
                      value={draftContent}
                      onChange={(event) => setDraftContent(event.currentTarget.value)}
                      rows={3}
                      className="codex-input w-full rounded-lg p-2 text-sm outline-none"
                    />

                    <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--btn-soft)] p-1 text-xs">
                      {([
                        ["focus", "Focus"],
                        ["distraction", "Distraction"],
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => onDraftLaneChange(value)}
                          className={[
                            "rounded-md px-2 py-1",
                            draftLane === value ? "codex-btn" : "codex-muted hover:bg-[var(--btn-soft-hover)]",
                          ].join(" ")}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <input
                        value={draftList}
                        list="chute-history-lists"
                        onChange={(event) => setDraftList(event.currentTarget.value)}
                        placeholder="List name"
                        className="codex-input w-full rounded-lg px-2 py-1.5 text-xs outline-none"
                      />
                      <datalist id="chute-history-lists">
                        {sortListNames(managedLists).map((name) => (
                          <option key={name} value={name} />
                        ))}
                      </datalist>
                      <select
                        value={draftTag}
                        onChange={(event) => setDraftTag(event.currentTarget.value as CaptureTag)}
                        className="codex-input w-full rounded-lg px-2 py-1.5 text-xs outline-none"
                      >
                        {TAG_OPTIONS.map((tag) => (
                          <option key={tag} value={tag}>
                            {tag}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-wrap gap-1.5 text-[11px]">
                      {(
                        [
                          ["slack", "Slack"],
                          ["discord", "Discord"],
                          ["notion", "Notion"],
                          ["googleTasks", "GTasks"],
                          ["googleCalendar", "GCal"],
                          ["appleReminders", "Apple Notes"],
                          ["reminders", "Reminders"],
                        ] as const
                      ).map(([key, label]) => {
                        const isDisabled = (key === "appleReminders" || key === "reminders") && !IS_MACOS;
                        const active = draftDestinations[key];
                        return (
                          <button
                            key={key}
                            type="button"
                            disabled={isDisabled}
                            title={isDisabled ? `${label} sync is available on macOS.` : label}
                            onClick={() => toggleDestination(key)}
                            className={[
                              "rounded-full border px-2 py-0.5",
                              active ? "codex-chip-active" : "codex-chip",
                              isDisabled
                                ? "cursor-not-allowed opacity-45"
                                : "",
                            ].join(" ")}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void saveEdit()}
                        className="codex-btn rounded-lg px-3 py-1.5 text-xs font-semibold"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={stopEditing}
                        className="codex-btn-soft rounded-lg px-3 py-1.5 text-xs"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
