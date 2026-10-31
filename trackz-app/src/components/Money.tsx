import type { Cents } from "@/domain/money";
import { formatEUR } from "@/domain/money";

interface MoneyProps {
  cents: Cents;
  class?: string;
  /** Prefix a + for positive amounts (useful in delta contexts). Default off. */
  signed?: boolean;
}

/** Renders integer cents as a tabular-figure EUR string. The only place formatEUR should be called from JSX. */
export function Money({ cents, class: className, signed }: MoneyProps) {
  const text = formatEUR(cents);
  const prefixed = signed && cents > 0 ? `+${text}` : text;
  return <span class={`tnum ${className ?? ""}`}>{prefixed}</span>;
}
