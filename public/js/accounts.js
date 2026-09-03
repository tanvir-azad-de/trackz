function renderAccounts() {
    const list = getElement("account-list");

    if (!window.state.accounts.length) {
        list.innerHTML = '<div class="record-card empty-copy">No accounts yet.</div>';
        return;
    }

    list.innerHTML = [...window.state.accounts]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(
            (account) => {
                const balanceClass = account.currentBalance >= 0 ? "amount-positive" : "amount-negative";
                return `
                <article class="record-card account-card">
                    <div class="record-main">
                        <strong class="record-title">${escapeHtml(account.name)}</strong>
                        <p class="record-subtext">${escapeHtml(account.currency)} • ${account.transactionCount} transactions</p>
                    </div>
                    <div class="record-side">
                        <strong class="record-amount ${balanceClass}">${formatMoney(account.currentBalance, account.currency)}</strong>
                        <button class="table-button" onclick="deleteAccount('${encodeURIComponent(account.name)}')">Delete</button>
                    </div>
                </article>
            `;
            }
        )
        .join("");
}

function resetAccountForm() {
    getElement("account-name").value = "";
    getElement("opening-balance").value = "";
    getElement("account-currency").value = getDefaultAccountCurrency();
}

function getDefaultAccountCurrency() {
    const fromAccounts = (window.state.accounts || []).find((account) => String(account.currency || "").trim())?.currency;
    if (fromAccounts) return String(fromAccounts).toUpperCase();

    const fromTransactions = (window.state.transactions || []).find((transaction) => String(transaction.currency || "").trim())?.currency;
    if (fromTransactions) return String(fromTransactions).toUpperCase();

    return "EUR";
}

function toggleAccountForm(force) {
    const form = getElement("account-form");
    form.hidden = typeof force === "boolean" ? !force : !form.hidden;

    if (!form.hidden) {
        hideStatus("account-feedback");
        resetAccountForm();
    }
}

async function saveAccount() {
    const payload = {
        name: getElement("account-name").value.trim(),
        currency: getElement("account-currency").value.trim().toUpperCase(),
        openingBalance: Number(getElement("opening-balance").value)
    };

    try {
        window.db.saveAccount(payload);
    } catch (err) {
        showStatus("account-feedback", err.message || "Could not save account.", "error");
        return;
    }

    await loadData();
    toggleAccountForm(false);
    showStatus("account-feedback", "Account saved.");
}

async function deleteAccount(accountName) {
    const decodedName = decodeURIComponent(accountName || "");
    const confirmed = window.confirm(`Are you sure you want to delete account \"${decodedName}\"?`);

    if (!confirmed) {
        return;
    }

    try {
        window.db.deleteAccount(decodedName);
    } catch (err) {
        showStatus("account-feedback", err.message || "Could not delete account.", "error");
        return;
    }

    await loadData();
    showStatus("account-feedback", "Account deleted.");
}

window.renderAccounts = renderAccounts;
window.resetAccountForm = resetAccountForm;
window.toggleAccountForm = toggleAccountForm;
window.saveAccount = saveAccount;
window.deleteAccount = deleteAccount;