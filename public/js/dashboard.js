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
    const caption = from && to ? `${formatDate(from)} → ${formatDate(to)}` : "Selected range";
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

    // --- Liquid Money card ---
    const positiveAccounts = summary.accounts.filter(
        (account) => typeof account.currentBalance === "number" && account.currentBalance > 0
    );
    const liquidMoney = positiveAccounts.reduce(
        (sum, account) =>
            sum + (typeof account.eurEquivalent === "number" ? account.eurEquivalent : 0),
        0
    );
    getElement("stat-balance").textContent = formatMoney(liquidMoney, "EUR");

    getElement("account-overview").innerHTML = positiveAccounts.length
        ? positiveAccounts
              .map(
                  (account) => `
                    <div class="list-row">
                        <strong>${escapeHtml(account.name)}</strong>
                        <strong class="amount-positive">${formatMoney(account.currentBalance, account.currency)}</strong>
                    </div>`
              )
              .join("")
        : '<p class="empty-copy">No accounts with positive balance.</p>';

    // --- Income card: group scoped transactions by main category ---
    const from = getElement("dashboard-from").value;
    const to = getElement("dashboard-to").value;

    const scopedTransactions = (window.state.transactions || []).filter((t) => {
        const d = String(t.date || "");
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
    });

    const rates = {};
    (summary.accounts || []).forEach(() => {}); // rates come from summary totals; use toEUR helper below

    function toEUR(amount, currency) {
        // re-use account eurEquivalent ratio if available, otherwise approximate
        const sample = summary.accounts.find((a) => a.currency === currency);
        if (!sample || typeof sample.eurEquivalent !== "number" || sample.currentBalance === 0) {
            return amount; // fallback
        }
        return amount * (sample.eurEquivalent / sample.currentBalance);
    }

    function groupByCategory(transactions) {
        const map = {};
        transactions.forEach((t) => {
            const key = t.category || "Uncategorized";
            map[key] = (map[key] || 0) + toEUR(t.amount, t.currency);
        });
        return Object.entries(map)
            .map(([name, amount]) => ({ name, amount }))
            .sort((a, b) => b.amount - a.amount);
    }

    const incomeTransactions = scopedTransactions.filter((t) => t.type === "Income");
    const expenseTransactions = scopedTransactions.filter((t) => t.type === "Expense");

    const totalIncome = incomeTransactions.reduce((s, t) => s + toEUR(t.amount, t.currency), 0);
    const totalExpense = expenseTransactions.reduce((s, t) => s + toEUR(t.amount, t.currency), 0);

    getElement("stat-income").textContent = formatMoney(totalIncome, "EUR");
    getElement("stat-expense").textContent = formatMoney(totalExpense, "EUR");

    const incomeByCategory = groupByCategory(incomeTransactions);
    getElement("income-breakdown").innerHTML = incomeByCategory.length
        ? incomeByCategory
              .map(
                  (entry) => `
                    <div class="list-row">
                        <span>${escapeHtml(entry.name)}</span>
                        <strong class="amount-positive">${formatMoney(entry.amount, "EUR")}</strong>
                    </div>`
              )
              .join("")
        : '<p class="empty-copy">No income in this range.</p>';

    const expenseByCategory = groupByCategory(expenseTransactions);
    getElement("expense-breakdown").innerHTML = expenseByCategory.length
        ? expenseByCategory
              .map(
                  (entry) => `
                    <div class="list-row">
                        <span>${escapeHtml(entry.name)}</span>
                        <strong class="amount-negative">${formatMoney(entry.amount, "EUR")}</strong>
                    </div>`
              )
              .join("")
        : '<p class="empty-copy">No expenses in this range.</p>';
}

function toggleDashboardFilters() {
    const panel = getElement("dashboard-filters-panel");
    panel.hidden = !panel.hidden;
}

window.initializeDashboardRange = initializeDashboardRange;
window.onDashboardRangeChange = onDashboardRangeChange;
window.renderDashboard = renderDashboard;
window.toggleDashboardFilters = toggleDashboardFilters;