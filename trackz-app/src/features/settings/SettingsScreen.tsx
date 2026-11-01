import { useMemo } from "preact/hooks";
import { useTransactions } from "@/storage/useTransactions";
import { useAccountTypes } from "@/storage/useAccountTypes";
import { setAccountType } from "@/storage/accountTypes";
import { deriveAccounts, getAllAccountBalances } from "@/storage/derive";
import type { AccountType } from "@/domain/transaction";
import { Card } from "@/components/Card";
import { Money } from "@/components/Money";
import type { ToastState } from "@/components/Toast";
import "./SettingsScreen.css";

interface SettingsScreenProps {
  onToast?: (toast: ToastState) => void;
}

const ACCOUNT_TYPE_OPTIONS: Array<{ value: AccountType; label: string }> = [
  { value: "cash", label: "Cash" },
  { value: "investment", label: "Investment" },
];

/**
 * Phase 13 (Settings), account-type classification section only — the
 * UI gap left open at the end of the post-Phase-12 SCLB fix
 * (docs/renovation_version_1.txt): until now, "this account is an
 * investment, not cash" could only be changed by editing
 * storage/accountTypes.ts's SEED_DEFAULTS directly.
 *
 * Each account gets a Cash/Investment segmented toggle. Changes are
 * immediate (no draft + Apply like FilterSheet) — unlike a multi-facet
 * filter, there's exactly one meaningful value per account at a time,
 * so a confirm step would just be friction. An undo-able toast (reusing
 * the same Toast primitive Phase 8/11 use for save/delete) is the safety
 * net instead of a draft step.
 */
export function SettingsScreen({ onToast }: SettingsScreenProps) {
  const transactions = useTransactions();
  const accountTypesMap = useAccountTypes();

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

  return (
    <main class="settings-screen">
      <h1 class="settings-screen__title">Settings</h1>

      <h2 class="settings-screen__section-title">Account types</h2>
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
    </main>
  );
}
