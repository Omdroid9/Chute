import { useMemo, useState } from "react";
import type { Capture } from "../../types";
import {
  DESTINATIONS,
  destinationCode,
  destinationLabel,
  formatRelative,
  parseAgentAction,
  syncStatusFor,
} from "./libraryShared";
import { parseStoredTimestamp } from "../../lib/timestamps";
import SyncErrorNotice from "../SyncErrorNotice";

interface Props {
  capture: Capture | null;
  lists: { name: string; count: number }[];
  actionBusy: string | null;
  onRetry: (capture: Capture) => void;
  onReassignList: (capture: Capture, list: string) => void;
  onOpenSettings: () => void;
}

export default function LibraryCaptureDetail({
  capture,
  lists,
  actionBusy,
  onRetry,
  onReassignList,
  onOpenSettings,
}: Props) {
  const [reassignOpen, setReassignOpen] = useState(false);

  const agent = useMemo(() => parseAgentAction(capture), [capture]);
  if (!capture) {
    return (
      <aside className="library-detail-pane library-detail-empty">
        <p className="library-detail-empty-eyebrow label-micro">Capture</p>
        <p className="library-detail-empty-title">
          Pick a capture <span className="font-serif-italic">to see why</span>
        </p>
        <p className="library-detail-empty-hint">
          The detail pane shows the full content, where it went, and why the
          agent chose those destinations.
        </p>
      </aside>
    );
  }

  const created = parseStoredTimestamp(capture.created_at);
  const isBusy = (key: string) => actionBusy === `${key}:${capture.id}`;
  const destinations = DESTINATIONS.map((dest) => ({
    dest,
    label: destinationLabel(dest),
    status: syncStatusFor(capture, dest),
  })).filter((d) => d.status !== "off");
  const allFailed = destinations.length > 0 && destinations.every((d) => d.status === "failed");

  return (
    <aside className="library-detail-pane">
      <section className="library-detail-section">
        <header className="library-detail-eyebrow">
          <span className="label-micro">Capture</span>
          <span className="library-detail-time font-mono">
            <time
              dateTime={capture.created_at}
              title={created.toLocaleString()}
            >
              {formatRelative(capture.created_at)}
            </time>
          </span>
        </header>
        <p className="library-detail-content">{capture.content}</p>
        <div className="library-detail-pills">
          <span className="library-pill" data-tag={capture.tag}>
            <span className="library-pill-dot" />
            {capture.tag === "untagged" ? "untagged" : capture.tag}
          </span>
          <span className="library-pill" data-lane={capture.capture_lane}>
            {capture.capture_lane === "focus" ? "Focus" : "Distraction"}
          </span>
          <span className="library-pill">{capture.list_name}</span>
          {capture.reminder_time ? (
            <span className="library-pill library-pill-accent font-mono">
              {capture.reminder_time}
            </span>
          ) : null}
        </div>
      </section>

      <hr className="library-divider" />

      <section className="library-detail-section">
        <header className="library-detail-section-head">
          <h3 className="label-micro">Where it went</h3>
        </header>
        {destinations.length === 0 ? (
          <p className="library-detail-empty-text">
            No destinations were targeted. Open the capture overlay and pick
            one, or set defaults in settings.
          </p>
        ) : (
          <ul className="library-dest-detail">
            {destinations.map(({ dest, label, status }) => (
              <li key={dest} className="library-dest-detail-row">
                <span className="library-dest-glyph" data-status={status}>
                  {destinationCode(dest)}
                </span>
                <span className="library-dest-detail-label">{label}</span>
                <span
                  className="library-dest-detail-status"
                  data-status={status}
                >
                  {status === "synced"
                    ? "Synced"
                    : status === "queued"
                      ? "Queued"
                      : "Failed"}
                </span>
              </li>
            ))}
          </ul>
        )}
        {capture.last_sync_error ? (
          <div className="library-error-card">
            <span className="label-micro" data-tone="danger">
              Last error
            </span>
            <div className="library-error-text">
              <SyncErrorNotice
                error={capture.last_sync_error}
                messageClassName="library-error-message"
                buttonClassName="library-btn library-btn-soft mt-2 block"
              />
            </div>
          </div>
        ) : null}
      </section>

      <hr className="library-divider" />

      <section className="library-detail-section">
        <header className="library-detail-section-head">
          <h3 className="label-micro">
            Why the agent <span className="font-serif-italic">chose this</span>
          </h3>
        </header>
        <div className="library-agent-card">
          <div className="library-agent-card-head">
            <span className="library-agent-intent">
              {agent.intent ?? "No agent decision yet"}
            </span>
            <span className="library-agent-confidence font-mono">
              {agent.confidence === null
                ? capture.agent_status === "queued"
                  ? "Queued…"
                  : "—"
                : `${Math.round(agent.confidence * 100)}% confident`}
            </span>
          </div>
          <p className="library-agent-reasoning">
            {agent.reasoning ??
              (capture.agent_status === "queued"
                ? "The agent will pick this up on the next pass — usually within a minute."
                : capture.agent_error
                  ? capture.agent_error
                  : "No reasoning captured. The router used your default destinations.")}
          </p>
          {agent.actions.length > 0 ? (
            <ul className="library-agent-actions">
              {agent.actions.map((action, idx) => (
                <li key={`${action}-${idx}`} className="library-agent-action">
                  {action}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>

      <hr className="library-divider" />

      <section className="library-detail-actions">
        {capture.last_sync_error || allFailed ? (
          <button
            type="button"
            className="library-btn library-btn-primary"
            onClick={() => onRetry(capture)}
            disabled={isBusy("retry")}
          >
            {isBusy("retry") ? "Retrying…" : "Retry sync"}
          </button>
        ) : null}
        <button
          type="button"
          className="library-btn library-btn-soft"
          onClick={() => setReassignOpen((open) => !open)}
        >
          {reassignOpen ? "Cancel" : "Move list"}
        </button>
        <button
          type="button"
          className="library-btn library-btn-ghost"
          onClick={onOpenSettings}
        >
          Open settings
        </button>
      </section>

      {reassignOpen ? (
        <div className="library-reassign-grid">
          {lists.map((list) => (
            <button
              key={list.name}
              type="button"
              className="library-reassign-chip"
              data-active={list.name === capture.list_name ? "true" : undefined}
              disabled={isBusy("list") || list.name === capture.list_name}
              onClick={() => {
                onReassignList(capture, list.name);
                setReassignOpen(false);
              }}
            >
              {list.name}
              <span className="tabular library-reassign-count">{list.count}</span>
            </button>
          ))}
        </div>
      ) : null}
    </aside>
  );
}
