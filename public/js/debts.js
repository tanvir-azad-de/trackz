function renderDebts() {
    const debts = window.state.debts || [];
    const owedToMe = debts.filter((d) => d.direction === "owed_to_me");
    const iOwe = debts.filter((d) => d.direction === "i_owe");

    function debtCard(debt) {
        const progressPct = debt.originalAmount > 0
            ? Math.min(100, Math.round((debt.paidBack / debt.originalAmount) * 100))
            : 0;
        const settled = debt.remaining <= 0;

        const accountOptions = (window.state.accounts || [])
            .map((a) => `<option value="${escapeHtml(a.name)}">${escapeHtml(a.name)} (${escapeHtml(a.currency)})</option>`)
            .join("");

        const paymentsHtml = debt.payments.length
            ? debt.payments.map((p) => `
                <div class="list-row payment-row">
                    <div>
                        <small>${escapeHtml(formatDate(p.date))}</small>
                        ${p.notes ? `<small class="muted"> · ${escapeHtml(p.notes)}</small>` : ""}
                    </div>
                    <div class="payment-actions">
                        <span class="amount-positive">+${formatMoney(p.amount, p.currency)}</span>
                    </div>
                </div>`).join("")
            : '<p class="empty-copy" style="margin:8px 0">No payments recorded yet.</p>';

        return `
            <article class="card debt-card ${settled ? "debt-settled" : ""}">
                <div class="debt-card-header">
                    <div>
                        <strong class="debt-person">${escapeHtml(debt.person)}</strong>
                        ${debt.notes ? `<small class="muted"> · ${escapeHtml(debt.notes)}</small>` : ""}
                    </div>
                    <button class="table-button" onclick="deleteDebt('${debt.id}')">Delete</button>
                </div>

                <div class="debt-amounts">
                    <div>
                        <span class="stat-label">Original</span>
                        <strong>${formatMoney(debt.originalAmount, debt.currency)}</strong>
                    </div>
                    <div>
                        <span class="stat-label">Paid back</span>
                        <strong>${formatMoney(debt.paidBack, debt.currency)}</strong>
                    </div>
                    <div>
                        <span class="stat-label">Remaining</span>
                        <strong class="${settled ? "amount-positive" : "amount-negative"}">${settled ? "Settled ✓" : formatMoney(debt.remaining, debt.currency)}</strong>
                    </div>
                </div>

                <div class="debt-progress">
                    <div class="progress-bar">
                        <div class="progress-fill" style="width:${progressPct}%"></div>
                    </div>
                    <small class="muted">${progressPct}% paid</small>
                </div>

                <details class="debt-payments">
                    <summary>Payments (${debt.payments.length})</summary>
                    <div class="payments-list">${paymentsHtml}</div>
                   
                </details>
            </article>
        `;
    }

    const owedContainer = getElement("debts-owed-to-me");
    owedContainer.innerHTML = owedToMe.length
        ? owedToMe.map(debtCard).join("")
        : '<p class="empty-copy">No one owes you money right now.</p>';

    const iOweContainer = getElement("debts-i-owe");
    iOweContainer.innerHTML = iOwe.length
        ? iOwe.map(debtCard).join("")
        : '<p class="empty-copy">You do not owe anyone money right now.</p>';
}

function toggleDebtForm(force) {
    const form = getElement("debt-form");
    form.hidden = typeof force === "boolean" ? !force : !form.hidden;

    if (!form.hidden) {
        hideStatus("debt-feedback");
        getElement("debt-person").value = "";
        getElement("debt-direction").value = "owed_to_me";
        getElement("debt-amount").value = "";
        getElement("debt-notes").value = "";
        if (window.state.currencies[0]) {
            getElement("debt-currency").value = window.state.currencies[0];
        }
    }
}

async function saveDebt() {
    const payload = {
        person: getElement("debt-person").value.trim(),
        direction: getElement("debt-direction").value,
        originalAmount: Number(getElement("debt-amount").value),
        currency: getElement("debt-currency").value,
        notes: getElement("debt-notes").value.trim()
    };

    const response = await fetch("/api/debts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (!response.ok) {
        showStatus("debt-feedback", result.message || "Could not save debt.", "error");
        return;
    }

    await loadData();
    toggleDebtForm(false);
    showStatus("debt-feedback", "Debt saved.");
}

async function deleteDebt(id) {
    const response = await fetch(`/api/debts/${id}`, { method: "DELETE" });

    if (!response.ok) {
        showStatus("debt-feedback", "Could not delete debt.", "error");
        return;
    }

    await loadData();
    showStatus("debt-feedback", "Debt deleted.");
}

async function addPayment(debtId) {
    const payload = {
        date: getElement(`pdate-${debtId}`).value,
        amount: Number(getElement(`pamount-${debtId}`).value),
        account: getElement(`paccount-${debtId}`).value,
        notes: getElement(`pnotes-${debtId}`).value.trim()
    };

    const response = await fetch(`/api/debts/${debtId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (!response.ok) {
        showStatus("debt-feedback", result.message || "Could not add payment.", "error");
        return;
    }

    await loadData();
    showStatus("debt-feedback", "Payment recorded.");
}

async function deletePayment(debtId, paymentId) {
    const response = await fetch(`/api/debts/${debtId}/payments/${paymentId}`, { method: "DELETE" });

    if (!response.ok) {
        showStatus("debt-feedback", "Could not delete payment.", "error");
        return;
    }

    await loadData();
    showStatus("debt-feedback", "Payment deleted.");
}

window.renderDebts = renderDebts;
window.toggleDebtForm = toggleDebtForm;
window.saveDebt = saveDebt;
window.deleteDebt = deleteDebt;
window.addPayment = addPayment;
window.deletePayment = deletePayment;
