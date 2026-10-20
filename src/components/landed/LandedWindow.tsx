import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { listCapturesToday } from "../../lib/db";
import { countLanded, toLandedRow, type LandedCounts, type LandedRow, type LandedStatus } from "./landedRows";
import "./landed.css";

type Stage = "idle" | "peek" | "open";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Canvas geometry from the native side, in points (top-left origin). */
interface Geometry {
  width: number;
  height: number;
  /** The real notch, or where the tab rests on screens without one. */
  notch: Rect;
  hasNotch: boolean;
}

/** Pointer state polled natively: a non-key window gets no DOM hover. */
interface Pointer {
  inside: boolean;
  near: boolean;
  buttons: boolean;
  x: number;
  y: number;
}

/** Rest this long on the notch before it peeks; brushing past does nothing. */
const PEEK_DELAY_MS = 300;
const CLOSE_GRACE_MS: Record<Exclude<Stage, "idle">, number> = { peek: 250, open: 450 };
const REFRESH_MS = 60_000;
/** Width of each "ear" the peek adds beside the real notch. */
const EAR = 100;
const PANEL_WIDTH = 380;
const TAB = { width: 46, height: 14 };
const TAB_NEAR = { width: 64, height: 18 };
const PILL = { width: 250, height: 30 };
const MAX_ROWS = 6;

function centred(geometry: Geometry, width: number, height: number): Rect {
  const centre = geometry.notch.x + geometry.notch.width / 2;
  return { x: centre - width / 2, y: 0, width, height };
}

function shapeFor(stage: Stage, geometry: Geometry, near: boolean, panelHeight: number): Rect {
  const { notch, hasNotch } = geometry;
  if (stage === "open") return centred(geometry, PANEL_WIDTH, panelHeight);
  if (stage === "peek") {
    return hasNotch
      ? centred(geometry, notch.width + EAR * 2, notch.height)
      : centred(geometry, PILL.width, PILL.height);
  }
  if (hasNotch) return { ...notch };
  return near ? centred(geometry, TAB_NEAR.width, TAB_NEAR.height) : centred(geometry, TAB.width, TAB.height);
}

/** The clickable part of the canvas; everything else passes clicks through. */
function hotRectFor(stage: Stage, geometry: Geometry, panelHeight: number): Rect {
  // At rest, use the tab's approach size so the target doesn't move as it grows.
  const shape = shapeFor(stage, geometry, true, panelHeight);
  const pad = stage === "idle" ? 6 : 4;
  return {
    x: shape.x - pad,
    y: 0,
    width: shape.width + pad * 2,
    height: shape.height + (stage === "idle" && geometry.hasNotch ? 0 : 4),
  };
}

function ParachuteIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="4 4 52 52" aria-hidden className="landed-glyph">
      <path d="M6 26 A24 21 0 0 1 54 26 Q46 34 38 26 Q30 34 22 26 Q14 34 6 26 Z" fill="currentColor" />
      <path d="M16 27 L44 27 L34 46 L26 46 Z" fill="currentColor" />
      <rect x="24" y="45" width="12" height="9" rx="2" fill="currentColor" />
    </svg>
  );
}

function StatusIcon({ status }: { status: LandedStatus }) {
  if (status === "landed") {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden className="landed-status is-landed">
        <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === "failed") {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden className="landed-status is-failed">
        <path d="M8 2.5l6 10.5H2z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M8 6.5v3M8 11.4v.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
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
        <StatusIcon status="landed" />
        All in
      </>
    );
  }
  return <span className="landed-muted">Nothing yet</span>;
}

export default function LandedWindow() {
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [near, setNear] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [rows, setRows] = useState<LandedRow[]>([]);
  const [panelHeight, setPanelHeight] = useState(160);
  const panelRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage>("idle");
  const pointerRef = useRef<Pointer | null>(null);
  const peekTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);

  const go = useCallback((next: Stage) => {
    stageRef.current = next;
    setStage(next);
    if (next !== "open") setHoverId(null);
  }, []);

  const clearTimers = useCallback(() => {
    window.clearTimeout(peekTimer.current);
    window.clearTimeout(closeTimer.current);
    peekTimer.current = undefined;
    closeTimer.current = undefined;
  }, []);

  const open = useCallback(() => {
    clearTimers();
    go("open");
  }, [clearTimers, go]);

  const refresh = useCallback(async () => {
    try {
      const captures = await listCapturesToday(50);
      setRows(captures.map(toLandedRow));
    } catch (error) {
      console.error("Landed: could not load today's captures", error);
    }
  }, []);

  useEffect(() => {
    const onPointer = (pointer: Pointer) => {
      const previous = pointerRef.current;
      pointerRef.current = pointer;
      setNear(pointer.near);
      const current = stageRef.current;

      if (!pointer.inside) {
        window.clearTimeout(peekTimer.current);
        peekTimer.current = undefined;
        setHoverId(null);
        if (current !== "idle" && closeTimer.current === undefined) {
          closeTimer.current = window.setTimeout(() => {
            closeTimer.current = undefined;
            go("idle");
          }, CLOSE_GRACE_MS[current]);
        }
        return;
      }

      window.clearTimeout(closeTimer.current);
      closeTimer.current = undefined;

      // A press that starts on the shape is a click, even if WebKit drops it
      // (the window is never key).
      if (pointer.buttons && previous?.inside && !previous.buttons && current !== "open") {
        open();
        return;
      }

      if (current === "open") {
        const row = document.elementFromPoint(pointer.x, pointer.y)?.closest<HTMLElement>("[data-row]");
        setHoverId(row?.dataset.row ?? null);
        return;
      }

      // Never trigger mid-drag: only a still pointer with no button held peeks.
      if (current === "idle") {
        if (pointer.buttons) {
          window.clearTimeout(peekTimer.current);
          peekTimer.current = undefined;
        } else if (peekTimer.current === undefined) {
          peekTimer.current = window.setTimeout(() => {
            peekTimer.current = undefined;
            const latest = pointerRef.current;
            if (latest?.inside && !latest.buttons && stageRef.current === "idle") go("peek");
          }, PEEK_DELAY_MS);
        }
      }
    };

    const unlisteners = [
      listen<Pointer>("landed://pointer", (event) => onPointer(event.payload)),
      listen<Geometry>("landed://geometry", (event) => setGeometry(event.payload)),
      listen("landed://escape", () => {
        clearTimers();
        go("idle");
      }),
    ];
    invoke<Geometry>("landed_geometry")
      .then(setGeometry)
      .catch((error) => console.error("Landed: no geometry", error));

    return () => {
      clearTimers();
      unlisteners.forEach((pending) => void pending.then((unlisten) => unlisten()));
    };
  }, [clearTimers, go, open]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    if (stage !== "idle") void refresh();
  }, [stage, refresh]);

  const panelTop = geometry?.hasNotch ? geometry.notch.height : 10;

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || !geometry) return;
    setPanelHeight(Math.min(Math.ceil(panelTop + panel.offsetHeight + 8), geometry.height - 24));
  }, [rows, geometry, panelTop]);

  useEffect(() => {
    if (!geometry) return;
    const hot = hotRectFor(stage, geometry, panelHeight);
    void invoke("landed_set_hot_rect", { ...hot, expanded: stage !== "idle" }).catch((error) =>
      console.error("Landed: could not set hot rect", error),
    );
  }, [geometry, stage, panelHeight]);

  if (!geometry) return null;

  const counts = countLanded(rows);
  const shape = shapeFor(stage, geometry, near, panelHeight);
  const peekWidth = geometry.hasNotch ? geometry.notch.width + EAR * 2 : PILL.width;
  const peekHeight = geometry.hasNotch ? geometry.notch.height : PILL.height;
  const shapeStyle: CSSProperties = { left: shape.x, width: shape.width, height: shape.height };
  const peekStyle = {
    width: peekWidth,
    height: peekHeight,
    "--ear": `${EAR}px`,
    "--gap": `${geometry.notch.width}px`,
  } as CSSProperties;

  return (
    <div
      className="landed"
      data-stage={stage}
      data-notch={geometry.hasNotch ? "real" : "virtual"}
      data-near={near ? "" : undefined}
    >
      <div className="landed-shape" style={shapeStyle} onMouseDown={stage === "open" ? undefined : open}>
        <div className="landed-clip">
          {!geometry.hasNotch && (
            <div className="landed-tab">
              <ParachuteIcon size={near ? 13 : 11} />
              {near && counts.failed > 0 && <span className="landed-dot is-failed" />}
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
                    <span className="landed-row-text">{row.text}</span>
                    <span className="landed-row-where">{row.status === "failed" ? "Fix" : row.where}</span>
                  </li>
                ))}
              </ul>
            )}
            {rows.length > MAX_ROWS && (
              <p className="landed-more">+{rows.length - MAX_ROWS} more in the Library</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
