import { Money } from "@/components/Money";
import type { Cents } from "@/domain/money";

interface AccountStripProps {
  accounts: Array<{ account: string; balanceCents: Cents }>;
}

export function AccountStrip({ accounts }: AccountStripProps) {
  if (accounts.length === 0) return null;
  return (
    <div class="account-strip">
      {accounts.map(({ account, balanceCents }) => (
        <div class="account-strip__card" key={account}>
          <div class="account-strip__name">{account}</div>
          <div class={`account-strip__amount ${balanceCents < 0 ? "account-strip__amount--negative" : ""}`}>
            <Money cents={balanceCents} />
          </div>
        </div>
      ))}
    </div>
  );
}
