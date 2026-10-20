import { useMemo } from "react";
import type { Capture } from "../../types";
import type { LibraryView } from "./LibrarySidebar";
import DestinationChips from "./DestinationChips";
import { formatRelative } from "./libraryShared";
import { parseStoredTimestamp } from "../../lib/timestamps";

interface Props {
  captures: Capture[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  view: LibraryView;
  totalCount: number;
}

const VIEW_TITLES: Record<string, string> = {
  all: "All captures",
  today: "Today",
  week: "This week",
  review: "Pending review",
  failed: "Sync failed",
};

export default function LibraryCaptureList({
  captures,
  loading,
  selectedId,
  onSelect,
  view,
  totalCount,
}: Props) {
  const title = useMemo(() => {
    if (view.kind === "list") return view.id;
    if (view.kind === "tag") return capitalize(view.id);
    return VIEW_TITLES[view.id] ?? "Captures";
  }, [view]);

  const subtitle = useMemo(() => {
    if (view.kind === "smart" && view.id === "all") {
      return `${totalCount} total · sorted by newest`;
    }
    return `${captures.length} of ${totalCount} · sorted by newest`;
  }, [view, captures.length, totalCount]);

  return (
    <section className="library-list-pane">
      <header className="library-list-header">
        <div className="library-list-header-text">
          <div className="library-list-header-eyebrow">
            <span className="label-micro">
              {view.kind === "list" ? "List" : view.kind === "tag" ? "Tag" : "View"}
            </span>
          </div>
          <h2 className="library-list-title">
            {view.kind === "list" || view.kind === "tag" ? (
              <>
                {view.kind === "list" ? "" : "Tagged "}
                <span className="font-serif-italic">{title}</span>
              </>
            ) : view.id === "review" ? (
              <>
                Pending <span className="font-serif-italic">review</span>
              </>
            ) : view.id === "failed" ? (
              <>
                Sync <span className="font-serif-italic">failed</span>
              </>
            ) : (
              title
            )}
          </h2>
          <p className="library-list-subtitle">{subtitle}</p>
        </div>
      </header>

      <div className="library-list-scroll">
        {loading && captures.length === 0 ? (
          <div className="library-empty">
            <p className="library-empty-title">Loading captures…</p>
          </div>
        ) : captures.length === 0 ? (
          <div className="library-empty">
            <p className="library-empty-title">
              {view.kind === "smart" && view.id === "failed"
                ? "Nothing failing — beautifully boring."
                : view.kind === "smart" && view.id === "review"
                  ? "Everything is routed. The agent is content."
                  : "Nothing here yet."}
            </p>
            <p className="library-empty-hint">
              {view.kind === "smart" && view.id === "all"
                ? "Press your capture hotkey to add the first one."
                : "Try another view or clear the search."}
            </p>
          </div>
        ) : (
          <ul className="library-rows" role="list">
            {captures.map((capture) => (
              <li key={capture.id}>
                <button
                  type="button"
                  className="library-row"
                  data-active={capture.id === selectedId ? "true" : undefined}
                  data-tag={capture.tag}
                  onClick={() => onSelect(capture.id)}
                >
                  <header className="library-row-meta">
                    <time
                      className="font-mono library-row-time"
                      dateTime={capture.created_at}
                      title={parseStoredTimestamp(capture.created_at).toLocaleString()}
                    >
                      {formatRelative(capture.created_at)}
                    </time>
                    <span className="library-row-dot" />
                    <span className="library-row-list">{capture.list_name}</span>
                    <span className="library-row-flex" />
                    {capture.last_sync_error ? (
                      <span className="library-row-flag" data-tone="danger">
                        Sync failed
                      </span>
                    ) : capture.agent_needs_review ? (
                      <span className="library-row-flag" data-tone="warn">
                        Review
                      </span>
                    ) : null}
                  </header>
                  <p className="library-row-content">{capture.content}</p>
                  <footer className="library-row-footer">
                    <DestinationChips capture={capture} compact />
                    {capture.reminder_time ? (
                      <span className="library-row-reminder font-mono">
                        {capture.reminder_time}
                      </span>
                    ) : null}
                  </footer>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
