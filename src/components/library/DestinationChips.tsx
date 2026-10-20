import type { Capture } from "../../types";
import { DESTINATIONS, destinationCode, destinationLabel, syncStatusFor } from "./libraryShared";

export default function DestinationChips({
  capture,
  compact,
}: {
  capture: Capture;
  compact?: boolean;
}) {
  const items = DESTINATIONS.map((dest) => ({
    dest,
    status: syncStatusFor(capture, dest),
  })).filter((d) => d.status !== "off");

  if (items.length === 0) {
    return <span className="library-row-empty-dest">No destination</span>;
  }
  return (
    <span className="library-chip-row">
      {items.map(({ dest, status }) => (
        <span
          key={dest}
          className="library-dest-chip"
          data-status={status}
          data-compact={compact ? "true" : undefined}
          title={`${destinationLabel(dest)} · ${status}`}
        >
          {destinationCode(dest)}
        </span>
      ))}
    </span>
  );
}
