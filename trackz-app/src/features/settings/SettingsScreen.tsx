import { useMemo, useRef, useState } from "preact/hooks";
import { useTransactions } from "@/storage/useTransactions";
import { useAccountTypes } from "@/storage/useAccountTypes";
import { getLocalToday } from "@/domain/dates";
import { Money } from "@/components/Money";
import { Sheet } from "@/components/Sheet";
import type { ToastState } from "@/components/Toast";
import { buildExportCsv, canCommit, exportFileName, previewImport, type ImportPreview } from "@/features/settings/exportImport";
import { commitImport } from "@/features/settings/commitImport";
import type { NameField } from "@/features/settings/nameSummary";
import type { ActivityFilter } from "@/features/activity/filter";
import { emptyFilter } from "@/features/activity/filter";
import { NamesSheet, countNames } from "@/features/settings/NamesSheet";
import { SyncSettings, describeStatus } from "@/features/settings/SyncSettings";
import { useSyncStatus } from "@/storage/useSyncStatus";
import { isSyncConfigured } from "@/sync/auth";
import { ChevronRight } from "@/components/icons";
import "./SettingsScreen.css";
import "@/components/Sheet.css";

interface SettingsScreenProps {
  onToast?: (toast: ToastState) => void;
  /** Wired by app.tsx; a Categories/Merchants row opens Activity filtered to it. */
  onDrillDown?: (filter: ActivityFilter) => void;
}

/**
 * Settings (Phase 13a): a Data section for CSV export/import — the piece that makes the
 * rebuild actually usable outside dev, since src/dev/seed.ts is the
 * ONLY way real data reaches this app otherwise, and that path is
 * explicitly disabled in production builds (import.meta.env.DEV guard).
 * Categories (Phase 13b) and Merchants (2026-11-11): one shared list sheet
 * (NamesSheet.tsx); tapping a name opens Activity filtered to it. Rename
 * and the "Tidy up Merchants" merge screen were both removed 2026-11-11
 * (user decision).
 *
 * Account types have NO control here (user decision 2026-11-11, which
 * deleted the Cash/Investment toggle): the CSV's accountTypes config cell
 * is their source, set on import, written back on export.
 *
 * Data: export serializes every transaction to this app's own CSV
 * format (storage/csv.ts's CSV_HEADERS_V4 — the legacy 10 columns plus
 * id/createdAt/updatedAt/deletedAt and the accountTypes cell, so a round trip is lossless, unlike
 * the original backup format). Deleted transactions are never included
 * here (useTransactions() already filters tombstones) — this is a
 * human-facing backup, and a "deleted" row reappearing in a CSV someone
 * opens in a spreadsheet would look like a bug, not a feature. Import is
 * a preview-then-confirm flow, never a
 * silent commit: replaceAllTransactions() (storage/repository.ts)
 * destroys whatever is currently stored, so the preview shows parse
 * errors, derived account/category/merchant counts, and the resulting
 * Liquid figure BEFORE the user can confirm — reusing Sheet
 * (Phase 8/11/13's shared bottom-sheet primitive) rather than a new
 * modal concept. If the store is non-empty, the confirm button is
 * disabled until the user has exported first, so "I imported the
 * wrong file and lost everything" requires skipping an explicit
 * warning, not just missing a small one.
 */
export function SettingsScreen({ onToast, onDrillDown }: SettingsScreenProps) {
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
  // Field and open are separate so closing keeps the field: the sheet
  // animates out still showing what it showed, not flipping to Categories.
  const [namesField, setNamesField] = useState<NameField>("category");
  const [namesOpen, setNamesOpen] = useState(false);
  const [openSection, setOpenSection] = useState<"sync" | "data" | null>(null);
  const syncState = useSyncStatus();

  const categoryCount = useMemo(() => countNames(transactions, "category"), [transactions]);
  const merchantCount = useMemo(() => countNames(transactions, "merchant"), [transactions]);

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
      const csv = buildExportCsv(transactions, accountTypesMap);
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
    setImportPreview(previewImport(file.name, text));
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

    const { transactions: imported, fileName, accountTypes: importedTypes } = importPreview;
    // Close the sheet first: the Drive overwrite is a network round trip,
    // and leaving the preview open behind a spinner invites a second tap.
    setImportPreview(null);
    setExportedSinceLastChange(false);

    const result = await commitImport(imported, importedTypes);

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

  function openNames(field: NameField) {
    setNamesField(field);
    setNamesOpen(true);
  }

  /**
   * Category -> the exact `categories` facet. Merchant -> search text,
   * because ActivityFilter has no merchant facet; the same choice Debts
   * makes for a counterparty. Search also matches category, notes and
   * account, so a merchant name that appears in another row's notes pulls
   * that row in too.
   */
  function drillToName(field: NameField, name: string) {
    setNamesOpen(false);
    onDrillDown?.(field === "category" ? { ...emptyFilter(), categories: [name] } : { ...emptyFilter(), query: name });
  }

  return (
    <main class="settings-screen">
      {/* One row per section, each opening its own Sheet (user decision
          2026-11-10). The rows carry a count or status so the page still
          answers "anything to do here?" without opening each one. */}
      {/* Grouped by what the rows act on: your data's names, then where the
          data lives (user decision 2026-11-10). */}
      <div class="settings-group">
        <SettingsRow label="Categories" detail={String(categoryCount)} onClick={() => openNames("category")} />
        <SettingsRow label="Merchants" detail={String(merchantCount)} onClick={() => openNames("merchant")} />
      </div>

      <div class="settings-group">
        <SettingsRow
          label="Sync"
          detail={isSyncConfigured() ? describeStatus(syncState.status) : "unavailable"}
          onClick={() => setOpenSection("sync")}
        />
        <SettingsRow label="Data" detail={`${transactions.length} transactions`} onClick={() => setOpenSection("data")} />
      </div>

      {/* A disabled button, as asked: it reads as part of the list but does
          nothing. The value is inlined at build (src/app/buildVersion.ts). */}
      <button type="button" class="settings-version" disabled>
        Version {__APP_VERSION__}
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        class="settings-data-file-input"
        onChange={handleFileSelected}
      />

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

      <NamesSheet
        field={namesField}
        open={namesOpen}
        onClose={() => setNamesOpen(false)}
        transactions={transactions}
        onSelect={(name) => drillToName(namesField, name)}
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
