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

    renderNetExpenseChart(expensePoints, cashflowPoints);
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

function renderMonthlyBarChart({ type, categories, totalElementId, chartElementId, emptyMessage, tone = "positive" }) {
    const totalsByMonth = getMonthlyTotalsForTransactions({ type, categories });

    const points = Object.entries(totalsByMonth)
        .map(([month, amount]) => ({ month, amount }))
        .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));

    renderBarChartCard({ points, totalElementId, chartElementId, emptyMessage, tone });

    return points;
}

function renderNetExpenseChart(expensePoints, cashflowPoints) {
    const cashflowByMonth = {};
    cashflowPoints.forEach((p) => {
        cashflowByMonth[p.month] = p.amount;
    });

    const expenseByMonth = {};
    expensePoints.forEach((p) => {
        expenseByMonth[p.month] = p.amount;
    });

    const months = new Set([...Object.keys(expenseByMonth), ...Object.keys(cashflowByMonth)]);

    const points = Array.from(months)
        .map((month) => ({
            month,
            amount: (expenseByMonth[month] || 0) - (cashflowByMonth[month] || 0)
        }))
        .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));

    renderBarChartCard({
        points,
        totalElementId: "net-expense-total",
        chartElementId: "net-expense-chart",
        emptyMessage: "No expenses or incoming cash flow in this range.",
        tone: "negative",
        colorBySign: true
    });
}

function renderBarChartCard({ points, totalElementId, chartElementId, emptyMessage, tone = "positive", colorBySign = false }) {
    const total = points.reduce((sum, p) => sum + p.amount, 0);
    const totalElement = getElement(totalElementId);
    totalElement.textContent = formatMoney(total, "EUR");
    totalElement.classList.toggle("amount-negative", tone === "negative");
    totalElement.classList.toggle("amount-positive", tone !== "negative");

    const chart = getElement(chartElementId);

    if (!points.length) {
        chart.innerHTML = `<p class="empty-copy">${escapeHtml(emptyMessage)}</p>`;
        return;
    }

    const maxAmount = Math.max(...points.map((p) => Math.abs(p.amount)), 1);

    chart.innerHTML = points
        .map((p) => {
            const heightPct = Math.max((Math.abs(p.amount) / maxAmount) * 100, 2);
            const isNegativeBar = colorBySign ? p.amount >= 0 : tone === "negative";
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

function toggleDashboardFilters() {
    const panel = getElement("dashboard-filters-panel");
    panel.hidden = !panel.hidden;
}

window.initializeDashboardRange = initializeDashboardRange;
window.onDashboardRangeChange = onDashboardRangeChange;
window.renderDashboard = renderDashboard;
window.toggleDashboardFilters = toggleDashboardFilters;
