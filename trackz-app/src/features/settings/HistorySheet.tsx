import { Sheet } from "@/components/Sheet";
import { Money } from "@/components/Money";
import { formatDayLabel, getLocalToday } from "@/domain/dates";
import type { HistoryEvent } from "@/features/settings/history";
import "./NamesSheet.css";

interface HistorySheetProps {
  open: boolean;
  events: readonly HistoryEvent[];
  onClose: () => void;
  onSelect: (event: HistoryEvent) => void;
}

/**
 * Settings -> History (user request 2026-11-17): the last 10 Add / Edit
 * saves on this device, newest first. Rows reuse NamesSheet's look; the
 * meta line shows the transaction's own date, because that is the day a
 * tap opens in Activity (history.ts historyFilter).
 */
export function HistorySheet({ open, events, onClose, onSelect }: HistorySheetProps) {
  const today = getLocalToday();
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="History"
      footer={
        <button type="button" class="entry-form__save" onClick={onClose}>
          OK
        </button>
      }
    >
      {events.length === 0 ? (
        <p class="settings-screen__hint">Nothing added or edited on this device yet.</p>
      ) : (
        <ul class="names-sheet__list names-sheet__list--unbounded">
          {events.map((e) => (
            <li key={`${e.at}-${e.id}`}>
              <button type="button" class="names-sheet__row" onClick={() => onSelect(e)}>
                <span class="names-sheet__row-main">
                  <span class="names-sheet__row-name">{e.title}</span>
                  <span class="names-sheet__row-meta">
                    {e.kind === "added" ? "Added" : "Edited"} · {formatDayLabel(e.date, today)}
                  </span>
                </span>
                <span class="names-sheet__row-amount">
                  <Money cents={e.amountCents} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
