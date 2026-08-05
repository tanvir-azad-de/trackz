function toISODate(value) {
    return new Date(value).toISOString().slice(0, 10);
}

function defaultDashboardFromDate() {
    const today = new Date();
    const from = new Date(today.getFullYear(), today.getMonth() - 1, 27);
    return toISODate(from);
}

function ensureDashboardRangeDefaults() {
    const fromInput = getElement("dashboard-from");
    const toInput = getElement("dashboard-to");

    if (!fromInput.value) {
        fromInput.value = defaultDashboardFromDate();
    }

    if (!toInput.value) {
        toInput.value = toISODate(new Date());
    }
}

function updateDashboardRangeCaptions() {
    const from = getElement("dashboard-from").value;
    const to = getElement("dashboard-to").value;
    const caption = from && to ? `${from} → ${to}` : "Selected range";
    getElement("stat-income-caption").textContent = caption;
    getElement("stat-expense-caption").textContent = caption;
}

async function refreshDashboardSummaryForRange() {
    ensureDashboardRangeDefaults();

    const from = getElement("dashboard-from").value;
    const to = getElement("dashboard-to").value;

    if (!from || !to) {
        return;
    }

    if (from > to) {
        getElement("dashboard-to").value = from;
        updateDashboardRangeCaptions();
        return;
    }

    const params = new URLSearchParams({ from, to });
    const response = await fetch(`/api/summary?${params.toString()}`);

    if (!response.ok) {
        return;
    }

    window.state.dashboardSummary = await response.json();
    updateDashboardRangeCaptions();
    renderDashboard();
}

function initializeDashboardRange() {
    ensureDashboardRangeDefaults();
    updateDashboardRangeCaptions();
    refreshDashboardSummaryForRange();
}

function onDashboardRangeChange() {
    refreshDashboardSummaryForRange();
}

function renderDashboard() {
    const summary = window.state.dashboardSummary || window.state.summary;

    if (!summary) {
        return;
    }

    const statBalance = getElement("stat-balance");
    const statIncome = getElement("stat-income");
    const statExpense = getElement("stat-expense");

    const applyTone = (element, value) => {
        element.classList.remove("amount-positive", "amount-negative");
        element.classList.add(value >= 0 ? "amount-positive" : "amount-negative");
    };

    const liquidMoney = summary.accounts
        .filter((account) => !String(account.name || "").toLowerCase().includes("scb credit card"))
        .reduce(
            (sum, account) =>
                sum + (typeof account.eurEquivalent === "number" ? Number(account.eurEquivalent) : 0),
            0
        );

    statBalance.textContent = formatMoney(liquidMoney, "EUR");
    statIncome.textContent = formatMoney(summary.totals.monthIncome, "EUR");
    statExpense.textContent = formatMoney(summary.totals.monthExpense, "EUR");

    applyTone(statBalance, liquidMoney);
    applyTone(statIncome, summary.totals.monthIncome);
    statExpense.classList.remove("amount-positive", "amount-negative");
    statExpense.classList.add("amount-negative");

    const accountOverview = getElement("account-overview");
    accountOverview.innerHTML = summary.accounts.length
        ? summary.accounts
              .map(
                  (account) => `
                    <div class="list-row">
                        <div>
                            <strong>${escapeHtml(account.name)}</strong>
                        </div>
                        <strong class="${account.currentBalance >= 0 ? "amount-positive" : "amount-negative"}">${formatMoney(account.currentBalance, account.currency)}</strong>
                    </div>
                  `
              )
              .join("")
        : '<p class="empty-copy">Add an account to see balances here.</p>';

    const expenseBreakdown = getElement("expense-breakdown");
    expenseBreakdown.innerHTML = summary.expenseByCategory.length
        ? summary.expenseByCategory
              .slice(0, 5)
              .map(
                  (entry) => `
                    <div class="list-row">
                        <span>${escapeHtml(entry.name)}</span>
                        <strong class="amount-negative">${formatMoney(entry.amount, "EUR")}</strong>
                    </div>
                  `
              )
              .join("")
        : '<p class="empty-copy">No expense categories yet.</p>';

    const debts = window.state.debts || [];
    const owedToMe = debts
        .filter((debt) => debt.direction === "owed_to_me")
        .reduce((sum, debt) => sum + (Number.isFinite(debt.eurEquivalent) ? debt.eurEquivalent : 0), 0);
    const iOwe = debts
        .filter((debt) => debt.direction === "i_owe")
        .reduce((sum, debt) => sum + (Number.isFinite(debt.eurEquivalent) ? debt.eurEquivalent : 0), 0);

    const debtOverview = getElement("debt-overview");
    debtOverview.innerHTML = `
        <div class="al-chart-legend">
            <div class="al-legend-row">
                <span><span class="al-dot al-assets"></span>Owed to me</span>
                <strong class="amount-positive">${formatMoney(owedToMe, "EUR")}</strong>
            </div>
            <div class="al-legend-row">
                <span><span class="al-dot al-liabilities"></span>I owe</span>
                <strong class="amount-negative">${formatMoney(iOwe, "EUR")}</strong>
            </div>
            <div class="al-legend-row al-net-row">
                <span>Net debt position</span>
                <strong class="${owedToMe - iOwe >= 0 ? "amount-positive" : "amount-negative"}">${formatMoney(owedToMe - iOwe, "EUR")}</strong>
            </div>
        </div>
    `;

    const recentActivity = getElement("recent-activity");
    recentActivity.innerHTML = summary.recentTransactions.length
        ? summary.recentTransactions
              .map(
                  (transaction) => `
                    <div class="list-row">
                        <div>
                            <strong>${escapeHtml(transactionCategoryLabel(transaction))}</strong>
                            <small>${escapeHtml(transaction.date)} · ${escapeHtml(transactionDescription(transaction))}</small>
                        </div>
                        <strong class="${getTransactionSignedAmount(transaction) >= 0 ? "amount-positive" : "amount-negative"}">
                            ${getTransactionSignedAmount(transaction) >= 0 ? "+" : "-"}${formatMoney(transaction.amount, transaction.currency)}
                        </strong>
                    </div>
                  `
              )
              .join("")
        : '<p class="empty-copy">No recent activity yet.</p>';
}

window.initializeDashboardRange = initializeDashboardRange;
window.onDashboardRangeChange = onDashboardRangeChange;
window.renderDashboard = renderDashboard;