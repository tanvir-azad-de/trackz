import { useMemo, useRef, useState } from "preact/hooks";
import { useTransactions } from "@/storage/useTransactions";
import { useAccountTypes } from "@/storage/useAccountTypes";
import { setAccountType } from "@/storage/accountTypes";
import { deriveAccounts, getAllAccountBalances } from "@/storage/derive";
import type { AccountType } from "@/domain/transaction";
import { getLocalToday } from "@/domain/dates";
import { Card } from "@/components/Card";
import { Money } from "@/components/Money";
import { Sheet } from "@/components/Sheet";
import type { ToastState } from "@/components/Toast";
import { buildExportCsv, canCommit, exportFileName, previewImport, type ImportPreview } from "@/features/settings/exportImport";
import { commitImport } from "@/features/settings/commitImport";
import { planMerge } from "@/features/settings/merchantMerge";
import { planCategoryRename } from "@/features/settings/categoryRename";
import { MerchantMergeSheet, countDuplicateMerchantGroups } from "@/features/settings/MerchantMergeSheet";
import { CategoriesSheet, countCategories } from "@/features/settings/CategoriesSheet";
import { updateTransactions } from "@/storage/repository";
import { SyncSettings, describeStatus } from "@/features/settings/SyncSettings";
import { useSyncStatus } from "@/storage/useSyncStatus";
import { isSyncConfigured } from "@/sync/auth";
import { ChevronRight } from "@/components/icons";
import "./SettingsScreen.css";
import "@/components/Sheet.css";

interface SettingsScreenProps {
  onToast?: (toast: ToastState) => void;
}

const ACCOUNT_TYPE_OPTIONS: Array<{ value: AccountType; label: string }> = [
  { value: "cash", label: "Cash" },
  { value: "investment", label: "Investment" },
];

/**
 * Settings (Phase 13a): account-type classification (Cash/Investment)
 * plus a Data section for CSV export/import — the piece that makes the
 * rebuild actually usable outside dev, since src/dev/seed.ts is the
 * ONLY way real data reaches this app otherwise, and that path is
 * explicitly disabled in production builds (import.meta.env.DEV guard).
 * Categories (Phase 13b): rename, which merges when the target name
 * already exists — see CategoriesSheet.tsx for why that is one
 * operation and why there is no delete. The guided merchant-merge
 * screen is Phase 6 part 2, below it.
 *
 * Account types: each account gets a Cash/Investment segmented toggle.
 * Changes are immediate (no draft + Apply like FilterSheet) — unlike a
 * multi-facet filter, there's exactly one meaningful value per account
 * at a time, so a confirm step would just be friction. An undo-able
 * toast (reusing the same Toast primitive Phase 8/11 use for
 * save/delete) is the safety net instead of a draft step.
 *
 * Data: export serializes every transaction to this app's own CSV
 * format (storage/csv.ts's CSV_HEADERS_V3 — the legacy 10 columns plus
 * id/createdAt/updatedAt/deletedAt, so a round trip is lossless, unlike
 * the original backup format). Deleted transactions are never included
 * here (useTransactions() already filters tombstones) — this is a
 * human-facing backup, and a "deleted" row reappearing in a CSV someone
 * opens in a spreadsheet would look like a bug, not a feature. Import is
 * a preview-then-confirm flow, never a
 * silent commit: replaceAllTransactions() (storage/repository.ts)
 * destroys whatever is currently stored, so the preview shows parse
 * errors, derived account/category/merchant counts, and the resulting
 * Liquid/Total figures BEFORE the user can confirm — reusing Sheet
 * (Phase 8/11/13's shared bottom-sheet primitive) rather than a new
 * modal concept. If the store is non-empty, the confirm button is
 * disabled until the user has exported first, so "I imported the
 * wrong file and lost everything" requires skipping an explicit
 * warning, not just missing a small one.
 */
export function SettingsScreen({ onToast }: SettingsScreenProps) {
  const transactions = useTransactions();
  const accountTypesMap = useAccountTypes();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [exporting, setExporting] = useState(false);
  // Gate on "exported since the store last had data", not just "ever
  // exported" — reset whenever new data is committed (import, or any
  // ordinary transaction write) so a second import later in the same
  // session can't skip the safety step by riding a stale true value.
  const [exportedSinceLastChange, setExportedSinceLastChange] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [openSection, setOpenSection] = useState<"accountTypes" | "sync" | "data" | null>(null);
  const syncState = useSyncStatus();

  const duplicateGroupCount = useMemo(() => countDuplicateMerchantGroups(transactions), [transactions]);
  const categoryCount = useMemo(() => countCategories(transactions), [transactions]);

  const accounts = useMemo(() => {
    const names = deriveAccounts(transactions).map((a) => a.name);
    const balances = getAllAccountBalances(transactions);
    return names.map((name) => ({
      name,
      balanceCents: balances[name] ?? 0,
      accountType: accountTypesMap[name] ?? "cash",
    }));
  }, [transactions, accountTypesMap]);

  function handleChange(account: string, type: AccountType) {
    const previous = accountTypesMap[account] ?? "cash";
    if (previous === type) return;
    setAccountType(account, type);
    onToast?.({
      id: Date.now(),
      message: `${account} set to ${type === "cash" ? "Cash" : "Investment"}`,
      actionLabel: "Undo",
      onAction: () => setAccountType(account, previous),
    });
  }

  /**
   * Blob + synthetic <a download> — the standard pattern, but iOS Safari
   * has historically been unreliable with it (silent no-op in some
   * versions/contexts). navigator.canShare({ files }) lets a real iOS
   * share sheet take over when available, which is the more reliable
   * path on the one platform this app actually ships to; the anchor is
   * the fallback for desktop/Android where share-with-files support is
   * patchier. This download path has NOT been verified on a real
   * iPhone yet — flagged for the Step 5 device pass.
   */
  async function handleExport() {
    setExporting(true);
    try {
      const csv = buildExportCsv(transactions);
      const fileName = exportFileName(getLocalToday());
      const file = new File([csv], fileName, { type: "text/csv" });

      const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean; share?: (data: { files: File[] }) => Promise<void> };
      if (nav.canShare?.({ files: [file] }) && nav.share) {
        await nav.share({ files: [file] });
        setExportedSinceLastChange(true);
        return;
      }

      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onToast?.({ id: Date.now(), message: `Exported ${transactions.length} transactions to ${fileName}` });
      setExportedSinceLastChange(true);
    } catch (err) {
      // AbortError means the user cancelled the share sheet — not a
      // real failure, don't show an error toast for it.
      if (err instanceof Error && err.name === "AbortError") return;
      onToast?.({ id: Date.now(), message: "Export failed — see console for details" });
      console.error("[export] failed", err);
    } finally {
      setExporting(false);
    }
  }

  async function handleFileSelected(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    // Close Data before the preview opens so two sheets never stack (two
    // backdrops, and Escape would only close the top one). The file input
    // lives OUTSIDE the Data sheet for the same reason: the sheet unmounts
    // its children while closed, and this handler runs after the picker.
    setOpenSection(null);
    setImportPreview(previewImport(file.name, text, accountTypesMap));
    input.value = ""; // allow re-selecting the same file name later
  }

  /**
   * Commit the previewed import.
   *
   * Delegates to commitImport() rather than calling
   * replaceAllTransactions() directly: with Drive connected, a plain
   * local replace was undone ~5 seconds later by the debounced union
   * merge, so "Replace anyway" did not replace. See commitImport.ts.
   */
  async function handleConfirmImport() {
    if (!importPreview || !canCommit(importPreview)) return;

    const { transactions: imported, fileName } = importPreview;
    // Close the sheet first: the Drive overwrite is a network round trip,
    // and leaving the preview open behind a spinner invites a second tap.
    setImportPreview(null);
    setExportedSinceLastChange(false);

    const result = await commitImport(imported);

    const summary = `Imported ${imported.length} transactions from ${fileName}`;
    onToast?.({
      id: Date.now(),
      message:
        result.kind === "local-but-drive-failed"
          ? // Name the recovery rather than just reporting failure: Drive
            // still holds the old copy and nothing will retry on its own.
            `${summary} on this device, but Google Drive still holds the old copy. Use "Replace Drive copy with this device" in Sync settings.`
          : summary,
    });
  }

  const hasExistingData = transactions.length > 0;
  const importBlockedByUnexportedData = hasExistingData && !exportedSinceLastChange;

  /**
   * Apply a merchant merge.
   *
   * planMerge is pure and returns only the rows that actually change, so
   * a group where every row already carries the canonical name writes
   * nothing at all — no pointless sync round trip. The write goes
   * through updateTransactions() (one write, one notify, one armed
   * debounce) rather than a loop over updateTransaction().
   *
   * Undo restores the PREVIOUS merchant name per row rather than a
   * single name, because a merge collapses several spellings at once and
   * a blanket revert would flatten them all to one of them — which is
   * the very thing being undone.
   */
  function handleMerge(variants: string[], canonical: string): number {
    const plan = planMerge(transactions, variants, canonical);
    if (plan.changed.length === 0) return 0;

    const before = plan.changed.map((row) => {
      const original = transactions.find((t) => t.id === row.id)!;
      return { ...original };
    });

    updateTransactions(plan.changed);

    onToast?.({
      id: Date.now(),
      message: `Renamed ${plan.changed.length} ${plan.changed.length === 1 ? "row" : "rows"} to "${plan.canonical}"`,
      actionLabel: "Undo",
      onAction: () => updateTransactions(before),
    });

    return plan.changed.length;
  }

  /**
   * Apply a category rename (which merges when the target already
   * exists). Mirrors handleMerge above, including the per-row Undo:
   * restoring one blanket name would be wrong for the same reason it is
   * there — though for categories a rename has a single source name, so
   * the per-row snapshot is defence in depth rather than load-bearing.
   * Kept identical anyway so the two paths cannot drift.
   */
  function handleRenameCategory(from: string, to: string): number {
    const plan = planCategoryRename(transactions, from, to);
    if (plan.changed.length === 0) return 0;

    const before = plan.changed.map((row) => {
      const original = transactions.find((t) => t.id === row.id)!;
      return { ...original };
    });

    updateTransactions(plan.changed);

    const rows = `${plan.changed.length} ${plan.changed.length === 1 ? "row" : "rows"}`;
    onToast?.({
      id: Date.now(),
      message: plan.isMerge
        ? `Moved ${rows} into "${plan.canonical}"`
        : `Renamed ${rows} to "${plan.canonical}"`,
      actionLabel: "Undo",
      onAction: () => updateTransactions(before),
    });

    return plan.changed.length;
  }

  return (
    <main class="settings-screen">
      {/* One row per section, each opening its own Sheet (user decision
          2026-11-10). The rows carry a count or status so the page still
          answers "anything to do here?" without opening each one. */}
      <div class="settings-rows">
        <SettingsRow label="Account types" detail={String(accounts.length)} onClick={() => setOpenSection("accountTypes")} />
        <SettingsRow
          label="Sync"
          detail={isSyncConfigured() ? describeStatus(syncState.status) : "unavailable"}
          onClick={() => setOpenSection("sync")}
        />
        <SettingsRow label="Categories" detail={String(categoryCount)} onClick={() => setCategoriesOpen(true)} />
        <SettingsRow
          label="Merchants"
          detail={duplicateGroupCount === 0 ? "" : `${duplicateGroupCount} to review`}
          onClick={() => setMergeOpen(true)}
        />
        <SettingsRow label="Data" detail={`${transactions.length} transactions`} onClick={() => setOpenSection("data")} />
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        class="settings-data-file-input"
        onChange={handleFileSelected}
      />

      <Sheet open={openSection === "accountTypes"} onClose={() => setOpenSection(null)} title="Account types">
        <p class="settings-screen__hint">
          Cash accounts count toward Home's "Liquid" total. Investment accounts (like a brokerage account) are
          tracked separately, since their balance isn't spendable cash.
        </p>

        {accounts.length === 0 ? (
          <p class="settings-screen__empty">No accounts yet. Tap the + button to log your first transaction.</p>
        ) : (
          <div class="settings-account-list">
            {accounts.map((acc) => (
              <Card class="settings-account-card" key={acc.name}>
                <div class="settings-account-card__row">
                  <div class="settings-account-card__identity">
                    <div class="settings-account-card__name">{acc.name}</div>
                    <Money cents={acc.balanceCents} class="settings-account-card__balance" />
                  </div>
                  <div class="settings-account-card__toggle" role="radiogroup" aria-label={`${acc.name} account type`}>
                    {ACCOUNT_TYPE_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        role="radio"
                        aria-checked={acc.accountType === opt.value}
                        class={`settings-account-card__option ${
                          acc.accountType === opt.value ? "settings-account-card__option--active" : ""
                        }`}
                        onClick={() => handleChange(acc.name, opt.value)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Sheet>

      <Sheet open={openSection === "sync"} onClose={() => setOpenSection(null)} title="Sync">
        <SyncSettings onToast={onToast} />
      </Sheet>

      <Sheet open={openSection === "data"} onClose={() => setOpenSection(null)} title="Data">
        <p class="settings-screen__hint">
          Export a CSV backup of every transaction, or import one to replace what's currently stored. Importing is
          all-or-nothing and overwrites your current data — review the preview carefully before confirming.
        </p>
        <div class="settings-data-actions">
          <button type="button" class="settings-data-button" onClick={handleExport} disabled={exporting || transactions.length === 0}>
            {exporting ? "Exporting…" : `Export ${transactions.length} transactions`}
          </button>
          <button type="button" class="settings-data-button" onClick={() => fileInputRef.current?.click()}>
            Import from CSV
          </button>
        </div>
      </Sheet>

      <Sheet open={importPreview !== null} onClose={() => setImportPreview(null)} title="Import preview">
        {importPreview && (
          <div class="import-preview">
            <p class="import-preview__file">{importPreview.fileName}</p>

            {importPreview.errors.length > 0 ? (
              <div class="import-preview__errors">
                <p class="import-preview__errors-summary">
                  {importPreview.errors.length} of {importPreview.totalRows} rows failed to parse. Nothing has been
                  imported — fix the file and try again.
                </p>
                <ul class="import-preview__error-list">
                  {importPreview.errorPreview.map((err, i) => (
                    <li key={i}>
                      Line {err.line}: {err.message}
                    </li>
                  ))}
                </ul>
                <button type="button" class="import-preview__cancel" onClick={() => setImportPreview(null)}>
                  Close
                </button>
              </div>
            ) : importPreview.validCount === 0 ? (
              <>
                <p class="import-preview__errors-summary">This file has no transaction rows — nothing to import.</p>
                <button type="button" class="import-preview__cancel" onClick={() => setImportPreview(null)}>
                  Close
                </button>
              </>
            ) : (
              <>
                <ul class="import-preview__summary">
                  <li>{importPreview.validCount} transactions</li>
                  <li>{importPreview.accountCount} accounts</li>
                  <li>{importPreview.categoryCount} categories</li>
                  <li>{importPreview.merchantCount} merchants</li>
                </ul>
                <div class="import-preview__totals">
                  <div>
                    <span>Liquid</span>
                    <Money cents={importPreview.liquidCashCents} />
                  </div>
                  <div>
                    <span>Total assets</span>
                    <Money cents={importPreview.totalAssetsCents} />
                  </div>
                </div>

                {importBlockedByUnexportedData && (
                  <p class="import-preview__warning">
                    This will permanently replace your current {transactions.length} transactions. Export a backup
                    first, or confirm below if you're sure.
                  </p>
                )}

                {/* Phase 13b. Not a hypothetical: transaction ids are
                    derived from row CONTENT including category and
                    merchant (domain/id.ts), and are minted at CSV parse
                    time. So an OLD backup's rows still carry the ids of
                    their pre-rename names and match the stored rows,
                    reverting the rename. A V3 export taken after
                    renaming carries an explicit id column and the new
                    names, so it round-trips correctly. */}
                <p class="import-preview__note" role="note">
                  If you've renamed any categories or merged merchants, importing a backup made
                  <em> before</em> those changes will undo them. A backup exported from this app
                  afterwards is unaffected.
                </p>

                <div class="import-preview__actions">
                  <button type="button" class="import-preview__cancel" onClick={() => setImportPreview(null)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    class="import-preview__confirm"
                    disabled={!canCommit(importPreview)}
                    onClick={handleConfirmImport}
                  >
                    {importBlockedByUnexportedData ? "Replace anyway" : "Import"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </Sheet>

      <CategoriesSheet
        open={categoriesOpen}
        onClose={() => setCategoriesOpen(false)}
        transactions={transactions}
        onRename={handleRenameCategory}
      />

      <MerchantMergeSheet
        open={mergeOpen}
        onClose={() => setMergeOpen(false)}
        transactions={transactions}
        onMerge={handleMerge}
      />
    </main>
  );
}

interface SettingsRowProps {
  label: string;
  /** Count or status shown before the chevron; "" shows nothing. */
  detail: string;
  onClick: () => void;
}

function SettingsRow({ label, detail, onClick }: SettingsRowProps) {
  return (
    <button type="button" class="settings-row" onClick={onClick}>
      <span class="settings-row__label">{label}</span>
      {detail && <span class="settings-row__detail">{detail}</span>}
      <ChevronRight size="1em" class="settings-row__chevron" />
    </button>
  );
}
