import { Money } from "@/components/Money";
import type { Cents } from "@/domain/money";
import { accountTypeLabel, type AccountType } from "@/domain/transaction";

interface AccountStripProps {
  accounts: Array<{ account: string; balanceCents: Cents; accountType: AccountType }>;
}

/**
 * Investment and credit-card accounts (e.g. SCLB, ADVZ) get a small
 * badge so their balance doesn't read as spendable cash even though they sit in
 * the same horizontal strip as true cash accounts right below the
 * "Liquid" hero — see HeroCard's comment for why the hero itself
 * excludes them from its headline number.
 */
export function AccountStrip({ accounts }: AccountStripProps) {
  if (accounts.length === 0) return null;
  return (
    <div class="account-strip">
      {accounts.map(({ account, balanceCents, accountType }) => (
        <div class="account-strip__card" key={account}>
          <div class="account-strip__name">
            {account}
            {accountType !== "cash" && <span class="account-strip__badge">{accountTypeLabel(accountType)}</span>}
          </div>
          <div class={`account-strip__amount ${balanceCents < 0 ? "account-strip__amount--negative" : ""}`}>
            <Money cents={balanceCents} />
          </div>
        </div>
      ))}
    </div>
  );
}
