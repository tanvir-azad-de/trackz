import { parseTransactionsCsv } from "@/storage/csv";
import { replaceAllTransactions, isEmpty } from "@/storage/repository";
// Vite raw import — dev-only convenience. The real CSV import flow is
// Phase 13 (Settings). This module must never be imported from
// production code paths (see guard in seedDevDataIfEmpty).
import seedCsv from "./seed-transactions.csv?raw";

/**
 * Dev convenience only: loads the real anonymized-ish CSV backup into
 * localStorage on first run so Home/Activity/Accounts have real data to
 * render against during development. Guarded by import.meta.env.DEV so
 * it can never run in a production build — production users get the
 * real CSV import UI (Phase 13) or start from zero transactions.
 */
export function seedDevDataIfEmpty(): void {
  if (!import.meta.env.DEV) return;
  if (!isEmpty()) return;

  const { transactions, errors } = parseTransactionsCsv(seedCsv);
  if (errors.length > 0) {
    console.warn(`[dev seed] ${errors.length} CSV rows failed to parse`, errors.slice(0, 5));
  }
  replaceAllTransactions(transactions);
  console.info(`[dev seed] loaded ${transactions.length} transactions from seed-transactions.csv`);
}
