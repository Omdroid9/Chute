import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import {
  type AppendState,
  getAppendStatesFor,
  getCaptureLinksFor,
  getSetting,
  listCapturesToday,
  retryCaptureAppends,
  setCaptureSyncError,
  setSetting,
} from "../../lib/db";
import { loadSyncConfig, type CaptureSyncOutcome } from "../../lib/sync/syncManager";
import { DESTINATION_LABELS, describeDestinations } from "../../lib/sync/destinations";
import {
  countLanded,
  primaryTarget,
  toLandedRow,
  type LandedCounts,
  type LandedRow,
  type LandedStatus,
} from "./landedRows";
import { openTarget } from "./landedActions";
import {
  CONF_DROP,
  CONF_PILL,
  EAR,
  PANEL_WIDTH,
  PILL,
  contains,
  hotRectFor,
  restingHotRect,
  shapeFor,
  tipRect,
  type Geometry,
  type Rect,
  type Stage,
} from "./landedGeometry";
import "./landed.css";

/** Pointer state polled natively: a non-key window gets no DOM hover. */
interface Pointer {
  inside: boolean;
  near: boolean;
  buttons: boolean;
  x: number;
  y: number;
}

interface Confirmation {
  tone: "ok" | "fail";
  text: string;
}

/** Rest this long on the notch before it peeks; brushing past does nothing. */
const PEEK_DELAY_MS = 300;
const CLOSE_GRACE_MS = { peek: 250, open: 450 };
const CONF_MS = { ok: 2200, fail: 3200 };
const REFRESH_MS = 60_000;
/** A press can arrive both as a DOM event and from the poller; act once. */
const PRESS_DEDUPE_MS = 350;
const PRESS_DEDUPE_PX = 8;
const MAX_ROWS = 6;

function ParachuteIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="4 4 52 52" aria-hidden className="landed-glyph">
      <path d="M6 26 A24 21 0 0 1 54 26 Q46 34 38 26 Q30 34 22 26 Q14 34 6 26 Z" fill="currentColor" />
      <path d="M16 27 L44 27 L34 46 L26 46 Z" fill="currentColor" />
      <rect x="24" y="45" width="12" height="9" rx="2" fill="currentColor" />
    </svg>
  );
}

function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden className={`landed-status is-landed ${className}`}>
      <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WarnIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden className="landed-status is-failed">
      <path d="M8 2.5l6 10.5H2z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8 6.5v3M8 11.4v.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function StatusIcon({ status }: { status: LandedStatus }) {
  if (status === "landed") return <CheckIcon />;
  if (status === "failed") return <WarnIcon />;
  return <span className={`landed-status landed-status-dot is-${status}`} aria-hidden />;
}

function PeekStatus({ counts }: { counts: LandedCounts }) {
  if (counts.failed > 0) {
    return (
      <>
        <span className="landed-dot is-failed" />
        {counts.failed} need{counts.failed === 1 ? "s" : ""} you
      </>
    );
  }
  if (counts.pending > 0) {
    return (
      <>
        <span className="landed-dot is-pending" />
        {counts.pending} on the way
      </>
    );
  }
  if (counts.total > 0) {
    return (
      <>
        <CheckIcon />
        All in
      </>
    );
  }
  return <span className="landed-muted">Nothing yet</span>;
}

function fixLabel(row: LandedRow, settingsOpened: boolean): string {
  if (row.problem?.kind === "permission") return settingsOpened ? "Retry" : "Fix";
  if (row.problem?.kind === "reconnect") return "Fix";
  return "Retry";
}

export default function LandedWindow() {
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [near, setNear] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [rows, setRows] = useState<LandedRow[]>([]);
  const [notionPageId, setNotionPageId] = useState<string | undefined>(undefined);
  const [panelHeight, setPanelHeight] = useState(160);
  const [tipHeight, setTipHeight] = useState(96);
  // null until the setting is read, so the tip never flashes for people who've seen it.
  const [tipSeen, setTipSeen] = useState<boolean | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  // Permission rows whose Fix already opened System Settings: next click retries.
  const [settingsOpened, setSettingsOpened] = useState<ReadonlySet<string>>(new Set());

  const panelRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage>("idle");
  const pointerRef = useRef<Pointer | null>(null);
  const rowsRef = useRef<LandedRow[]>([]);
  const notionPageIdRef = useRef<string | undefined>(undefined);
  const settingsOpenedRef = useRef<ReadonlySet<string>>(settingsOpened);
  const tipSeenRef = useRef<boolean | null>(null);
  const restingRef = useRef<Rect | null>(null);
  const peekTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);
  const confTimer = useRef<number | undefined>(undefined);
  const refreshSeq = useRef(0);
  const lastPress = useRef({ time: -Infinity, x: 0, y: 0 });
  /** How the panel was opened: from the menu bar icon it waits for the pointer to arrive. */
  const openedBy = useRef<"pointer" | "tray">("pointer");
  const pointerArrived = useRef(true);
  /** After a dismissal, don't peek again until the pointer has left. */
  const suppressUntilLeave = useRef(false);
  /** Captures whose failure was already announced; background retries stay quiet. */
  const announcedFailures = useRef(new Set<string>());

  // Event handlers are subscribed once; they read the latest state from refs.
  useLayoutEffect(() => {
    rowsRef.current = rows;
    notionPageIdRef.current = notionPageId;
    settingsOpenedRef.current = settingsOpened;
    tipSeenRef.current = tipSeen;
  }, [rows, notionPageId, settingsOpened, tipSeen]);

  const clearTimer = (timer: { current: number | undefined }) => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  };

  const markTipSeen = useCallback(() => {
    if (tipSeenRef.current !== false) return;
    tipSeenRef.current = true;
    setTipSeen(true);
    void setSetting("landed_tip_seen", "true").catch((error) =>
      console.error("Landed: could not save the tip state", error),
    );
  }, []);

  const go = useCallback(
    (next: Stage) => {
      stageRef.current = next;
      setStage(next);
      if (next !== "open") setHoverId(null);
      if (next !== "conf") {
        clearTimer(confTimer);
        setConfirmation(null);
      }
      if (next === "peek" || next === "open") markTipSeen();
    },
    [markTipSeen],
  );

  const close = useCallback(
    (suppress: boolean) => {
      clearTimer(peekTimer);
      clearTimer(closeTimer);
      if (suppress) suppressUntilLeave.current = true;
      go("idle");
    },
    [go],
  );

  const openPanel = useCallback(
    (by: "pointer" | "tray") => {
      clearTimer(peekTimer);
      clearTimer(closeTimer);
      openedBy.current = by;
      pointerArrived.current = by === "pointer";
      go("open");
    },
    [go],
  );

  const refresh = useCallback(async () => {
    const seq = ++refreshSeq.current;
    try {
      const [captures, config] = await Promise.all([listCapturesToday(50), loadSyncConfig()]);
      const ids = captures.map((capture) => capture.id);
      const [links, appends] = await Promise.all([
        getCaptureLinksFor(ids),
        // The main window creates this table on launch; until then, no additions.
        getAppendStatesFor(ids).catch(() => new Map<string, AppendState>()),
      ]);
      if (seq !== refreshSeq.current) return;
      setRows(
        captures.map((capture) =>
          toLandedRow(capture, config, links.get(capture.id) ?? [], appends.get(capture.id)),
        ),
      );
      setNotionPageId(config.notionPageId);
    } catch (error) {
      console.error("Landed: could not load today's captures", error);
    }
  }, []);

  const fix = useCallback(
    async (row: LandedRow) => {
      const problem = row.problem;
      try {
        if (problem?.kind === "permission" && !settingsOpenedRef.current.has(row.id)) {
          setSettingsOpened((current) => new Set(current).add(row.id));
          await invoke("open_automation_settings");
          close(true);
          return;
        }
        if (problem?.kind === "reconnect") {
          await invoke("open_settings_window");
          close(true);
          return;
        }
        // Clear the errors so the row reads as on its way, then ask for a sync.
        await setCaptureSyncError(row.id, null);
        await retryCaptureAppends(row.id);
        announcedFailures.current.delete(row.id);
        await emit("chute://request-sync");
        await refresh();
      } catch (error) {
        console.error("Landed: fix failed", error);
      }
    },
    [close, refresh],
  );

  /** One press on the canvas at (x, y), from either the DOM or the poller. */
  const press = useCallback(
    (x: number, y: number) => {
      const now = performance.now();
      const last = lastPress.current;
      if (now - last.time < PRESS_DEDUPE_MS && Math.hypot(x - last.x, y - last.y) < PRESS_DEDUPE_PX) return;
      lastPress.current = { time: now, x, y };
      const element = document.elementFromPoint(x, y);
      if (!element) return;

      const action = element.closest<HTMLElement>("[data-action]")?.dataset.action;
      const rowId = element.closest<HTMLElement>("[data-row]")?.dataset.row;
      const row = rowsRef.current.find((candidate) => candidate.id === rowId);

      if (action === "tip-ok") {
        markTipSeen();
        return;
      }
      if (action === "fix" && row) {
        void fix(row);
        return;
      }
      if (action === "add" && row) {
        // Open the capture bar in "Adding to" mode for this capture.
        void (async () => {
          await invoke("show_capture_window");
          await emit("chute://add-to", { captureId: row.id });
        })().catch((error) => console.error("Landed: could not start adding", error));
        close(true);
        return;
      }
      if (action === "library") {
        void invoke("show_library_window").catch((error) => console.error("Landed: no Library", error));
        close(true);
        return;
      }
      if (row) {
        void openTarget(row, primaryTarget(row), notionPageIdRef.current).catch((error) =>
          console.error("Landed: could not open the capture", error),
        );
        close(true);
        return;
      }
      if (element.closest(".landed-shape") && stageRef.current !== "open") {
        openPanel("pointer");
      }
    },
    [close, fix, markTipSeen, openPanel],
  );

  const showConfirmation = useCallback(
    (next: Confirmation) => {
      clearTimer(confTimer);
      go("conf");
      setConfirmation(next);
      confTimer.current = window.setTimeout(() => {
        confTimer.current = undefined;
        if (stageRef.current === "conf") go("idle");
      }, CONF_MS[next.tone]);
    },
    [go],
  );

  useEffect(() => {
    const onPointer = (pointer: Pointer) => {
      const previous = pointerRef.current;
      pointerRef.current = pointer;
      setNear(pointer.near);
      const current = stageRef.current;
      const pressed = pointer.buttons && !previous?.buttons;

      // Opened from the menu bar: stay open until the pointer arrives, and
      // close on a click anywhere else.
      if (current === "open" && !pointerArrived.current) {
        if (pointer.inside) {
          pointerArrived.current = true;
        } else {
          if (pressed) close(false);
          return;
        }
      }

      if (!pointer.inside) {
        clearTimer(peekTimer);
        setHoverId(null);
        suppressUntilLeave.current = false;
        if ((current === "peek" || current === "open") && closeTimer.current === undefined) {
          closeTimer.current = window.setTimeout(() => {
            closeTimer.current = undefined;
            go("idle");
          }, CLOSE_GRACE_MS[current]);
        }
        return;
      }

      clearTimer(closeTimer);

      // A press that starts on the shape is a click, even if WebKit drops it
      // (the window is never key).
      if (pressed && previous?.inside) {
        press(pointer.x, pointer.y);
        return;
      }

      if (current === "open") {
        const row = document.elementFromPoint(pointer.x, pointer.y)?.closest<HTMLElement>("[data-row]");
        setHoverId(row?.dataset.row ?? null);
        return;
      }

      // Peek only for a still pointer on the notch itself (not the tip), with
      // no button held (never mid-drag), and not right after a dismissal.
      if (current === "idle") {
        const onNotch = restingRef.current ? contains(restingRef.current, pointer.x, pointer.y) : false;
        if (pointer.buttons || !onNotch || suppressUntilLeave.current) {
          clearTimer(peekTimer);
        } else if (peekTimer.current === undefined) {
          peekTimer.current = window.setTimeout(() => {
            peekTimer.current = undefined;
            const latest = pointerRef.current;
            if (latest?.inside && !latest.buttons && stageRef.current === "idle") go("peek");
          }, PEEK_DELAY_MS);
        }
      }
    };

    const onSynced = (outcome: CaptureSyncOutcome) => {
      void refresh();
      if (stageRef.current !== "idle") return;
      if (outcome.landed.length > 0) {
        announcedFailures.current.delete(outcome.captureId);
        const verb = outcome.added ? "Added to" : "Landed in";
        showConfirmation({ tone: "ok", text: `${verb} ${describeDestinations(outcome.landed)}` });
      } else if (outcome.failed.length > 0 && !announcedFailures.current.has(outcome.captureId)) {
        announcedFailures.current.add(outcome.captureId);
        showConfirmation({ tone: "fail", text: `${DESTINATION_LABELS[outcome.failed[0]]} needs you` });
      }
    };

    const unlisteners = [
      listen<Pointer>("landed://pointer", (event) => onPointer(event.payload)),
      listen<Geometry>("landed://geometry", (event) => setGeometry(event.payload)),
      listen("landed://escape", () => close(true)),
      listen("landed://open", () => {
        if (stageRef.current === "open") close(false);
        else openPanel("tray");
      }),
      listen<CaptureSyncOutcome>("chute://capture-synced", (event) => onSynced(event.payload)),
      listen("chute://request-sync", () => void refresh()),
      listen("chute://captures-changed", () => void refresh()),
    ];
    invoke<Geometry>("landed_geometry")
      .then(setGeometry)
      .catch((error) => console.error("Landed: no geometry", error));

    return () => {
      clearTimer(peekTimer);
      clearTimer(closeTimer);
      clearTimer(confTimer);
      unlisteners.forEach((pending) => void pending.then((unlisten) => unlisten()));
    };
  }, [close, go, openPanel, press, refresh, showConfirmation]);

  // Read the user's settings, then show the panel (it starts hidden natively).
  useEffect(() => {
    void (async () => {
      let enabled = true;
      try {
        const [savedEnabled, savedTip] = await Promise.all([
          getSetting("landed_enabled"),
          getSetting("landed_tip_seen"),
        ]);
        enabled = savedEnabled !== "false";
        tipSeenRef.current = savedTip === "true";
        setTipSeen(savedTip === "true");
      } catch (error) {
        console.error("Landed: could not read settings", error);
      }
      await invoke("landed_set_enabled", { enabled });
    })().catch((error) => console.error("Landed: could not enable", error));
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    if (stage === "peek" || stage === "open") void refresh();
  }, [stage, refresh]);

  const panelTop = geometry?.hasNotch ? geometry.notch.height : 10;
  const counts = countLanded(rows);
  const attention = counts.failed > 0;
  const tipVisible = Boolean(geometry && !geometry.hasNotch && tipSeen === false && stage === "idle");

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || !geometry) return;
    setPanelHeight(Math.min(Math.ceil(panelTop + panel.offsetHeight + 8), geometry.height - 24));
  }, [rows, geometry, panelTop, settingsOpened]);

  useLayoutEffect(() => {
    if (tipVisible && tipRef.current) setTipHeight(Math.ceil(tipRef.current.offsetHeight));
  }, [tipVisible]);

  useLayoutEffect(() => {
    restingRef.current = geometry ? restingHotRect(geometry, attention) : null;
  }, [geometry, attention]);

  useEffect(() => {
    if (!geometry) return;
    const hot = hotRectFor({
      stage,
      geometry,
      near: true,
      attention,
      panelHeight,
      tip: tipVisible ? tipRect(geometry, tipHeight) : null,
    });
    void invoke("landed_set_hot_rect", { ...hot, expanded: stage !== "idle" }).catch((error) =>
      console.error("Landed: could not set hot rect", error),
    );
  }, [geometry, stage, panelHeight, attention, tipVisible, tipHeight]);

  if (!geometry) return null;

  const shape = shapeFor({ stage, geometry, near, attention, panelHeight });
  const shapeStyle: CSSProperties = { left: shape.x, width: shape.width, height: shape.height };
  const peekStyle = {
    width: geometry.hasNotch ? geometry.notch.width + EAR * 2 : PILL.width,
    height: geometry.hasNotch ? geometry.notch.height : PILL.height,
    "--ear": `${EAR}px`,
    "--gap": `${geometry.notch.width}px`,
  } as CSSProperties;
  const confStyle: CSSProperties = geometry.hasNotch
    ? { top: geometry.notch.height, height: CONF_DROP, width: geometry.notch.width + EAR * 2 }
    : { top: 0, height: CONF_PILL.height, width: CONF_PILL.width };
  const tip = tipVisible ? tipRect(geometry, tipHeight) : null;

  return (
    <div
      className="landed"
      data-stage={stage}
      data-notch={geometry.hasNotch ? "real" : "virtual"}
      data-near={near ? "" : undefined}
      data-attention={attention ? "" : undefined}
      onMouseDown={(event) => press(event.clientX, event.clientY)}
    >
      <div className="landed-shape" style={shapeStyle}>
        <div className="landed-clip">
          {geometry.hasNotch ? (
            <span className="landed-attention-dot" aria-hidden />
          ) : (
            <div className="landed-tab">
              <ParachuteIcon size={near ? 13 : 11} />
              {attention && <span className="landed-dot is-failed" />}
            </div>
          )}

          <div className="landed-peek" style={peekStyle}>
            <span className="landed-peek-count">
              <ParachuteIcon size={13} />
              {counts.total} landed
            </span>
            <span className="landed-peek-status">
              <PeekStatus counts={counts} />
            </span>
          </div>

          <div className="landed-conf" style={confStyle} data-tone={confirmation?.tone}>
            {confirmation?.tone === "fail" ? <WarnIcon /> : <CheckIcon />}
            <span className="landed-conf-text">{confirmation?.text}</span>
          </div>

          <div className="landed-panel" style={{ top: panelTop, width: PANEL_WIDTH }} ref={panelRef}>
            <div className="landed-head">
              <span>Landed today</span>
              <span className="landed-head-count">{counts.total}</span>
            </div>
            {rows.length === 0 ? (
              <p className="landed-empty">Nothing yet today. Captures show up here as they land.</p>
            ) : (
              <ul className="landed-rows">
                {rows.slice(0, MAX_ROWS).map((row) => (
                  <li
                    key={row.id}
                    data-row={row.id}
                    className={`landed-row is-${row.status}${hoverId === row.id ? " is-hover" : ""}`}
                  >
                    <StatusIcon status={row.status} />
                    <span className="landed-row-main">
                      <span className="landed-row-text">{row.text}</span>
                      {row.problem && <span className="landed-row-note">{row.problem.message}</span>}
                    </span>
                    {row.status === "failed" ? (
                      <span className="landed-row-fix" data-action="fix">
                        {fixLabel(row, settingsOpened.has(row.id))}
                      </span>
                    ) : (
                      <span className="landed-row-end">
                        {hoverId === row.id && (
                          <span className="landed-row-add" data-action="add">
                            Add
                          </span>
                        )}
                        <span className="landed-row-where">{row.where}</span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {rows.length > MAX_ROWS && (
              <p className="landed-more" data-action="library">
                +{rows.length - MAX_ROWS} more in the Library
              </p>
            )}
          </div>
        </div>
      </div>

      {tip && (
        <div
          className="landed-tip"
          ref={tipRef}
          style={{ left: tip.x, top: tip.y, width: tip.width }}
          role="note"
        >
          <p className="landed-tip-title">Your captures land here</p>
          <p className="landed-tip-body">Rest here to peek, click to open. Brushing past does nothing.</p>
          <span className="landed-tip-ok" data-action="tip-ok">
            Got it
          </span>
        </div>
      )}
    </div>
  );
}
