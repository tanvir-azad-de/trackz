function renderAccounts() {
    const tbody = getElement("account-list");

    if (!window.state.accounts.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">No accounts yet.</td></tr>';
        return;
    }

    tbody.innerHTML = [...window.state.accounts]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(
            (account) => {
                const balanceClass = account.currentBalance >= 0 ? "amount-positive" : "amount-negative";
                const eurClass = account.eurEquivalent >= 0 ? "amount-positive" : "amount-negative";
                return `
                <tr>
                    <td>${escapeHtml(account.name)}</td>
                    <td class="align-right">${escapeHtml(account.currency)}</td>
                    <td class="align-right ${balanceClass}">${formatMoney(account.currentBalance, account.currency)}</td>
                    <td class="align-right ${typeof account.eurEquivalent === "number" ? eurClass : ""}">${typeof account.eurEquivalent === "number" ? formatMoney(account.eurEquivalent, "EUR") : "—"}</td>
                    <td class="align-right">${account.transactionCount}</td>
                    <td class="align-right"><button class="table-button" onclick="deleteAccount('${encodeURIComponent(account.name)}')">Delete</button></td>
                </tr>
            `;
            }
        )
        .join("");
}

function resetAccountForm() {
    getElement("account-name").value = "";
    getElement("opening-balance").value = "";

    if (window.state.currencies[0]) {
        getElement("account-currency").value = window.state.currencies[0];
    }
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
        currency: getElement("account-currency").value,
        openingBalance: Number(getElement("opening-balance").value)
    };

    const response = await fetch("/api/accounts", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (!response.ok) {
        showStatus("account-feedback", result.message || "Could not save account.", "error");
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

    const response = await fetch(`/api/accounts/${accountName}`, {
        method: "DELETE"
    });

    const result = await response.json();

    if (!response.ok) {
        showStatus("account-feedback", result.message || "Could not delete account.", "error");
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