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
    "WiFi",
    "Mobile",
    "Broadcasting Fee",
    "Subscriptions",
    "Lemfi",
    "Entertainment",
    "University",
    "Repayment",
    "ABH",
    "Electricity"
];

const CASHFLOW_CATEGORIES = ["Reimbursements", "Sold Items", "Refunds"];

const TRACKED_ACCOUNT_NAMES = [
    "Commerzbank",
    "Advanzia",
    "Cash",
    "Revolut",
    "Revolut JPY",
    "Revolut Brokerage",
    "Scalable Capital"
];

const TOTAL_ASSETS_ACCOUNT_NAMES = [
    "Commerzbank",
    "Cash",
    "Revolut",
    "Revolut JPY",
    "Revolut Brokerage",
    "Scalable Capital"
];

function shiftMonth(monthStr, delta) {
    const [y, m] = monthStr.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    return d.toISOString().slice(0, 7);
}

function getMonthRange(fromMonth, toMonth) {
    if (!fromMonth || !toMonth) return [];
    const months = [];
    let cursor = new Date(`${fromMonth}-01T00:00:00Z`);
    const end = new Date(`${toMonth}-01T00:00:00Z`);
    while (cursor <= end) {
        months.push(cursor.toISOString().slice(0, 7));
        cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    }
    return months;
}

function getAccountBalanceAtMonthEnd(monthlyBalances, month, openingBalance) {
    // monthlyBalances is sorted ascending by month and covers the account's full history.
    // Returns the balance as of the end of `month` (or the latest available balance if
    // `month` is null, meaning "no upper bound").
    if (!monthlyBalances.length) return openingBalance;

    if (!month) {
        return monthlyBalances[monthlyBalances.length - 1].balance;
    }

    let result = null;
    for (const entry of monthlyBalances) {
        if (entry.month <= month) {
            result = entry.balance;
        } else {
            break;
        }
    }

    return result === null ? openingBalance : result;
}

function getAccountBalanceDelta(accountName) {
    const from = getElement("dashboard-from").value;
    const to = getElement("dashboard-to").value;
    const fromMonth = from ? from.slice(0, 7) : null;
    const toMonth = to ? to.slice(0, 7) : null;

    const account = (window.state.accounts || []).find((a) => a.name === accountName);
    const openingBalance = account ? Number(account.openingBalance) || 0 : 0;
    const currency = account ? account.currency : "EUR";

    const rates = window.state.currencyRates || {};
    const toEUR = (amount) => {
        const rate = rates[String(currency || "").toUpperCase()];
        return typeof rate === "number" ? amount * rate : amount;
    };

    const monthlyBalances = window.db.getAccountMonthlyBalances(accountName) || [];

    const startMonth = fromMonth ? shiftMonth(fromMonth, -1) : null;
    const startBalance = fromMonth
        ? getAccountBalanceAtMonthEnd(monthlyBalances, startMonth, openingBalance)
        : openingBalance;
    const endBalance = getAccountBalanceAtMonthEnd(monthlyBalances, toMonth, openingBalance);

    return toEUR(endBalance - startBalance);
}

function getCumulativeCategoryBalances({ expenseCategory, incomeCategory }) {
    const transactions = (window.state.transactions || [])
        .filter(
            (t) =>
                (t.type === "Expense" && t.category === expenseCategory) ||
                (t.type === "Income" && t.category === incomeCategory)
        )
        .filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(String(t.date || "")))
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    if (!transactions.length) return [];

    const rates = window.state.currencyRates || {};
    const toEUR = (amount, currency) => {
        const rate = rates[String(currency || "").toUpperCase()];
        return typeof rate === "number" ? amount * rate : amount;
    };

    const firstMonth = transactions[0].date.slice(0, 7);
    const lastMonth = transactions[transactions.length - 1].date.slice(0, 7);

    const impactByMonth = {};
    transactions.forEach((t) => {
        const month = t.date.slice(0, 7);
        const eurAmount = toEUR(t.amount, t.currency);
        const impact = t.type === "Expense" ? eurAmount : -eurAmount;
        impactByMonth[month] = (impactByMonth[month] || 0) + impact;
    });

    const months = getMonthRange(firstMonth, lastMonth);

    let runningBalance = 0;
    return months.map((month) => {
        runningBalance += impactByMonth[month] || 0;
        return { month, balance: runningBalance };
    });
}

function renderTotalAssetsChart() {
    const from = getElement("dashboard-from").value;
    const to = getElement("dashboard-to").value;
    const fromMonth = from ? from.slice(0, 7) : null;
    const toMonth = to ? to.slice(0, 7) : null;

    if (!fromMonth || !toMonth) {
        renderBarChartCard({
            points: [],
            totalElementId: "total-assets-total",
            chartElementId: "total-assets-chart",
            emptyMessage: "Select a date range."
        });
        return;
    }

    const months = getMonthRange(fromMonth, toMonth);

    const loanCumulative = getCumulativeCategoryBalances({
        expenseCategory: "Short Term Loan Given",
        incomeCategory: "Short Term Loan Return"
    });
    const kautionCumulative = getCumulativeCategoryBalances({
        expenseCategory: "Kaution Given",
        incomeCategory: "Kaution Return"
    });

    const rates = window.state.currencyRates || {};
    const toEUR = (amount, currency) => {
        const rate = rates[String(currency || "").toUpperCase()];
        return typeof rate === "number" ? amount * rate : amount;
    };

    const accountsData = TOTAL_ASSETS_ACCOUNT_NAMES.map((name) => {
        const account = (window.state.accounts || []).find((a) => a.name === name);
        const openingBalance = account ? Number(account.openingBalance) || 0 : 0;
        const currency = account ? account.currency : "EUR";
        const monthlyBalances = window.db.getAccountMonthlyBalances(name) || [];
        return { openingBalance, currency, monthlyBalances };
    });

    const points = months.map((month) => {
        const loanBalance = getAccountBalanceAtMonthEnd(loanCumulative, month, 0);
        const kautionBalance = getAccountBalanceAtMonthEnd(kautionCumulative, month, 0);
        const accountsBalance = accountsData.reduce((sum, acc) => {
            const balance = getAccountBalanceAtMonthEnd(acc.monthlyBalances, month, acc.openingBalance);
            return sum + toEUR(balance, acc.currency);
        }, 0);

        return { month, amount: loanBalance + kautionBalance + accountsBalance };
    });

    renderBarChartCard({
        points,
        totalElementId: "total-assets-total",
        chartElementId: "total-assets-chart",
        emptyMessage: "No asset data available for this range.",
        colorBySign: "negative-is-negative",
        totalMode: "last"
    });
}

function getUntrackedTransactionSummary() {
    const from = getElement("dashboard-from").value;
    const to = getElement("dashboard-to").value;

    const rates = window.state.currencyRates || {};
    const toEUR = (amount, currency) => {
        const rate = rates[String(currency || "").toUpperCase()];
        return typeof rate === "number" ? amount * rate : amount;
    };

    const isTracked = (t) => {
        if (t.type === "Transfer") return true;
        if (t.type === "Income" && t.category === "Income") return true;
        if (t.type === "Income" && CASHFLOW_CATEGORIES.includes(t.category)) return true;
        if (t.type === "Expense" && EXPENSE_CATEGORIES.includes(t.category)) return true;
        if (t.type === "Expense" && t.category === "Short Term Loan Given") return true;
        if (t.type === "Income" && t.category === "Short Term Loan Return") return true;
        if (t.type === "Expense" && t.category === "Kaution Given") return true;
        if (t.type === "Income" && t.category === "Kaution Return") return true;
        return false;
    };

    const untracked = (window.state.transactions || []).filter((t) => {
        if (isTracked(t)) return false;
        const d = String(t.date || "");
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
    });

    const groups = {};
    untracked.forEach((t) => {
        const key = `${t.type}|${t.category || "Uncategorized"}`;
        if (!groups[key]) {
            groups[key] = { type: t.type, category: t.category || "Uncategorized", count: 0, total: 0 };
        }
        groups[key].count += 1;
        groups[key].total += toEUR(t.amount, t.currency);
    });

    return Object.values(groups).sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
}

function renderUntrackedCategoriesCard() {
    const groups = getUntrackedTransactionSummary();
    const list = getElement("untracked-categories-list");

    if (!groups.length) {
        list.innerHTML = '<p class="empty-copy">All transactions in this range are covered by the dashboard categories.</p>';
        return;
    }

    list.innerHTML = groups
        .map((g) => {
            const amountClass = g.total >= 0 ? "amount-positive" : "amount-negative";
            return `
                <div class="list-row">
                    <span>${escapeHtml(g.category)} (${escapeHtml(g.type)}) — ${g.count} tx</span>
                    <strong class="${amountClass}">${escapeHtml(formatMoney(g.total, "EUR"))}</strong>
                </div>`;
        })
        .join("");
}

function renderDashboard() {
    const expenseResult = renderMonthlyBarChart({
        type: "Expense",
        categories: EXPENSE_CATEGORIES,
        totalElementId: "expense-category-total",
        chartElementId: "expense-category-chart",
        emptyMessage: "No expenses in this range.",
        tone: "negative"
    });

    const incomeResult = renderMonthlyBarChart({
        type: "Income",
        categories: ["Income"],
        totalElementId: "income-category-total",
        chartElementId: "income-category-chart",
        emptyMessage: "No income in this range."
    });

    const cashflowResult = renderMonthlyBarChart({
        type: "Income",
        categories: CASHFLOW_CATEGORIES,
        totalElementId: "cashflow-category-total",
        chartElementId: "cashflow-category-chart",
        emptyMessage: "No incoming cash flow in this range."
    });

    const netExpenseResult = renderNetBalanceChart({
        subtractPoints: expenseResult.points,
        fromPoints: cashflowResult.points,
        totalElementId: "net-expense-total",
        chartElementId: "net-expense-chart",
        emptyMessage: "No expenses or incoming cash flow in this range."
    });

    const shortTermLoanResult = renderNetBalanceChart({
        subtractPoints: getMonthlyPoints({ type: "Expense", categories: ["Short Term Loan Given"] }),
        fromPoints: getMonthlyPoints({ type: "Income", categories: ["Short Term Loan Return"] }),
        totalElementId: "short-term-loan-balance-total",
        chartElementId: "short-term-loan-balance-chart",
        emptyMessage: "No short term loan activity in this range."
    });

    const kautionResult = renderNetBalanceChart({
        subtractPoints: getMonthlyPoints({ type: "Expense", categories: ["Kaution Given"] }),
        fromPoints: getMonthlyPoints({ type: "Income", categories: ["Kaution Return"] }),
        totalElementId: "kaution-balance-total",
        chartElementId: "kaution-balance-chart",
        emptyMessage: "No Kaution activity in this range."
    });

    const commerzbankResult = renderAccountBalanceChart({
        accountName: "Commerzbank",
        totalElementId: "account-balance-commerzbank-total",
        chartElementId: "account-balance-commerzbank-chart",
        emptyMessage: "No transactions found for this account in this range."
    });

    const cashResult = renderAccountBalanceChart({
        accountName: "Cash",
        totalElementId: "account-balance-cash-total",
        chartElementId: "account-balance-cash-chart",
        emptyMessage: "No transactions found for this account in this range."
    });

    const revolutResult = renderAccountBalanceChart({
        accountName: "Revolut",
        totalElementId: "account-balance-revolut-total",
        chartElementId: "account-balance-revolut-chart",
        emptyMessage: "No transactions found for this account in this range."
    });

    const scalableCapitalResult = renderAccountBalanceChart({
        accountName: "Scalable Capital",
        totalElementId: "account-balance-scalable-capital-total",
        chartElementId: "account-balance-scalable-capital-chart",
        emptyMessage: "No transactions found for this account in this range."
    });

    const assetsTotal =
        shortTermLoanResult.total +
        kautionResult.total +
        TRACKED_ACCOUNT_NAMES.reduce((sum, name) => sum + getAccountBalanceDelta(name), 0);

    renderOverviewCard({
        incomeTotal: incomeResult.total,
        netExpenseTotal: netExpenseResult.total,
        assetsTotal
    });

    renderUntrackedCategoriesCard();
    renderTotalAssetsChart();
}

function renderOverviewCard({ incomeTotal, netExpenseTotal, assetsTotal }) {
    const incomeElement = getElement("overview-income-total");
    incomeElement.textContent = formatMoney(incomeTotal, "EUR");
    incomeElement.classList.toggle("amount-negative", incomeTotal < 0);
    incomeElement.classList.toggle("amount-positive", incomeTotal >= 0);

    const netExpenseElement = getElement("overview-net-expense-total");
    netExpenseElement.textContent = formatMoney(netExpenseTotal, "EUR");
    netExpenseElement.classList.toggle("amount-negative", netExpenseTotal >= 0);
    netExpenseElement.classList.toggle("amount-positive", netExpenseTotal < 0);

    const assetsElement = getElement("overview-assets-total");
    assetsElement.textContent = formatMoney(assetsTotal, "EUR");
    assetsElement.classList.toggle("amount-negative", assetsTotal < 0);
    assetsElement.classList.toggle("amount-positive", assetsTotal >= 0);

    const balanceTotal = incomeTotal - netExpenseTotal - assetsTotal;
    const balanceElement = getElement("overview-balance-total");
    balanceElement.textContent = formatMoney(balanceTotal, "EUR");
    balanceElement.classList.toggle("amount-negative", balanceTotal < 0);
    balanceElement.classList.toggle("amount-positive", balanceTotal >= 0);
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

    const total = renderBarChartCard({ points, totalElementId, chartElementId, emptyMessage, tone });

    return { points, total };
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

    const total = renderBarChartCard({
        points,
        totalElementId,
        chartElementId,
        emptyMessage,
        tone: "negative",
        colorBySign: "positive-is-negative"
    });

    return { points, total };
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
        return total;
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

    return total;
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

    const total = renderBarChartCard({
        points,
        totalElementId,
        chartElementId,
        emptyMessage,
        colorBySign: "negative-is-negative",
        totalMode: "last"
    });

    return { points, total };
}

function toggleDashboardFilters() {
    const panel = getElement("dashboard-filters-panel");
    panel.hidden = !panel.hidden;
}

window.initializeDashboardRange = initializeDashboardRange;
window.onDashboardRangeChange = onDashboardRangeChange;
window.renderDashboard = renderDashboard;
window.toggleDashboardFilters = toggleDashboardFilters;
