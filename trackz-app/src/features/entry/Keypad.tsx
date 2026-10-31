interface KeypadProps {
  onDigit: (digit: string) => void;
  onDelete: () => void;
}

const ROWS: readonly (readonly string[])[] = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["", "0", "⌫"],
];

/**
 * 3x4 numeric keypad for the quick-entry sheet's ATM cent accumulator
 * (see features/entry/amount.ts for why there's no decimal key). The
 * bottom-left cell is intentionally blank — the old app's attempt at a
 * dense button grid (.icon-button at 36px) was below Apple's 44px HIG
 * minimum; every key here is a full touch-target-min square instead of
 * cramming in an unused symbol.
 */
export function Keypad({ onDigit, onDelete }: KeypadProps) {
  return (
    <div class="keypad">
      {ROWS.flat().map((key, i) => {
        if (key === "") return <div key={`blank-${i}`} class="keypad__key keypad__key--blank" />;
        if (key === "⌫") {
          return (
            <button
              key="delete"
              type="button"
              class="keypad__key keypad__key--delete"
              onClick={onDelete}
              aria-label="Delete last digit"
            >
              ⌫
            </button>
          );
        }
        return (
          <button
            key={key}
            type="button"
            class="keypad__key"
            onClick={() => onDigit(key)}
            aria-label={`Digit ${key}`}
          >
            {key}
          </button>
        );
      })}
    </div>
  );
}
