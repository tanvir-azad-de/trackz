import { parseTransactionsCsv } from "@/storage/csv";
import { replaceAllTransactions, isEmpty } from "@/storage/repository";

/**
 * Dev convenience only: loads the real anonymized-ish CSV backup into
 * localStorage on first run so Home/Activity/Accounts have real data to
 * render against during development. Guarded by import.meta.env.DEV so
 * it can never run in a production build — production users get the
 * real CSV import UI (Phase 13, see features/settings) or start from
 * zero transactions.
 *
 * seed-transactions.csv is gitignored (real financial data, see
 * trackz-app/.gitignore) — it is NOT present on a fresh clone or on
 * Vercel's build machine. A static `import "./seed-transactions.csv?raw"`
 * would make Vite/rolldown fail the WHOLE production build with a
 * "file not found" error the moment the file is missing, since static
 * imports are resolved at build time regardless of the DEV guard above.
 * import.meta.glob with eager:true resolves to an empty object instead
 * of erroring when there are zero matches, so the build succeeds with or
 * without the file — this is the one piece of plumbing that makes the
 * DEV guard above actually effective rather than theoretical.
 */
const seedModules = import.meta.glob("./seed-transactions.csv", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export function seedDevDataIfEmpty(): void {
  if (!import.meta.env.DEV) return;
  if (!isEmpty()) return;

  const seedCsv = Object.values(seedModules)[0];
  if (!seedCsv) {
    console.info("[dev seed] seed-transactions.csv not present — starting empty (this is expected on a fresh clone)");
    return;
  }

  const { transactions, errors } = parseTransactionsCsv(seedCsv);
  if (errors.length > 0) {
    console.warn(`[dev seed] ${errors.length} CSV rows failed to parse`, errors.slice(0, 5));
  }
  replaceAllTransactions(transactions);
  console.info(`[dev seed] loaded ${transactions.length} transactions from seed-transactions.csv`);
}
