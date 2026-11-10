import { Delete } from "@/components/icons";
import { KEYPAD_KEYS } from "@/features/entry/keypadKeys";

interface KeypadProps {
  onDigit: (digit: string) => void;
  onDelete: () => void;
}

/**
 * 3x4 numeric keypad for the quick-entry sheet's ATM cent accumulator
 * (see features/entry/amount.ts for why there's no decimal key). The
 * bottom-left cell is intentionally blank — the old app's attempt at a
 * dense button grid (.icon-button at 36px) was below Apple's 44px HIG
 * minimum; every key here is a full touch-target-min square instead of
 * cramming in an unused symbol.
 *
 * Routes on key.kind, never on what the key displays (features/entry/keypadKeys.ts).
 */
export function Keypad({ onDigit, onDelete }: KeypadProps) {
  return (
    <div class="keypad">
      {KEYPAD_KEYS.map((key, i) => {
        if (key.kind === "blank") return <div key={`blank-${i}`} class="keypad__key keypad__key--blank" />;
        if (key.kind === "delete") {
          return (
            <button
              key="delete"
              type="button"
              class="keypad__key keypad__key--delete"
              onClick={onDelete}
              aria-label="Delete last digit"
            >
              <Delete size="1em" />
            </button>
          );
        }
        return (
          <button
            key={key.digit}
            type="button"
            class="keypad__key"
            onClick={() => onDigit(key.digit)}
            aria-label={`Digit ${key.digit}`}
          >
            {key.digit}
          </button>
        );
      })}
    </div>
  );
}
