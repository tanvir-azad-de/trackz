function toISODate(value) {
    return new Date(value).toISOString().slice(0, 10);
}

function defaultDashboardFromDate() {
    return "2024-11-01";
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

    window.state.dashboardSummary = window.db.getSummary({ from, to });
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

const EXPENSE_CATEGORIES = [
    "Shopping",
    "Groceries",
    "Restaurant",
    "Family Support",
    "Health Insurance",
    "Rent",
    "Smokes",
    "Personal Care",
    "WG Costs",
    "Travel",
    "WiFi Mobile",
    "Broadcasting Fee",
    "Subscriptions",
    "Lemfi",
    "Entertainment",
    "University",
    "Repayment ABH",
    "Electricity"
];

const CASHFLOW_CATEGORIES = ["Reimbursements", "Sold Items", "Refunds"];

function renderDashboard() {
    const expensePoints = renderMonthlyBarChart({
        type: "Expense",
        categories: EXPENSE_CATEGORIES,
        totalElementId: "expense-category-total",
        chartElementId: "expense-category-chart",
        emptyMessage: "No expenses in this range.",
        tone: "negative"
    });

    renderMonthlyBarChart({
        type: "Income",
        categories: ["Income"],
        totalElementId: "income-category-total",
        chartElementId: "income-category-chart",
        emptyMessage: "No income in this range."
    });

    const cashflowPoints = renderMonthlyBarChart({
        type: "Income",
        categories: CASHFLOW_CATEGORIES,
        totalElementId: "cashflow-category-total",
        chartElementId: "cashflow-category-chart",
        emptyMessage: "No incoming cash flow in this range."
    });

    renderNetBalanceChart({
        subtractPoints: expensePoints,
        fromPoints: cashflowPoints,
        totalElementId: "net-expense-total",
        chartElementId: "net-expense-chart",
        emptyMessage: "No expenses or incoming cash flow in this range."
    });

    renderNetBalanceChart({
        subtractPoints: getMonthlyPoints({ type: "Expense", categories: ["Short Term Loan Given"] }),
        fromPoints: getMonthlyPoints({ type: "Income", categories: ["Short Term Loan Return"] }),
        totalElementId: "short-term-loan-balance-total",
        chartElementId: "short-term-loan-balance-chart",
        emptyMessage: "No short term loan activity in this range."
    });

    renderNetBalanceChart({
        subtractPoints: getMonthlyPoints({ type: "Expense", categories: ["Kaution Given"] }),
        fromPoints: getMonthlyPoints({ type: "Income", categories: ["Kaution Return"] }),
        totalElementId: "kaution-balance-total",
        chartElementId: "kaution-balance-chart",
        emptyMessage: "No Kaution activity in this range."
    });

    renderAccountBalanceChart({
        accountName: "Commerzbank",
        totalElementId: "account-balance-commerzbank-total",
        chartElementId: "account-balance-commerzbank-chart",
        emptyMessage: "No transactions found for this account in this range."
    });

    renderAccountBalanceChart({
        accountName: "Advanzia",
        totalElementId: "account-balance-advanzia-total",
        chartElementId: "account-balance-advanzia-chart",
        emptyMessage: "No transactions found for this account in this range."
    });

    renderAccountBalanceChart({
        accountName: "Cash",
        totalElementId: "account-balance-cash-total",
        chartElementId: "account-balance-cash-chart",
        emptyMessage: "No transactions found for this account in this range."
    });

    renderAccountBalanceChart({
        accountName: "Revolut",
        totalElementId: "account-balance-revolut-total",
        chartElementId: "account-balance-revolut-chart",
        emptyMessage: "No transactions found for this account in this range."
    });

    renderAccountBalanceChart({
        accountName: "Revolut JPY",
        totalElementId: "account-balance-revolut-jpy-total",
        chartElementId: "account-balance-revolut-jpy-chart",
        emptyMessage: "No transactions found for this account in this range."
    });

    renderAccountBalanceChart({
        accountName: "Revolut Brokerage",
        totalElementId: "account-balance-revolut-brokerage-total",
        chartElementId: "account-balance-revolut-brokerage-chart",
        emptyMessage: "No transactions found for this account in this range."
    });

    renderAccountBalanceChart({
        accountName: "Scalable Capital",
        totalElementId: "account-balance-scalable-capital-total",
        chartElementId: "account-balance-scalable-capital-chart",
        emptyMessage: "No transactions found for this account in this range."
    });
}

function getMonthlyTotalsForTransactions({ type, categories }) {
    const from = getElement("dashboard-from").value;
    const to = getElement("dashboard-to").value;

    const rates = window.state.currencyRates || {};
    const toEUR = (amount, currency) => {
        const rate = rates[String(currency || "").toUpperCase()];
        return typeof rate === "number" ? amount * rate : amount;
    };

    const matchingTransactions = (window.state.transactions || []).filter((t) => {
        if (t.type !== type || !categories.includes(t.category)) return false;
        const d = String(t.date || "");
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
    });

    const totalsByMonth = {};
    matchingTransactions.forEach((t) => {
        const key = String(t.date || "").slice(0, 7); // YYYY-MM
        totalsByMonth[key] = (totalsByMonth[key] || 0) + toEUR(t.amount, t.currency);
    });

    return totalsByMonth;
}

function getMonthlyPoints({ type, categories }) {
    const totalsByMonth = getMonthlyTotalsForTransactions({ type, categories });

    return Object.entries(totalsByMonth)
        .map(([month, amount]) => ({ month, amount }))
        .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
}

function renderMonthlyBarChart({ type, categories, totalElementId, chartElementId, emptyMessage, tone = "positive" }) {
    const points = getMonthlyPoints({ type, categories });

    renderBarChartCard({ points, totalElementId, chartElementId, emptyMessage, tone });

    return points;
}

function renderNetBalanceChart({ subtractPoints, fromPoints, totalElementId, chartElementId, emptyMessage }) {
    const subtractByMonth = {};
    subtractPoints.forEach((p) => {
        subtractByMonth[p.month] = p.amount;
    });

    const fromByMonth = {};
    fromPoints.forEach((p) => {
        fromByMonth[p.month] = p.amount;
    });

    const months = new Set([...Object.keys(subtractByMonth), ...Object.keys(fromByMonth)]);

    const points = Array.from(months)
        .map((month) => ({
            month,
            amount: (subtractByMonth[month] || 0) - (fromByMonth[month] || 0)
        }))
        .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));

    renderBarChartCard({
        points,
        totalElementId,
        chartElementId,
        emptyMessage,
        tone: "negative",
        colorBySign: "positive-is-negative"
    });

    return points;
}

function renderBarChartCard({ points, totalElementId, chartElementId, emptyMessage, tone = "positive", colorBySign = null, totalMode = "sum" }) {
    const total = totalMode === "last" ? (points.length ? points[points.length - 1].amount : 0) : points.reduce((sum, p) => sum + p.amount, 0);
    const totalElement = getElement(totalElementId);
    totalElement.textContent = formatMoney(total, "EUR");

    const isTotalNegativeTone = colorBySign
        ? colorBySign === "positive-is-negative"
            ? total >= 0
            : total < 0
        : tone === "negative";
    totalElement.classList.toggle("amount-negative", isTotalNegativeTone);
    totalElement.classList.toggle("amount-positive", !isTotalNegativeTone);

    const chart = getElement(chartElementId);

    if (!points.length) {
        chart.innerHTML = `<p class="empty-copy">${escapeHtml(emptyMessage)}</p>`;
        return;
    }

    const maxAmount = Math.max(...points.map((p) => Math.abs(p.amount)), 1);

    chart.innerHTML = points
        .map((p) => {
            const heightPct = Math.max((Math.abs(p.amount) / maxAmount) * 100, 2);
            const isNegativeBar = colorBySign
                ? colorBySign === "positive-is-negative"
                    ? p.amount >= 0
                    : p.amount < 0
                : tone === "negative";
            const barClass = isNegativeBar ? "bar-chart-bar bar-chart-bar--negative" : "bar-chart-bar";
            return `
                <div class="bar-chart-col" title="${escapeHtml(p.month)}: ${escapeHtml(formatMoney(p.amount, "EUR"))}">
                    <span class="bar-chart-value">${escapeHtml(formatMoney(p.amount, "EUR"))}</span>
                    <div class="${barClass}" style="height: ${heightPct}%"></div>
                    <span class="bar-chart-label">${escapeHtml(p.month)}</span>
                </div>`;
        })
        .join("");
}

function renderAccountBalanceChart({ accountName, totalElementId, chartElementId, emptyMessage }) {
    const from = getElement("dashboard-from").value;
    const to = getElement("dashboard-to").value;
    const fromMonth = from ? from.slice(0, 7) : null;
    const toMonth = to ? to.slice(0, 7) : null;

    const rates = window.state.currencyRates || {};
    const toEUR = (amount, currency) => {
        const rate = rates[String(currency || "").toUpperCase()];
        return typeof rate === "number" ? amount * rate : amount;
    };

    const monthlyBalances = (window.db.getAccountMonthlyBalances(accountName) || []).filter((entry) => {
        if (fromMonth && entry.month < fromMonth) return false;
        if (toMonth && entry.month > toMonth) return false;
        return true;
    });

    const points = monthlyBalances.map((entry) => ({
        month: entry.month,
        amount: toEUR(entry.balance, entry.currency)
    }));

    renderBarChartCard({
        points,
        totalElementId,
        chartElementId,
        emptyMessage,
        colorBySign: "negative-is-negative",
        totalMode: "last"
    });

    return points;
}

function toggleDashboardFilters() {
    const panel = getElement("dashboard-filters-panel");
    panel.hidden = !panel.hidden;
}

window.initializeDashboardRange = initializeDashboardRange;
window.onDashboardRangeChange = onDashboardRangeChange;
window.renderDashboard = renderDashboard;
window.toggleDashboardFilters = toggleDashboardFilters;
