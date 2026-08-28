import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { parseReminderSyntax } from "../lib/parser";
import { continueListOnNewline } from "../lib/listContinuation";
import { parseTimer, formatCountdown } from "../lib/timer";
import { useAutoUpdater } from "../lib/updater";
import {
  createManagedList,
  createRoutingRule,
  deleteCapture,
  getCapturesTodayCount,
  getDailyRecapStats,
  getSetting,
  getTotalCaptureCount,
  insertCapture,
  listCaptures,
  listManagedLists,
  listRoutingRules,
  recordRoutingRuleHit,
  setSetting,
  type DailyRecapStats,
} from "../lib/db";
import { loadIntegrationSettings } from "../lib/integrations/connectionStatus";
import {
  availableDestinations,
  describeRuleCondition,
  destinationNames,
  evaluateRouting,
  hasActiveDestination,
  hasAnyProviderConfigured,
  sameDestinations,
} from "../lib/integrations/captureRouting";
import { isMacOS } from "../lib/platform";
import { noteContentFromSplit, splitCaptureLines } from "../lib/splitCapture";
import { recurrenceLabelFromRule } from "../lib/recurrence";
import { useAppStore } from "../store/useAppStore";
import TagChip from "./TagChip";
import ListPicker from "./ListPicker";
import CaptureProductTour from "./CaptureProductTour";
import CaptureDestinationPrompt from "./CaptureDestinationPrompt";
import ChuteLogo from "./ChuteLogo";
import type {
  Capture,
  CaptureDestinations,
  CaptureLane,
  CaptureTag,
  RoutingRule,
  RoutingRuleField,
} from "../types";

const MAX_CHARS = 2000;
const CHAR_COUNTER_THRESHOLD = 100;
const RECENT_LIMIT = 20;
const HINT_GRADUATION_CAPTURES = 20;
const UNDO_WINDOW_MS = 60_000;
const SYNC_GRACE_MS = 5_000;
const WINDOW_HEIGHT_COMPACT = 250;
const WINDOW_HEIGHT_EXPANDED = 520;
// Matches CAPTURE_HEIGHT_MAX on the Rust side; content-driven growth stops here.
const WINDOW_HEIGHT_MAX = 760;
const DEFAULT_LIST = "Inbox";
const DISTRACTION_LIST = "Parking Lot";
const DRAFT_SETTING_KEY = "capture_draft";

interface CaptureDraft {
  text: string;
  captureLane: CaptureLane;
  listName: string;
  destinations: CaptureDestinations;
  destinationsTouched?: boolean;
  tag: CaptureTag;
  manualReminderTime: string | null;
}
const IS_MACOS = isMacOS();
const RECAP_SETTING_KEY = "daily_recap_shown";

function localDateKey(input = new Date()): string {
  const timezoneOffset = input.getTimezoneOffset() * 60_000;
  return new Date(input.getTime() - timezoneOffset).toISOString().slice(0, 10);
}

function recapGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

const DEFAULT_DESTINATIONS: CaptureDestinations = {
  slack: false,
  discord: false,
  notion: false,
  googleTasks: false,
  googleCalendar: false,
  appleReminders: false,
  reminders: false,
  appleCalendar: false,
};

type DestinationKey = keyof CaptureDestinations;

const TARGET_META: Array<{
  key: DestinationKey;
  label: string;
  available: boolean;
}> = [
  { key: "slack", label: "Slack", available: true },
  { key: "discord", label: "Discord", available: true },
  { key: "notion", label: "Notion", available: true },
  { key: "googleTasks", label: "GTasks", available: true },
  { key: "googleCalendar", label: "GCal", available: true },
  { key: "appleReminders", label: "Apple Notes", available: IS_MACOS },
  { key: "reminders", label: "Reminders", available: IS_MACOS },
  { key: "appleCalendar", label: "Apple Cal", available: IS_MACOS },
];

const DESTINATION_LABELS: Record<DestinationKey, string> = {
  slack: "Slack",
  discord: "Discord",
  notion: "Notion",
  googleTasks: "Google Tasks",
  googleCalendar: "Google Calendar",
  appleReminders: "Apple Notes",
  reminders: "Reminders",
  appleCalendar: "Apple Calendar",
};

const REMINDER_COMMAND_REGEX =
  /^\s*(?:please\s+)?(?:remind\s+me(?:\s+to)?|remember\s+to|set\s+(?:a\s+)?reminder\s+(?:to|for)|add\s+(?:a\s+)?reminder\s+(?:to|for))\s+/i;

function normalizeListName(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_LIST;
}

function toLocalIso(input: Date): string {
  const timezoneOffset = input.getTimezoneOffset() * 60_000;
  return new Date(input.getTime() - timezoneOffset).toISOString().slice(0, 19);
}

function formatReminderDisplay(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function firstLineTitle(value: string): string {
  const firstLine = value.split("\n")[0]?.trim() ?? "";
  return firstLine.length > 0 ? firstLine : value.trim();
}

function destinationLabels(value: CaptureDestinations): string[] {
  return (Object.keys(value) as DestinationKey[])
    .filter((key) => value[key])
    .map((key) => DESTINATION_LABELS[key]);
}

/** Drop any target that isn't actually reachable (unconnected cloud app, or an
 * Apple app off macOS) so a capture can never be sent somewhere it can't land. */
function onlyAvailableDestinations(
  selected: CaptureDestinations,
  available: CaptureDestinations,
): CaptureDestinations {
  const next = { ...selected };
  for (const key of Object.keys(next) as DestinationKey[]) {
    next[key] = next[key] && available[key];
  }
  return next;
}

function hasReminderCommand(value: string): boolean {
  return REMINDER_COMMAND_REGEX.test(value);
}

function currentLineBounds(value: string, cursor: number): { start: number; end: number; line: string } {
  const start = value.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1;
  const endCandidate = value.indexOf("\n", cursor);
  const end = endCandidate === -1 ? value.length : endCandidate;
  return {
    start,
    end,
    line: value.slice(start, end),
  };
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

const IconHistory = ({ size = 16 }: IconProps) => (
  <svg {...svgProps(size)}>
    <path d="M3 3v5h5" />
    <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
    <path d="M12 7v5l4 2" />
  </svg>
);

const IconBullet = ({ size = 16 }: IconProps) => (
  <svg {...svgProps(size)}>
    <path d="M8 6h13M8 12h13M8 18h13" />
    <circle cx="3.5" cy="6" r="1" fill="currentColor" stroke="none" />
    <circle cx="3.5" cy="12" r="1" fill="currentColor" stroke="none" />
    <circle cx="3.5" cy="18" r="1" fill="currentColor" stroke="none" />
  </svg>
);

const IconCheckbox = ({ size = 16 }: IconProps) => (
  <svg {...svgProps(size)}>
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <path d="M8 12l3 3 5-6" />
  </svg>
);

const IconNumbered = ({ size = 16 }: IconProps) => (
  <svg {...svgProps(size)}>
    <path d="M10 6h11M10 12h11M10 18h11" />
    <path d="M4 4v4M3.5 8h1.5M3 4.2c.4-.3 1.4-.3 1.4.5 0 .6-.9.9-1.4 1.5h1.6" />
  </svg>
);

const IconClose = ({ size = 16 }: IconProps) => (
  <svg {...svgProps(size)} strokeWidth={2}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

const IconSend = ({ size = 17 }: IconProps) => (
  <svg {...svgProps(size)} strokeWidth={2}>
    <path d="m22 2-7 20-4-9-9-4z" />
    <path d="M22 2 11 13" />
  </svg>
);

const CAPTURE_HINTS = [
  "Call mom tomorrow at 5pm",
  "Buy groceries after work",
  "Standup notes",
] as const;

const IconFolder = ({ size = 14 }: IconProps) => (
  <svg {...svgProps(size)}>
    <path d="M3 7a2 2 0 0 1 2-2h3l2 2h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

const IconBookmark = ({ size = 14 }: IconProps) => (
  <svg {...svgProps(size)}>
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </svg>
);

export default function CaptureWindow() {
  const { update, restartToUpdate } = useAutoUpdater();
  const [text, setText] = useState("");
  const [captureLane, setCaptureLane] = useState<CaptureLane>("focus");
  const [listName, setListName] = useState(DEFAULT_LIST);
  const [destinations, setDestinations] = useState<CaptureDestinations>(DEFAULT_DESTINATIONS);
  const [destinationsTouched, setDestinationsTouched] = useState(false);
  // "Keep together" opt-out for the automatic mixed-capture split.
  const [splitDisabled, setSplitDisabled] = useState(false);
  const [routingRules, setRoutingRules] = useState<RoutingRule[]>([]);
  const [teachDismissed, setTeachDismissed] = useState(false);
  const [recap, setRecap] = useState<DailyRecapStats | null>(null);
  const [totalCaptures, setTotalCaptures] = useState<number | null>(null);
  const [allConfirm, setAllConfirm] = useState(false);
  const [undoStrip, setUndoStrip] = useState<{ labels: string[] } | null>(null);
  const undoRef = useRef<{
    id: string;
    labels: string[];
    at: number;
    syncTimer: number;
    synced: boolean;
  } | null>(null);
  const allConfirmTimerRef = useRef<number | null>(null);

  const undoAvailable = useCallback(() => {
    const last = undoRef.current;
    return Boolean(last && Date.now() - last.at <= UNDO_WINDOW_MS);
  }, []);

  // Focus with the caret at the end so a restored draft continues where the
  // user left off instead of prepending at position 0.
  const focusInputAtEnd = useCallback(() => {
    requestAnimationFrame(() => {
      const field = inputRef.current;
      if (!field) {
        return;
      }
      field.focus();
      const end = field.value.length;
      field.setSelectionRange(end, end);
    });
  }, []);
  const [savedMessage, setSavedMessage] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Set by the keydown handler when double-Enter ends a list: the bullet
  // strip must commit to state before sending, so the send fires next render.
  const [pendingSend, setPendingSend] = useState(false);
  const [managedLists, setManagedLists] = useState<string[]>([DEFAULT_LIST, DISTRACTION_LIST]);
  const [recentCaptures, setRecentCaptures] = useState<Capture[]>([]);
  const [recentIndex, setRecentIndex] = useState<number | null>(null);
  const [manualReminderTime, setManualReminderTime] = useState<string | null>(null);
  const [pulse, setPulse] = useState(0);
  const [showProductTour, setShowProductTour] = useState(false);
  const [destinationPrompt, setDestinationPrompt] = useState<{
    keepOpen: boolean;
    destinations: CaptureDestinations;
  } | null>(null);
  const [integrationSettings, setIntegrationSettings] = useState<Awaited<
    ReturnType<typeof loadIntegrationSettings>
  > | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const hydratedRef = useRef(false);

  const { selectedTag, setSelectedTag, setCapturesToday, lastSyncLabel, theme, setTheme } =
    useAppStore();

  const parsed = useMemo(() => parseReminderSyntax(text), [text]);
  const effectiveReminderTime = manualReminderTime ?? parsed.reminderTime;
  const effectiveRecurrenceRule = parsed.recurrenceRule;
  const effectiveRecurrenceLabel =
    parsed.recurrenceLabel ?? recurrenceLabelFromRule(effectiveRecurrenceRule);
  const effectivePreviewLabel = useMemo(() => {
    if (!effectiveReminderTime) {
      return null;
    }
    const formatted = formatReminderDisplay(effectiveReminderTime);
    return manualReminderTime
      ? `${formatted} (manual)`
      : formatted;
  }, [effectiveReminderTime, manualReminderTime]);

  const quickReminderOptions = useMemo(() => {
    if (!parsed.reminderTime) {
      return [] as Array<{ label: string; value: string }>;
    }

    const base = new Date(parsed.reminderTime);
    const make = (label: string, hour: number, minute = 0) => {
      const next = new Date(base);
      next.setHours(hour, minute, 0, 0);
      return { label, value: toLocalIso(next) };
    };

    return [make("9 AM", 9), make("3 PM", 15), make("6 PM", 18)];
  }, [parsed.reminderTime]);
  const remaining = MAX_CHARS - text.length;
  const reminderCommand = hasReminderCommand(text);
  const previewContent = (parsed.cleanedContent.trim() || text.trim()).slice(0, MAX_CHARS);
  // A timer capture ("pomodoro", "timer for 25 min") preempts destination
  // routing — Chute runs the countdown itself.
  const timerPreview = parseTimer(text);

  // Where Chute *would* route this capture right now, and why. This is the
  // single decision the preview, the save path, and the teach prompt all share.
  const routingDecision = useMemo(() => {
    if (!integrationSettings) {
      return null;
    }
    return evaluateRouting({
      text,
      tag: selectedTag,
      lane: captureLane,
      listName: normalizeListName(listName),
      reminderTime: effectiveReminderTime,
      isReminderCommand: reminderCommand,
      settings: integrationSettings,
      rules: routingRules,
    });
  }, [
    captureLane,
    effectiveReminderTime,
    integrationSettings,
    listName,
    reminderCommand,
    routingRules,
    selectedTag,
    text,
  ]);

  // Mixed capture: some lines are actionable, some are prose. When active,
  // sending fans events out to Apple Calendar, actions to Reminders, and keeps
  // the prose as one Apple Note — no extra click. Manual destination picks or
  // "Keep together" turn it off for this draft.
  const captureSplit = useMemo(
    () => (IS_MACOS ? splitCaptureLines(text) : null),
    [text],
  );
  const splitActive = Boolean(captureSplit) && !splitDisabled && !destinationsTouched;

  const previewDestinations = useMemo(() => {
    if (destinationsTouched) {
      return destinations;
    }
    // In split mode the send bypasses `destinations` entirely and routes each
    // line itself, so the chips must mirror what the split will actually do —
    // otherwise they under-report and invite a manual toggle, which silently
    // switches the split off.
    if (splitActive && captureSplit) {
      return {
        ...DEFAULT_DESTINATIONS,
        appleCalendar: captureSplit.events.length > 0,
        reminders: captureSplit.reminders.length > 0,
        appleReminders: captureSplit.notes.length > 0,
      };
    }
    return routingDecision?.destinations ?? destinations;
  }, [captureSplit, destinations, destinationsTouched, routingDecision, splitActive]);
  const previewDestinationLabels = useMemo(
    () => destinationLabels(previewDestinations),
    [previewDestinations],
  );
  // What's actually reachable right now: cloud apps only once connected, Apple
  // apps only on macOS. Gates both the Send-to row and the save path.
  const liveAvailable = useMemo(
    () => (integrationSettings ? availableDestinations(integrationSettings) : null),
    [integrationSettings],
  );
  const previewPrimaryDestination = previewDestinationLabels[0] ?? "Local only";
  const previewTitle = firstLineTitle(previewContent);
  const previewLineCount = previewContent
    .split("\n")
    .filter((line) => line.trim().length > 0).length;
  const previewReason = destinationsTouched
    ? "You chose these"
    : routingDecision?.reason ?? "Ready to capture";

  // One-tap correction for the intent guess. Flipping counts as a manual
  // choice, so the teach prompt can offer to make the correction permanent.
  const intentFlip = useMemo(() => {
    if (destinationsTouched || !routingDecision) {
      return null;
    }
    if (routingDecision.source === "intent-task") {
      return {
        label: "Not a to-do?",
        apply: () => {
          setDestinations({
            ...routingDecision.destinations,
            reminders: false,
            googleTasks: false,
            appleReminders: IS_MACOS,
          });
          setDestinationsTouched(true);
        },
      };
    }
    if (routingDecision.source === "event-apple-calendar") {
      return {
        label: "Not an event?",
        apply: () => {
          setDestinations({
            ...routingDecision.destinations,
            appleCalendar: false,
            reminders: IS_MACOS,
          });
          setDestinationsTouched(true);
        },
      };
    }
    if (routingDecision.source === "time-reminders") {
      return {
        label: "Make it an event?",
        apply: () => {
          setDestinations({
            ...routingDecision.destinations,
            reminders: false,
            appleCalendar: IS_MACOS,
            googleCalendar: !IS_MACOS,
          });
          setDestinationsTouched(true);
        },
      };
    }
    if (routingDecision.source === "intent-note") {
      return {
        label: "Make it a to-do",
        apply: () => {
          setDestinations({
            ...routingDecision.destinations,
            appleReminders: false,
            reminders: true,
          });
          setDestinationsTouched(true);
        },
      };
    }
    return null;
  }, [destinationsTouched, routingDecision]);

  // Teach prompt: the user has corrected the suggestion, and the capture has a
  // signal (tag, list, lane) we could turn into a permanent rule.
  const teachSignal = useMemo((): { field: RoutingRuleField; value: string } | null => {
    if (selectedTag !== "untagged") {
      return { field: "tag", value: selectedTag };
    }
    const normalizedList = normalizeListName(listName);
    if (normalizedList.toLowerCase() !== DEFAULT_LIST.toLowerCase()) {
      return { field: "list", value: normalizedList };
    }
    if (captureLane === "distraction") {
      return { field: "lane", value: "distraction" };
    }
    return null;
  }, [captureLane, listName, selectedTag]);

  const teachOffer = useMemo(() => {
    if (
      !destinationsTouched ||
      teachDismissed ||
      !teachSignal ||
      !routingDecision ||
      text.trim().length === 0 ||
      !hasActiveDestination(destinations) ||
      sameDestinations(destinations, routingDecision.destinations)
    ) {
      return null;
    }
    return {
      ...teachSignal,
      label: describeRuleCondition({ field: teachSignal.field, match_value: teachSignal.value }),
      destinationLabels: destinationNames(destinations),
    };
  }, [destinations, destinationsTouched, routingDecision, teachDismissed, teachSignal, text]);

  const resetDraft = useCallback(
    (clearTag = false) => {
      setText("");
      setCaptureLane("focus");
      setListName(DEFAULT_LIST);
      setRecentIndex(null);
      setManualReminderTime(null);
      setDestinations(DEFAULT_DESTINATIONS);
      setDestinationsTouched(false);
      setSplitDisabled(false);
      setTeachDismissed(false);
      if (clearTag) {
        setSelectedTag("untagged");
      }
      void setSetting(DRAFT_SETTING_KEY, "");
    },
    [setSelectedTag],
  );

  function toDestinations(capture: Capture): CaptureDestinations {
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

  async function loadRecentCaptures() {
    try {
      const captures = await listCaptures(RECENT_LIMIT);
      setRecentCaptures(captures.filter((capture) => capture.content.trim().length > 0));
      setRecentIndex(null);
    } catch (error) {
      console.error("Failed to load recent captures", error);
      setRecentCaptures([]);
      setRecentIndex(null);
    }
  }

  function insertAtCursor(textToInsert: string) {
    const field = inputRef.current;
    if (!field) {
      setText((prev) => `${prev}${textToInsert}`.slice(0, MAX_CHARS));
      return;
    }

    const selectionStart = field.selectionStart ?? text.length;
    const selectionEnd = field.selectionEnd ?? text.length;
    const next = `${text.slice(0, selectionStart)}${textToInsert}${text.slice(selectionEnd)}`.slice(
      0,
      MAX_CHARS,
    );
    setText(next);

    requestAnimationFrame(() => {
      const cursor = Math.min(selectionStart + textToInsert.length, next.length);
      field.setSelectionRange(cursor, cursor);
      field.focus();
    });
  }

  function replaceRange(start: number, end: number, replacement: string) {
    const field = inputRef.current;
    const next = `${text.slice(0, start)}${replacement}${text.slice(end)}`.slice(0, MAX_CHARS);
    setText(next);

    requestAnimationFrame(() => {
      if (!field) {
        return;
      }
      const cursor = Math.min(start + replacement.length, next.length);
      field.setSelectionRange(cursor, cursor);
      field.focus();
    });
  }

  function applyTextEdit(nextValue: string, cursor: number) {
    const field = inputRef.current;
    const clamped = nextValue.slice(0, MAX_CHARS);
    setText(clamped);

    requestAnimationFrame(() => {
      if (!field) {
        return;
      }
      const next = Math.min(cursor, clamped.length);
      field.setSelectionRange(next, next);
      field.focus();
    });
  }

  function insertListPrefix(prefix: string) {
    const field = inputRef.current;
    if (!field) {
      setText((prev) => `${prev}${prefix}`.slice(0, MAX_CHARS));
      return;
    }

    const cursor = field.selectionStart ?? text.length;
    const bounds = currentLineBounds(text, cursor);
    const leadingWhitespace = bounds.line.match(/^\s*/)?.[0] ?? "";
    const trimmed = bounds.line.trim();

    if (trimmed.length === 0) {
      replaceRange(bounds.start, bounds.end, `${leadingWhitespace}${prefix}`);
      return;
    }

    if (/^\s*(?:[-*]\s+|- \[[ xX]\]\s+|\d+\.\s+)/.test(bounds.line)) {
      return;
    }

    replaceRange(bounds.start, bounds.start, `${leadingWhitespace}${prefix}`);
  }

  function hydrateFromRecent(capture: Capture) {
    setText(capture.content);
    setCaptureLane(capture.capture_lane ?? "focus");
    setSelectedTag(capture.tag);
    setListName(capture.list_name?.trim() || DEFAULT_LIST);
    setDestinations(toDestinations(capture));
    setDestinationsTouched(true);
    setManualReminderTime(capture.reminder_time);
    focusInputAtEnd();
  }

  async function loadManagedLists() {
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
  }

  async function saveCurrentListAsManaged() {
    const normalized = normalizeListName(listName);
    try {
      await createManagedList(normalized);
      setListName(normalized);
      await loadManagedLists();
    } catch (error) {
      console.error("Failed to save list", error);
    }
  }

  function setLane(nextLane: CaptureLane) {
    setCaptureLane(nextLane);
    setListName((prev) => {
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

  const refreshRoutingInputs = useCallback(() => {
    void loadIntegrationSettings().then(setIntegrationSettings).catch(console.error);
    void listRoutingRules().then(setRoutingRules).catch(console.error);
  }, []);

  useEffect(() => {
    refreshRoutingInputs();
  }, [refreshRoutingInputs]);

  // Once-a-day recap: the first time the capture window appears each day,
  // greet the user with what yesterday produced and what is due today.
  const maybeShowRecap = useCallback(() => {
    void (async () => {
      try {
        const todayKey = localDateKey();
        const lastShown = await getSetting(RECAP_SETTING_KEY);
        if (lastShown === todayKey) {
          return;
        }
        const stats = await getDailyRecapStats();
        if (stats.yesterdayCount === 0 && stats.dueTodayCount === 0) {
          return;
        }
        setRecap(stats);
        await setSetting(RECAP_SETTING_KEY, todayKey);
      } catch (error) {
        console.error("Failed to load daily recap", error);
      }
    })();
  }, []);

  useEffect(() => {
    maybeShowRecap();
  }, [maybeShowRecap]);

  useEffect(() => {
    void getTotalCaptureCount().then(setTotalCaptures).catch(() => setTotalCaptures(null));
  }, []);

  useEffect(() => {
    let active = true;

    async function restoreDraft() {
      try {
        const raw = await getSetting(DRAFT_SETTING_KEY);
        if (!active || !raw) {
          return;
        }

        const draft = JSON.parse(raw) as Partial<CaptureDraft>;
        if (typeof draft.text === "string" && draft.text.trim().length > 0) {
          setText(draft.text.slice(0, MAX_CHARS));
          setCaptureLane(draft.captureLane === "distraction" ? "distraction" : "focus");
          setListName(draft.listName?.trim() || DEFAULT_LIST);
          if (draft.destinations && draft.destinationsTouched) {
            setDestinations(draft.destinations);
            setDestinationsTouched(true);
          }
          if (draft.tag) {
            setSelectedTag(draft.tag);
          }
          setManualReminderTime(draft.manualReminderTime ?? null);
          focusInputAtEnd();
        }
      } catch (error) {
        console.error("Failed to restore draft", error);
      } finally {
        if (active) {
          hydratedRef.current = true;
        }
      }
    }

    void restoreDraft();

    return () => {
      active = false;
    };
  }, [focusInputAtEnd, setSelectedTag]);

  // Autosave the in-progress draft so a capture survives the window hiding on
  // focus loss (e.g. clicking the OAuth browser tab) or an app restart.
  useEffect(() => {
    if (!hydratedRef.current) {
      return;
    }

    const handle = window.setTimeout(() => {
      if (text.trim().length === 0) {
        void setSetting(DRAFT_SETTING_KEY, "");
        return;
      }
      const draft: CaptureDraft = {
        text,
        captureLane,
        listName,
        destinations,
        destinationsTouched,
        tag: selectedTag,
        manualReminderTime,
      };
      void setSetting(DRAFT_SETTING_KEY, JSON.stringify(draft));
    }, 300);

    return () => {
      window.clearTimeout(handle);
    };
  }, [text, captureLane, listName, destinations, destinationsTouched, selectedTag, manualReminderTime]);

  useEffect(() => {
    let active = true;

    void (async () => {
      const [onboardingDone, tourDone] = await Promise.all([
        getSetting("onboarding_complete"),
        getSetting("capture_tour_complete"),
      ]);
      if (!active) {
        return;
      }
      if (onboardingDone === "true" && tourDone !== "true") {
        setShowProductTour(true);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  async function completeProductTour() {
    setShowProductTour(false);
    try {
      await setSetting("capture_tour_complete", "true");
    } catch (error) {
      console.error("Failed to save capture tour state", error);
    }
  }

  useEffect(() => {
    const unlistenPromise = listen("chute://show-capture", () => {
      setPulse((value) => value + 1);
      setAllConfirm(false);
      setUndoStrip(
        undoAvailable() && undoRef.current ? { labels: undoRef.current.labels } : null,
      );
      void loadRecentCaptures();
      void loadManagedLists();
      refreshRoutingInputs();
      maybeShowRecap();
      focusInputAtEnd();
    });

    focusInputAtEnd();

    return () => {
      unlistenPromise.then((dispose) => dispose()).catch(() => {});
    };
  }, [focusInputAtEnd, maybeShowRecap, refreshRoutingInputs, undoAvailable]);

  async function closeCaptureWindow() {
    // Keep the draft (autosaved) so dismissing never loses an unsaved thought.
    try {
      await invoke("hide_capture_window");
    } catch (error) {
      console.error("hide_capture_window failed", error);
    }
  }

  async function quitApp() {
    try {
      await invoke("exit_app");
    } catch {
      // If the bridge is dead, still try to dismiss the overlay.
      await closeCaptureWindow();
    }
  }

  async function openHistoryWindow() {
    await invoke("open_history_window");
  }

  async function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    await setSetting("theme", nextTheme);
  }

  function toggleDestination(key: DestinationKey) {
    // First touch seeds the manual state from the live suggestion so the user
    // edits what they see, then their choices win until the draft resets.
    const base = destinationsTouched ? destinations : previewDestinations;
    setDestinations({ ...base, [key]: !base[key] });
    setDestinationsTouched(true);
  }

  function enableAllDestinations() {
    const base = destinationsTouched ? destinations : previewDestinations;
    // "All" means every *connected* app — never light up a destination the
    // user hasn't set up, which would just fail on send.
    const avail = liveAvailable;
    setDestinations({
      ...base,
      slack: avail?.slack ?? false,
      discord: avail?.discord ?? false,
      notion: avail?.notion ?? false,
      googleTasks: avail?.googleTasks ?? false,
      googleCalendar: avail?.googleCalendar ?? false,
      appleReminders: (avail?.appleReminders ?? IS_MACOS) ? true : base.appleReminders,
      reminders: (avail?.reminders ?? IS_MACOS) ? true : base.reminders,
    });
    setDestinationsTouched(true);
  }

  useEffect(() => {
    if (!destinationPrompt) {
      return;
    }
    void loadIntegrationSettings().then(setIntegrationSettings).catch(console.error);
  }, [destinationPrompt]);

  async function acceptTeachOffer() {
    if (!teachOffer) {
      return;
    }
    try {
      await createRoutingRule({
        field: teachOffer.field,
        matchValue: teachOffer.value,
        destinations,
      });
      setRoutingRules(await listRoutingRules());
      setTeachDismissed(true);
      setSavedMessage(`Rule saved: ${teachOffer.label} → ${teachOffer.destinationLabels.join(", ")}`);
      window.setTimeout(() => setSavedMessage(""), 2200);
    } catch (error) {
      console.error("Failed to save routing rule", error);
      setSaveError("Could not save the routing rule. Try again.");
    }
  }

  // Fires the send queued by double-Enter one render later, when the text
  // with the trailing bullet stripped (and everything derived from it, like
  // the split preview) is what persistCapture will actually read.
  useEffect(() => {
    if (!pendingSend) {
      return;
    }
    setPendingSend(false);
    void persistCapture(false);
    // persistCapture is a plain function (new identity each render); depending
    // on it would re-run this every render for nothing. pendingSend gates it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSend]);

  async function persistCapture(keepOpen: boolean, overrideDestinations?: CaptureDestinations) {
    const trimmed = (parsed.cleanedContent.trim() || text.trim()).slice(0, MAX_CHARS);
    if (!trimmed) {
      setSaveError("Type something to capture first.");
      return;
    }

    if (saving) {
      return;
    }

    // Timer capture: run a Chute-native countdown instead of routing outward.
    const timer = overrideDestinations === undefined ? parseTimer(text) : null;
    if (timer) {
      setSaving(true);
      setSaveError(null);
      try {
        await invoke("start_chute_timer", { seconds: timer.seconds, label: timer.label });
        setSavedMessage(`${timer.label} started · ${formatCountdown(timer.seconds)}`);
        window.setTimeout(() => setSavedMessage(""), 1600);
        resetDraft();
        if (keepOpen) {
          requestAnimationFrame(() => inputRef.current?.focus());
        } else {
          await invoke("hide_capture_window");
        }
      } catch (error) {
        console.error("Timer start failed", error);
        setSaveError("Couldn't start the timer.");
      } finally {
        setSaving(false);
      }
      return;
    }

    // Mixed capture with the split active: one send fans out reminders and
    // note automatically instead of routing the whole text to one place.
    if (splitActive && overrideDestinations === undefined) {
      await persistSplitCapture(keepOpen);
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      const settings = integrationSettings ?? (await loadIntegrationSettings());
      const decision =
        routingDecision ??
        evaluateRouting({
          text,
          tag: selectedTag,
          lane: captureLane,
          listName: normalizeListName(listName),
          reminderTime: effectiveReminderTime,
          isReminderCommand: reminderCommand,
          settings,
          rules: routingRules,
        });

      const usedSuggestion = overrideDestinations === undefined && !destinationsTouched;
      const requestedDestinations =
        overrideDestinations ?? (destinationsTouched ? destinations : decision.destinations);
      // Final safety net: even a stale manual pick (e.g. a draft that selected
      // Discord before it was disconnected) can never send somewhere unreachable.
      const finalDestinations = onlyAvailableDestinations(
        requestedDestinations,
        availableDestinations(settings),
      );
      const routingSource = usedSuggestion ? decision.source : "manual";
      const routingReason = usedSuggestion ? decision.reason : "You chose these destinations";

      if (!hasActiveDestination(finalDestinations) && hasAnyProviderConfigured(settings)) {
        setSaving(false);
        setDestinationPrompt({ keepOpen, destinations: decision.destinations });
        return;
      }

      const captureId = crypto.randomUUID();
      await insertCapture({
        id: captureId,
        content: trimmed,
        tag: selectedTag,
        lane: captureLane,
        listName,
        destinations: finalDestinations,
        reminderTime: effectiveReminderTime,
        recurrenceRule: effectiveRecurrenceRule,
        routingSource,
        routingReason,
      });

      if (usedSuggestion && decision.ruleId) {
        void recordRoutingRuleHit(decision.ruleId).catch(console.error);
      }

      setDestinationPrompt(null);

      const today = await getCapturesTodayCount();
      setCapturesToday(today);
      setTotalCaptures((prev) => (prev === null ? prev : prev + 1));

      await invoke("update_tray_tooltip", {
        capturesToday: today,
        lastSync: lastSyncLabel,
      });

      const savedDestinations = destinationLabels(finalDestinations);

      // Grace period before the capture leaves the machine, so Undo can win
      // the race against the sync engine. Local-only saves have no race.
      const syncTimer = window.setTimeout(() => {
        if (undoRef.current?.id === captureId) {
          undoRef.current.synced = true;
        }
        void emit("chute://request-sync");
        void emit("chute://request-agent");
      }, SYNC_GRACE_MS);
      undoRef.current = {
        id: captureId,
        labels: savedDestinations,
        at: Date.now(),
        syncTimer,
        synced: false,
      };
      setUndoStrip(null);

      void loadRecentCaptures();
      void loadManagedLists();
      setSavedMessage(
        savedDestinations.length > 0
          ? `Saved to ${savedDestinations.slice(0, 2).join(", ")}${savedDestinations.length > 2 ? ` +${savedDestinations.length - 2}` : ""}`
          : "Saved locally",
      );
      window.setTimeout(() => setSavedMessage(""), 1400);

      if (keepOpen) {
        resetDraft();
        requestAnimationFrame(() => {
          inputRef.current?.focus();
        });
        return;
      }

      resetDraft();
      await invoke("hide_capture_window");
    } catch (error) {
      console.error("Capture save failed", error);
      setSaveError(error instanceof Error ? error.message : "Could not save capture. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function persistSplitCapture(keepOpen: boolean) {
    if (!captureSplit || saving) {
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      const noteContent = noteContentFromSplit(captureSplit);

      for (const line of captureSplit.events) {
        await insertCapture({
          id: crypto.randomUUID(),
          content: line.cleanedContent.slice(0, MAX_CHARS),
          tag: selectedTag,
          lane: captureLane,
          listName,
          destinations: { ...DEFAULT_DESTINATIONS, appleCalendar: true },
          reminderTime: line.reminderTime,
          routingSource: "split",
          routingReason: line.signal ? `Line ${line.signal} → Apple Calendar` : "Reads as an event → Apple Calendar",
        });
      }

      for (const line of captureSplit.reminders) {
        await insertCapture({
          id: crypto.randomUUID(),
          content: line.cleanedContent.slice(0, MAX_CHARS),
          tag: selectedTag,
          lane: captureLane,
          listName,
          destinations: { ...DEFAULT_DESTINATIONS, reminders: true },
          reminderTime: line.reminderTime,
          routingSource: "split",
          routingReason: line.reminderTime
            ? "Line has a time → Reminders"
            : line.signal
              ? `Line ${line.signal} → Reminders`
              : "Action line → Reminders",
        });
      }

      if (noteContent) {
        await insertCapture({
          id: crypto.randomUUID(),
          content: noteContent.slice(0, MAX_CHARS),
          tag: selectedTag,
          lane: captureLane,
          listName,
          destinations: { ...DEFAULT_DESTINATIONS, appleReminders: true },
          reminderTime: null,
          routingSource: "split",
          routingReason: "Prose lines → Apple Notes",
        });
      }

      const today = await getCapturesTodayCount();
      setCapturesToday(today);
      const added =
        captureSplit.events.length + captureSplit.reminders.length + (noteContent ? 1 : 0);
      setTotalCaptures((prev) => (prev === null ? prev : prev + added));

      await invoke("update_tray_tooltip", {
        capturesToday: today,
        lastSync: lastSyncLabel,
      });

      // Multi-capture saves skip single-capture undo; sync after the same
      // grace period the normal path uses.
      undoRef.current = null;
      setUndoStrip(null);
      window.setTimeout(() => {
        void emit("chute://request-sync");
        void emit("chute://request-agent");
      }, SYNC_GRACE_MS);

      void loadRecentCaptures();
      void loadManagedLists();
      const savedParts = [
        captureSplit.events.length > 0 ? `${captureSplit.events.length} → Calendar` : null,
        captureSplit.reminders.length > 0 ? `${captureSplit.reminders.length} → Reminders` : null,
        noteContent ? "note → Apple Notes" : null,
      ].filter(Boolean);
      setSavedMessage(`Split: ${savedParts.join(" · ")}`);
      window.setTimeout(() => setSavedMessage(""), 1800);

      resetDraft();
      if (keepOpen) {
        requestAnimationFrame(() => inputRef.current?.focus());
        return;
      }
      await invoke("hide_capture_window");
    } catch (error) {
      console.error("Split capture failed", error);
      setSaveError(error instanceof Error ? error.message : "Could not split the capture.");
    } finally {
      setSaving(false);
    }
  }

  const canSend = (parsed.cleanedContent.trim() || text.trim()).length > 0;
  const isEmpty = text.trim().length === 0;
  const showHints = totalCaptures !== null && totalCaptures < HINT_GRADUATION_CAPTURES;

  // Spotlight-scale when idle, expanded once typing reveals the controls.
  // Re-applied on every summon (pulse): the Rust side opens at compact size,
  // and a restored draft needs the expanded height immediately.
  const windowHeightRef = useRef(WINDOW_HEIGHT_COMPACT);
  useEffect(() => {
    const base = isEmpty ? WINDOW_HEIGHT_COMPACT : WINDOW_HEIGHT_EXPANDED;
    windowHeightRef.current = base;
    void invoke("resize_capture_window", { height: base }).catch(() => {});
  }, [isEmpty, pulse]);

  // Content-driven growth: when the textarea's content outgrows its visible
  // box, grow the window by the deficit (up to WINDOW_HEIGHT_MAX) so the
  // caret line never gets pinched against the toolbar. Growth-only per
  // draft — the baseline effect above resets on empty/summon.
  useEffect(() => {
    if (isEmpty) {
      return;
    }
    const raf = requestAnimationFrame(() => {
      const field = inputRef.current;
      if (!field) {
        return;
      }
      const deficit = field.scrollHeight - field.clientHeight;
      if (deficit <= 4) {
        return;
      }
      const target = Math.min(WINDOW_HEIGHT_MAX, windowHeightRef.current + deficit + 8);
      if (target > windowHeightRef.current) {
        windowHeightRef.current = target;
        void invoke("resize_capture_window", { height: target }).catch(() => {});
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [text, isEmpty, splitActive, effectivePreviewLabel, teachOffer, saveError]);

  const placeholder = useMemo(() => {
    if (captureLane === "distraction") {
      return "Park the distraction…";
    }
    const hint = CAPTURE_HINTS[pulse % CAPTURE_HINTS.length];
    return `Try: "${hint}"`;
  }, [captureLane, pulse]);

  async function undoLastCapture() {
    const last = undoRef.current;
    if (!last || Date.now() - last.at > UNDO_WINDOW_MS) {
      return;
    }
    window.clearTimeout(last.syncTimer);
    undoRef.current = null;
    setUndoStrip(null);
    try {
      await deleteCapture(last.id);
      const today = await getCapturesTodayCount();
      setCapturesToday(today);
      setTotalCaptures((prev) => (prev === null || prev === 0 ? prev : prev - 1));
      void emit("chute://captures-changed");
      void loadRecentCaptures();
      setSavedMessage(
        last.synced && last.labels.length > 0
          ? "Removed from Chute — it may have already reached your apps"
          : "Capture undone",
      );
      window.setTimeout(() => setSavedMessage(""), 2000);
    } catch (error) {
      console.error("Undo failed", error);
      setSaveError("Could not undo the last capture.");
    }
  }

  return (
    // No outer padding: the shell fills the window edge-to-edge. Any gap here
    // shows the native window backing on macOS 26, which reads as a hazy border.
    <div className="capture-overlay h-full w-full overflow-hidden" data-tauri-drag-region>
      <div
        key={pulse}
        className="capture-shell capture-pop relative h-full w-full shadow-floating"
      >
        {savedMessage ? (
          <div className="save-badge pointer-events-none absolute left-1/2 top-4 z-20">
            <div className="flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-500 shadow-lg">
              <svg
                viewBox="0 0 24 24"
                width="15"
                height="15"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path className="check-draw" d="M5 13l4 4L19 7" />
              </svg>
              {savedMessage}
            </div>
          </div>
        ) : null}
        <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden px-4 py-3">
          {/* Header — doubles as the window drag handle */}
          <div className="flex items-center justify-between" data-tauri-drag-region>
            <div className="pointer-events-none flex items-center gap-2.5">
              <ChuteLogo size={22} className="chute-logo-header" />
              <span className="codex-panel-title text-base font-medium tracking-tight">
                Chute
              </span>
            </div>
            <div className="flex items-center gap-0.5">
              {update.state === "ready" ? (
                <button
                  type="button"
                  onClick={restartToUpdate}
                  className="mr-1 rounded-full border border-[var(--accent)]/40 bg-[var(--btn-soft)] px-2.5 py-1 text-[10px] font-medium text-[var(--text)] transition-colors hover:bg-[var(--btn-soft-hover)]"
                  title={`Chute ${update.version} is downloaded — restart to apply`}
                >
                  Update ready · Restart
                </button>
              ) : null}
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
                onClick={() => void openHistoryWindow()}
                className="icon-btn"
                title="Open history"
                aria-label="Open history"
                data-tour="history"
              >
                <IconHistory />
              </button>
              <button
                type="button"
                onClick={() => void closeCaptureWindow()}
                className="icon-btn"
                title="Dismiss (Esc)"
                aria-label="Dismiss capture"
              >
                <IconClose />
              </button>
            </div>
          </div>

          {recap && isEmpty ? (
            <div className="group flex shrink-0 items-center gap-2 px-1 text-[11px]">
              <span className="inline-block h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]" aria-hidden="true" />
              <span className="codex-muted min-w-0 truncate">
                <span className="font-medium text-[var(--text)]">{recapGreeting()}.</span>{" "}
                {recap.yesterdayCount > 0
                  ? `${recap.yesterdayCount} thought${recap.yesterdayCount === 1 ? "" : "s"} yesterday`
                  : null}
                {recap.yesterdayCount > 0 && recap.dueTodayCount > 0 ? " · " : null}
                {recap.dueTodayCount > 0
                  ? `${recap.dueTodayCount} due today`
                  : null}
              </span>
              {recap.dueTodayCount > 0 || recap.yesterdayCount > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setRecap(null);
                    void openHistoryWindow();
                  }}
                  className="shrink-0 text-[var(--accent)] underline decoration-[var(--accent)]/30 underline-offset-2 transition hover:decoration-[var(--accent)]"
                >
                  Review
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setRecap(null)}
                className="codex-muted ml-auto shrink-0 opacity-0 transition hover:text-[var(--text)] group-hover:opacity-100"
                aria-label="Dismiss recap"
              >
                <IconClose size={12} />
              </button>
            </div>
          ) : null}

          {/* Lane + tags — contextual: only shown once there is something to file */}
          {!isEmpty ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div
              className="inline-flex rounded-xl border border-[var(--border)] bg-[var(--btn-soft)] p-0.5"
              data-tour="lanes"
            >
              {([
                ["focus", "Focus"],
                ["distraction", "Park it"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setLane(value)}
                  className={[
                    "rounded-lg px-3 py-1 text-xs font-medium transition",
                    captureLane === value
                      ? "codex-btn"
                      : "codex-muted hover:bg-[var(--btn-soft-hover)] hover:text-[var(--text)]",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5" data-tour="tags">
              <span title={IS_MACOS ? "⌘1" : "Ctrl+1"}>
                <TagChip tag="work" active={selectedTag === "work"} onSelect={setSelectedTag} />
              </span>
              <span title={IS_MACOS ? "⌘2" : "Ctrl+2"}>
                <TagChip tag="personal" active={selectedTag === "personal"} onSelect={setSelectedTag} />
              </span>
              <span title={IS_MACOS ? "⌘3" : "Ctrl+3"}>
                <TagChip tag="idea" active={selectedTag === "idea"} onSelect={setSelectedTag} />
              </span>
            </div>
          </div>
          ) : null}

          {/* Prompt box, scrolls inside the fixed capture window height */}
          <div className="prompt-box flex min-h-0 flex-1 flex-col overflow-hidden px-3.5 pt-3 pb-2.5">
            <div className="flex min-h-0 flex-1 flex-col" data-tour="prompt-field">
            <textarea
              ref={inputRef}
              value={text}
              maxLength={MAX_CHARS}
              placeholder={placeholder}
              onChange={(event) => {
                setText(event.currentTarget.value);
                setRecentIndex(null);
                setManualReminderTime(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  void closeCaptureWindow();
                  return;
                }

                if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "q") {
                  event.preventDefault();
                  void quitApp();
                  return;
                }

                if (
                  (event.ctrlKey || event.metaKey) &&
                  !event.shiftKey &&
                  event.key.toLowerCase() === "z" &&
                  isEmpty &&
                  undoAvailable()
                ) {
                  event.preventDefault();
                  void undoLastCapture();
                  return;
                }

                // Cmd/Ctrl+1/2/3 tag the capture without leaving the keyboard;
                // pressing the active tag's key again untags.
                if ((event.ctrlKey || event.metaKey) && ["1", "2", "3"].includes(event.key)) {
                  event.preventDefault();
                  const tagByKey = { "1": "work", "2": "personal", "3": "idea" } as const;
                  const nextTag = tagByKey[event.key as "1" | "2" | "3"];
                  setSelectedTag(selectedTag === nextTag ? "untagged" : nextTag);
                  return;
                }

                if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                  event.preventDefault();
                  void persistCapture(true);
                  return;
                }

                if (event.shiftKey && event.key === "Enter") {
                  // Newline that respects what the user typed: continues a
                  // list only if this line already is one, exits on an empty
                  // item, and never invents a "- " on a plain line.
                  event.preventDefault();
                  const field = inputRef.current;
                  const hasSelection =
                    field != null && field.selectionStart !== field.selectionEnd;
                  const cursor = field?.selectionStart ?? text.length;
                  const continued = hasSelection ? null : continueListOnNewline(text, cursor);
                  if (continued) {
                    applyTextEdit(continued.value, continued.cursor);
                  } else {
                    insertAtCursor("\n");
                  }
                  return;
                }

                if (event.altKey && event.key === "Enter") {
                  // Escape hatch: a plain newline even mid-list.
                  event.preventDefault();
                  insertAtCursor("\n");
                  return;
                }

                if (event.altKey && event.key.toLowerCase() === "b") {
                  event.preventDefault();
                  insertListPrefix("- ");
                  return;
                }

                if (event.altKey && event.key.toLowerCase() === "x") {
                  event.preventDefault();
                  insertListPrefix("- [ ] ");
                  return;
                }

                if (event.altKey && event.key.toLowerCase() === "n") {
                  event.preventDefault();
                  insertListPrefix("1. ");
                  return;
                }

                if (event.altKey && event.key.toLowerCase() === "a" && teachOffer) {
                  event.preventDefault();
                  void acceptTeachOffer();
                  return;
                }

                if ((event.ctrlKey || event.metaKey) && event.key === "ArrowUp") {
                  if (recentCaptures.length === 0) {
                    return;
                  }
                  event.preventDefault();
                  const nextIndex =
                    recentIndex === null ? 0 : Math.min(recentIndex + 1, recentCaptures.length - 1);
                  setRecentIndex(nextIndex);
                  hydrateFromRecent(recentCaptures[nextIndex]);
                  return;
                }

                if ((event.ctrlKey || event.metaKey) && event.key === "ArrowDown") {
                  if (recentIndex === null) {
                    return;
                  }
                  event.preventDefault();
                  const nextIndex = recentIndex - 1;
                  if (nextIndex < 0) {
                    resetDraft();
                    return;
                  }
                  setRecentIndex(nextIndex);
                  hydrateFromRecent(recentCaptures[nextIndex]);
                  return;
                }

                if (event.key === "Enter") {
                  if (event.nativeEvent.isComposing) {
                    return;
                  }
                  event.preventDefault();

                  // Enter always sends — one keystroke, even from inside a
                  // list (Shift+Enter adds lines). If the caret sits on an
                  // empty bullet, strip it first and let the pending-send
                  // effect fire once the cleaned text commits to state.
                  const cursor = inputRef.current?.selectionStart ?? text.length;
                  const bounds = currentLineBounds(text, cursor);
                  if (/^\s*(?:- \[[ xX]\]\s+|[-*]\s+|\d+\.\s+)/.test(bounds.line)) {
                    const lineBody = bounds.line
                      .replace(/^\s*(?:- \[[ xX]\]\s+|[-*]\s+|\d+\.\s+)/, "")
                      .trim();
                    if (lineBody.length === 0) {
                      replaceRange(bounds.start, bounds.end, "");
                      const rest = `${text.slice(0, bounds.start)}${text.slice(bounds.end)}`;
                      if (rest.trim().length > 0) {
                        setPendingSend(true);
                      }
                      return;
                    }
                  }

                  void persistCapture(false);
                }
              }}
              rows={3}
              className="prompt-input min-h-[72px] w-full flex-1 text-base leading-7"
              autoComplete="off"
              spellCheck={false}
            />

            {/* Inline status chips (reminder / ambiguity) — hidden while the
                split preview owns the routing story, since per-line times are
                what actually ship */}
            {!splitActive &&
            (effectivePreviewLabel || (parsed.isAmbiguous && parsed.reminderTime && !manualReminderTime)) ? (
              <div className="flex flex-wrap items-center gap-1.5 pb-2 text-[11px]">
                {effectivePreviewLabel ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--btn-soft)] px-2.5 py-1">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
                    {effectivePreviewLabel}
                    {manualReminderTime ? (
                      <button
                        type="button"
                        onClick={() => setManualReminderTime(null)}
                        className="ml-0.5 text-[var(--muted)] hover:text-[var(--text)]"
                        aria-label="Clear manual time"
                      >
                        ×
                      </button>
                    ) : null}
                  </span>
                ) : null}
                {parsed.isAmbiguous && parsed.reminderTime && !manualReminderTime ? (
                  <>
                    <span className="rounded-full border border-amber-400/55 bg-amber-500/15 px-2.5 py-1 text-amber-500">
                      {parsed.ambiguityReason ?? "Ambiguous time:"}
                    </span>
                    {quickReminderOptions.map((option) => (
                      <button
                        key={option.label}
                        type="button"
                        onClick={() => setManualReminderTime(option.value)}
                        className="codex-btn-soft rounded-full px-2.5 py-1"
                      >
                        {option.label}
                      </button>
                    ))}
                  </>
                ) : null}
              </div>
            ) : null}

            {timerPreview ? (
              <div className="smart-preview mb-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="smart-preview-dot" aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-[var(--text)]">
                      Timer
                      <span className="codex-muted font-normal"> · {timerPreview.label}</span>
                    </div>
                    <div className="codex-muted truncate text-[11px]">
                      Counts down {formatCountdown(timerPreview.seconds)} in Chute, then rings
                    </div>
                  </div>
                </div>
                <span className="smart-preview-reason">Looks like a timer</span>
              </div>
            ) : splitActive && captureSplit ? (
              <div className="smart-preview mb-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="smart-preview-dot" aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-[var(--text)]">
                      Split on send
                      <span className="codex-muted font-normal">
                        {captureSplit.events.length > 0 ? (
                          <>
                            {" "}· {captureSplit.events.length} event
                            {captureSplit.events.length === 1 ? "" : "s"} → Calendar
                          </>
                        ) : null}
                        {captureSplit.reminders.length > 0 ? (
                          <>
                            {" "}· {captureSplit.reminders.length} action
                            {captureSplit.reminders.length === 1 ? "" : "s"} → Reminders
                          </>
                        ) : null}
                        {captureSplit.notes.length > 0 ? (
                          <>
                            {" "}· {captureSplit.notes.length} line
                            {captureSplit.notes.length === 1 ? "" : "s"} → Apple Notes
                          </>
                        ) : null}
                      </span>
                    </div>
                    <div className="codex-muted truncate text-[11px]">
                      Enter sends — each action keeps its own time
                      {captureSplit.heading ? ` — note titled “${captureSplit.heading}”` : ""}
                    </div>
                  </div>
                </div>
                <span className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSplitDisabled(true)}
                    className="codex-btn-soft rounded-full px-2 py-0.5 text-[10px]"
                    title="Skip the split and send everything to one place"
                  >
                    Keep together
                  </button>
                </span>
              </div>
            ) : previewContent ? (
              <div className="smart-preview mb-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="smart-preview-dot" aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-[var(--text)]">
                      {previewPrimaryDestination}
                      <span className="codex-muted font-normal">
                        {" "}· {normalizeListName(listName)} · {selectedTag}
                      </span>
                    </div>
                    <div className="codex-muted truncate text-[11px]">
                      {effectivePreviewLabel ? `${effectivePreviewLabel} · ` : ""}
                      {effectiveRecurrenceLabel ? `${effectiveRecurrenceLabel} · ` : ""}
                      {previewLineCount > 1
                        ? `"${previewTitle.slice(0, 48)}" · ${previewLineCount} lines`
                        : `Title: "${previewTitle.slice(0, 72)}"`}
                    </div>
                  </div>
                </div>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="smart-preview-reason">{previewReason}</span>
                  {intentFlip ? (
                    <button
                      type="button"
                      onClick={intentFlip.apply}
                      className="codex-btn-soft rounded-full px-2 py-0.5 text-[10px]"
                      title="Wrong guess? Flip it — Chute offers to remember your correction"
                    >
                      {intentFlip.label}
                    </button>
                  ) : null}
                </span>
              </div>
            ) : null}

            </div>

            {/* Integrated toolbar */}
            <div className="prompt-toolbar mt-auto flex items-center justify-between gap-2 pt-2">
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => insertListPrefix("- ")}
                  className="icon-btn"
                  title="Bullet list (Alt+B)"
                  aria-label="Bullet list"
                >
                  <IconBullet />
                </button>
                <button
                  type="button"
                  onClick={() => insertListPrefix("- [ ] ")}
                  className="icon-btn"
                  title="Checklist (Alt+X)"
                  aria-label="Checklist"
                >
                  <IconCheckbox />
                </button>
                <button
                  type="button"
                  onClick={() => insertListPrefix("1. ")}
                  className="icon-btn"
                  title="Numbered list (Alt+N)"
                  aria-label="Numbered list"
                >
                  <IconNumbered />
                </button>

                <span className="mx-1 h-5 w-px bg-[var(--border)]" />

                <span data-tour="list">
                  <ListPicker
                  value={listName}
                  options={managedLists}
                  onChange={setListName}
                  onSave={() => void saveCurrentListAsManaged()}
                  folderIcon={<IconFolder />}
                  bookmarkIcon={<IconBookmark size={13} />}
                  />
                </span>
              </div>

              <div className="flex items-center gap-2.5">
                {remaining < CHAR_COUNTER_THRESHOLD ? (
                  <span
                    className={[
                      "tabular-nums text-[11px]",
                      remaining < 30 ? "text-amber-500" : "text-[var(--muted)]",
                    ].join(" ")}
                  >
                    {remaining}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => void persistCapture(false)}
                  disabled={!canSend || saving}
                  className="send-btn"
                  title="Capture (Enter)"
                  aria-label="Capture"
                >
                  <IconSend />
                </button>
              </div>
            </div>
          </div>

          {/* Destinations row — appears with the routing suggestion once there is text */}
          {!isEmpty ? (
          <div className="flex shrink-0 flex-nowrap items-center gap-1" data-tour="destinations">
            <span className="codex-muted mr-0.5 shrink-0 text-[10px] font-medium uppercase tracking-[0.08em]">
              Send to
            </span>
            {TARGET_META.map((target) => {
              const active = previewDestinations[target.key];
              // Connection-aware: a cloud app is only selectable once connected;
              // Apple apps only on macOS. Falls back to the platform gate while
              // settings are still loading.
              const isAvailable = liveAvailable ? liveAvailable[target.key] : target.available;
              const reason = isAvailable
                ? target.label
                : target.available
                  ? `Connect ${target.label} in Settings to send here.`
                  : `${target.label} is only available on macOS.`;
              return (
                <button
                  key={target.key}
                  type="button"
                  disabled={!isAvailable}
                  title={reason}
                  onClick={() => toggleDestination(target.key)}
                  className={[
                    "whitespace-nowrap rounded-full border px-2 py-1 text-[11px] transition",
                    active && isAvailable ? "codex-chip-active" : "codex-chip",
                    !isAvailable ? "cursor-not-allowed opacity-45" : "",
                  ].join(" ")}
                >
                  {target.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => {
                if (allConfirmTimerRef.current !== null) {
                  window.clearTimeout(allConfirmTimerRef.current);
                  allConfirmTimerRef.current = null;
                }
                if (allConfirm) {
                  setAllConfirm(false);
                  enableAllDestinations();
                  return;
                }
                // Two-step guard: one stray click must not broadcast a private
                // thought to every connected app.
                setAllConfirm(true);
                allConfirmTimerRef.current = window.setTimeout(() => {
                  setAllConfirm(false);
                  allConfirmTimerRef.current = null;
                }, 3000);
              }}
              className={[
                "ml-auto shrink-0 whitespace-nowrap text-[11px] underline-offset-2 hover:underline",
                allConfirm
                  ? "font-semibold text-amber-500"
                  : "codex-muted hover:text-[var(--text)]",
              ].join(" ")}
            >
              {allConfirm ? "Send to every app?" : "All"}
            </button>
          </div>
          ) : null}

          {teachOffer ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-lg border border-[var(--accent)]/40 bg-[var(--btn-soft)] px-2.5 py-1.5 text-[11px]">
              <span className="codex-muted min-w-0">
                Always send{" "}
                <span className="font-medium text-[var(--text)]">{teachOffer.label}</span>
                {" → "}
                {teachOffer.destinationLabels.join(", ")}?
              </span>
              <button
                type="button"
                onClick={() => void acceptTeachOffer()}
                className="codex-btn inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px]"
              >
                Always
                <span className="kbd">{IS_MACOS ? "⌥A" : "Alt+A"}</span>
              </button>
              <button
                type="button"
                onClick={() => setTeachDismissed(true)}
                className="codex-muted hover:text-[var(--text)]"
                aria-label="Dismiss rule suggestion"
                title="Just this once"
              >
                <IconClose size={13} />
              </button>
            </div>
          ) : null}

          {saveError ? (
            <span className="shrink-0 text-xs text-red-400">{saveError}</span>
          ) : null}

          {isEmpty && undoStrip ? (
            <div className="codex-muted flex shrink-0 items-center gap-2 text-[11px]">
              <span className="min-w-0 truncate">
                ✓ Sent{undoStrip.labels.length > 0 ? ` to ${undoStrip.labels.join(", ")}` : " (local only)"}
              </span>
              <button
                type="button"
                onClick={() => void undoLastCapture()}
                className="codex-btn-soft rounded-full px-2.5 py-0.5 text-[11px]"
              >
                Undo
                <span className="kbd ml-1">{IS_MACOS ? "⌘Z" : "Ctrl+Z"}</span>
              </button>
            </div>
          ) : null}

          {/* Keyboard hints — training wheels that come off after the first ~20 captures */}
          {!isEmpty && showHints ? (
          <div className="codex-muted flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-[10px]" data-tour="shortcuts">
            <span className="flex items-center gap-1.5">
              <span className="kbd">Enter</span> capture
            </span>
            <span className="flex items-center gap-1.5">
              <span className="kbd">{IS_MACOS ? "⌘" : "Ctrl"}</span>
              <span className="kbd">Enter</span> keep open
            </span>
            <span className="flex items-center gap-1.5">
              <span className="kbd">⇧</span>
              <span className="kbd">Enter</span> newline
            </span>
            <span className="flex items-center gap-1.5">
              <span className="kbd">Esc</span> dismiss
            </span>
          </div>
          ) : null}
        </div>
      </div>
      {showProductTour ? <CaptureProductTour onComplete={() => void completeProductTour()} /> : null}
      {destinationPrompt && integrationSettings ? (
        <CaptureDestinationPrompt
          reminderLabel={effectivePreviewLabel}
          destinations={destinationPrompt.destinations}
          available={availableDestinations(integrationSettings)}
          onConfirm={(next) => {
            setDestinations(next);
            setDestinationsTouched(true);
            void persistCapture(destinationPrompt.keepOpen, next);
          }}
          onLocalOnly={() => {
            const localOnly: CaptureDestinations = {
              slack: false,
              discord: false,
              notion: false,
              googleTasks: false,
              googleCalendar: false,
              appleReminders: false,
              reminders: false,
              appleCalendar: false,
            };
            void persistCapture(destinationPrompt.keepOpen, localOnly);
          }}
          onCancel={() => {
            setDestinationPrompt(null);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
        />
      ) : null}
    </div>
  );
}
