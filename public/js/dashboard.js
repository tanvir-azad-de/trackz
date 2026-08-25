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
    "Bank Charges",
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

const DASHBOARD_TREND_SERIES = [
    { key: "income", label: "Income" },
    { key: "netExpenses", label: "Net Expenses" },
    { key: "totalAssets", label: "Total Assets" }
];

const MONTH_NAMES = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec"
];

let dashboardTrendChart = null;

function getThemeColor(variableName, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
    return value || fallback;
}

function hexToRgba(hexColor, alpha) {
    const normalized = String(hexColor || "").trim();
    const hex = normalized.startsWith("#") ? normalized.slice(1) : normalized;

    if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(hex)) {
        return normalized;
    }

    const expanded = hex.length === 3 ? hex.split("").map((part) => part + part).join("") : hex;
    const numeric = Number.parseInt(expanded, 16);
    const red = (numeric >> 16) & 255;
    const green = (numeric >> 8) & 255;
    const blue = numeric & 255;

    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
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

function formatMonthLabel(month) {
    const [year, monthNumber] = String(month || "").split("-");
    const monthIndex = Number(monthNumber) - 1;

    if (!year || Number.isNaN(monthIndex) || monthIndex < 0 || monthIndex >= MONTH_NAMES.length) {
        return month;
    }

    return `${MONTH_NAMES[monthIndex]} ${year}`;
}

function getNetBalancePoints({ subtractPoints, fromPoints }) {
    const subtractByMonth = {};
    subtractPoints.forEach((point) => {
        subtractByMonth[point.month] = point.amount;
    });

    const fromByMonth = {};
    fromPoints.forEach((point) => {
        fromByMonth[point.month] = point.amount;
    });

    const months = new Set([...Object.keys(subtractByMonth), ...Object.keys(fromByMonth)]);

    return Array.from(months)
        .map((month) => ({
            month,
            amount: (subtractByMonth[month] || 0) - (fromByMonth[month] || 0)
        }))
        .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
}

function getTotalAssetsPoints() {
    const from = getElement("dashboard-from").value;
    const to = getElement("dashboard-to").value;
    const fromMonth = from ? from.slice(0, 7) : null;
    const toMonth = to ? to.slice(0, 7) : null;

    if (!fromMonth || !toMonth) {
        return [];
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
        const account = (window.state.accounts || []).find((accountItem) => accountItem.name === name);
        const openingBalance = account ? Number(account.openingBalance) || 0 : 0;
        const currency = account ? account.currency : "EUR";
        const monthlyBalances = window.db.getAccountMonthlyBalances(name) || [];
        return { openingBalance, currency, monthlyBalances };
    });

    return months.map((month) => {
        const loanBalance = getAccountBalanceAtMonthEnd(loanCumulative, month, 0);
        const kautionBalance = getAccountBalanceAtMonthEnd(kautionCumulative, month, 0);
        const accountsBalance = accountsData.reduce((sum, accountData) => {
            const balance = getAccountBalanceAtMonthEnd(
                accountData.monthlyBalances,
                month,
                accountData.openingBalance
            );
            return sum + toEUR(balance, accountData.currency);
        }, 0);

        return { month, amount: loanBalance + kautionBalance + accountsBalance };
    });
}

function getDashboardTrendData() {
    const from = getElement("dashboard-from").value;
    const to = getElement("dashboard-to").value;
    const fromMonth = from ? from.slice(0, 7) : null;
    const toMonth = to ? to.slice(0, 7) : null;

    if (!fromMonth || !toMonth) {
        return null;
    }

    const incomePoints = getMonthlyPoints({ type: "Income", categories: ["Income"] });
    const expensePoints = getMonthlyPoints({ type: "Expense", categories: EXPENSE_CATEGORIES });
    const cashflowPoints = getMonthlyPoints({ type: "Income", categories: CASHFLOW_CATEGORIES });
    const netExpensePoints = getNetBalancePoints({ subtractPoints: expensePoints, fromPoints: cashflowPoints });
    const totalAssetsPoints = getTotalAssetsPoints();

    const seriesToMap = (points) => {
        const lookup = {};
        points.forEach((point) => {
            lookup[point.month] = point.amount;
        });
        return lookup;
    };

    const labels = Array.from(
        new Set([
            ...incomePoints.map((point) => point.month),
            ...netExpensePoints.map((point) => point.month),
            ...totalAssetsPoints.map((point) => point.month)
        ])
    ).sort();

    return {
        labels,
        series: {
            income: seriesToMap(incomePoints),
            netExpenses: seriesToMap(netExpensePoints),
            totalAssets: seriesToMap(totalAssetsPoints)
        }
    };
}

function renderDashboardTrendChart() {
    const chart = getElement("dashboard-trend-chart");
    const trendData = getDashboardTrendData();

    if (dashboardTrendChart) {
        dashboardTrendChart.destroy();
        dashboardTrendChart = null;
    }

    if (!trendData || !trendData.labels.length) {
        chart.innerHTML = '<p class="empty-copy">Select a date range.</p>';
        return { incomeTotal: 0, netExpenseTotal: 0, assetsTotal: 0 };
    }

    chart.innerHTML = '<canvas id="dashboard-trend-chart-canvas"></canvas>';

    const canvas = getElement("dashboard-trend-chart-canvas");
    const incomeColor = getThemeColor("--color-positive-mid", "#16a34a");
    const expenseColor = getThemeColor("--color-negative-mid", "#dc2626");
    const assetColor = getThemeColor("--color-primary", "#2563eb");
    const gridColor = getThemeColor("--color-border-light", "#e2e8f0");
    const textColor = getThemeColor("--color-text-muted", "#64748b");
    const axisColor = getThemeColor("--color-border", "#cbd5e1");

    const incomeTotal = Object.values(trendData.series.income).reduce((sum, amount) => sum + amount, 0);
    const netExpenseTotal = Object.values(trendData.series.netExpenses).reduce((sum, amount) => sum + amount, 0);
    const assetsValues = Object.values(trendData.series.totalAssets);
    const assetsTotal = assetsValues.length ? assetsValues[assetsValues.length - 1] : 0;

    dashboardTrendChart = new Chart(canvas, {
        type: "line",
        data: {
            labels: trendData.labels.map((month) => formatMonthLabel(month)),
            datasets: [
                
                {
                    label: "Total Assets",
                    data: trendData.labels.map((month) => trendData.series.totalAssets[month] ?? null),
                    borderColor: assetColor,
                    backgroundColor: hexToRgba(assetColor, 0.1),
                    pointBackgroundColor: assetColor,
                    pointBorderColor: assetColor,
                    pointRadius: 0,
                    pointHoverRadius: 3,
                    borderWidth: 2,
                    tension: 0.35,
                    fill: false
                },
                {
                    label: "Net Expenses",
                    data: trendData.labels.map((month) => trendData.series.netExpenses[month] ?? null),
                    borderColor: expenseColor,
                    backgroundColor: hexToRgba(expenseColor, 0.1),
                    pointBackgroundColor: expenseColor,
                    pointBorderColor: expenseColor,
                    pointRadius: 0,
                    pointHoverRadius: 3,
                    borderWidth: 2,
                    tension: 0.35,
                    fill: true
                },
                {
                    label: "Income",
                    data: trendData.labels.map((month) => trendData.series.income[month] ?? null),
                    borderColor: incomeColor,
                    backgroundColor: hexToRgba(incomeColor, 0.1),
                    pointBackgroundColor: incomeColor,
                    pointBorderColor: incomeColor,
                    pointRadius: 0,
                    pointHoverRadius: 3,
                    borderWidth: 2,
                    tension: 0.35,
                    fill: false
                },
                
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: "index",
                intersect: false
            },
            plugins: {
                legend: {
                    position: "top",
                    labels: {
                        usePointStyle: true,
                        pointStyle: "box",
                        boxWidth: 5,
                        boxHeight: 5,
                        color: textColor,
                        font: {
                            size: 14,
                            weight: "600"
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label(context) {
                            return `${context.dataset.label}: ${formatMoney(context.parsed.y, "EUR")}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        color: textColor,
                        maxRotation: 0,
                        autoSkip: true
                    },
                    border: {
                        color: axisColor
                    }
                },
                y: {
                    beginAtZero: false,
                    ticks: {
                        color: textColor,
                        callback(value) {
                            return formatMoney(value, "EUR");
                        }
                    },
                    grid: {
                        color: gridColor
                    },
                    border: {
                        color: axisColor
                    }
                }
            }
        }
    });

    return {
        incomeTotal,
        netExpenseTotal,
        assetsTotal
    };
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
    const trendTotals = renderDashboardTrendChart();

    const expenseResult = renderMonthlyBarChart({
        type: "Expense",
        categories: EXPENSE_CATEGORIES,
        totalElementId: "expense-category-total",
        chartElementId: "expense-category-chart",
        emptyMessage: "No expenses in this range.",
        tone: "negative"
    });

    const cashflowResult = renderMonthlyBarChart({
        type: "Income",
        categories: CASHFLOW_CATEGORIES,
        totalElementId: "cashflow-category-total",
        chartElementId: "cashflow-category-chart",
        emptyMessage: "No incoming cash flow in this range."
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
        incomeTotal: trendTotals.incomeTotal,
        netExpenseTotal: trendTotals.netExpenseTotal,
        assetsTotal
    });

    renderUntrackedCategoriesCard();
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
