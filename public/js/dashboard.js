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

function renderDashboard() {
    renderIncomeCategoryChart();
}

function renderIncomeCategoryChart() {
    const from = getElement("dashboard-from").value;
    const to = getElement("dashboard-to").value;

    const rates = window.state.currencyRates || {};
    const toEUR = (amount, currency) => {
        const rate = rates[String(currency || "").toUpperCase()];
        return typeof rate === "number" ? amount * rate : amount;
    };

    const incomeTransactions = (window.state.transactions || []).filter((t) => {
        if (t.type !== "Income" || t.category !== "Income") return false;
        const d = String(t.date || "");
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
    });

    const totalsByMonth = {};
    incomeTransactions.forEach((t) => {
        const key = String(t.date || "").slice(0, 7); // YYYY-MM
        totalsByMonth[key] = (totalsByMonth[key] || 0) + toEUR(t.amount, t.currency);
    });

    const points = Object.entries(totalsByMonth)
        .map(([month, amount]) => ({ month, amount }))
        .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));

    const total = points.reduce((sum, p) => sum + p.amount, 0);
    getElement("income-category-total").textContent = formatMoney(total, "EUR");

    const chart = getElement("income-category-chart");

    if (!points.length) {
        chart.innerHTML = '<p class="empty-copy">No income in this range.</p>';
        return;
    }

    const maxAmount = Math.max(...points.map((p) => p.amount), 1);

    chart.innerHTML = points
        .map((p) => {
            const heightPct = Math.max((p.amount / maxAmount) * 100, 2);
            return `
                <div class="bar-chart-col" title="${escapeHtml(p.month)}: ${escapeHtml(formatMoney(p.amount, "EUR"))}">
                    <span class="bar-chart-value">${escapeHtml(formatMoney(p.amount, "EUR"))}</span>
                    <div class="bar-chart-bar" style="height: ${heightPct}%"></div>
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