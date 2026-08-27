function toISODate(value) {
    return new Date(value).toISOString().slice(0, 10);
}

function defaultDashboardFromDate() {
    const transactions = window.state.transactions || [];
    const datedTransactions = transactions
        .map((transaction) => String(transaction?.date || "").trim())
        .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));

    if (!datedTransactions.length) {
        return toISODate(new Date());
    }

    return datedTransactions.reduce((earliest, date) => (date < earliest ? date : earliest));
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

const TRACKED_CATEGORY_TYPES = new Set([
    "income",
    "expense",
    "transfer",
    "non_income",
    "non_expense",
    "receivable",
    "payable"
]);

function getDashboardAccountNames() {
    return (window.state.accounts || [])
        .map((account) => String(account?.name || "").trim())
        .filter(Boolean);
}

const DASHBOARD_TREND_SERIES = [
    { key: "income", label: "Income" },
    { key: "netExpenses", label: "Net Expenses" },
    { key: "netWorth", label: "Net Worth" }
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
const dashboardMiniLineCharts = {};
const verticalHoverLinePlugin = {
    id: "verticalHoverLine",
    afterDatasetsDraw(chart, _args, pluginOptions) {
        const tooltip = chart.tooltip;
        if (!tooltip) return;

        const activeElements = tooltip.getActiveElements();
        if (!activeElements.length) return;

        const context = chart.ctx;
        const x = activeElements[0].element.x;
        const yAxis = chart.scales.y;
        if (!yAxis) return;

        context.save();
        context.beginPath();
        context.moveTo(x, yAxis.top);
        context.lineTo(x, yAxis.bottom);
        context.lineWidth = pluginOptions && pluginOptions.lineWidth ? pluginOptions.lineWidth : 1;
        context.strokeStyle = pluginOptions && pluginOptions.color ? pluginOptions.color : "rgba(100, 116, 139, 0.65)";
        context.setLineDash(pluginOptions && pluginOptions.dash ? pluginOptions.dash : [4, 4]);
        context.stroke();
        context.restore();
    }
};

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

function getDashboardCurrency() {
    const accounts = window.state.accounts || [];
    const transactions = window.state.transactions || [];
    const currencies = window.state.currencies || [];

    const transactionCurrency = transactions.find((transaction) => String(transaction.currency || "").trim())?.currency;
    if (transactionCurrency) {
        return String(transactionCurrency).toUpperCase();
    }

    const accountCurrency = accounts.find((account) => String(account.currency || "").trim())?.currency;
    if (accountCurrency) {
        return String(accountCurrency).toUpperCase();
    }

    const listedCurrency = currencies.find((currency) => String(currency || "").trim());
    if (listedCurrency) {
        return String(listedCurrency).toUpperCase();
    }

    return "EUR";
}

function convertAmountToDashboardCurrency(amount, fromCurrency) {
    const targetCurrency = getDashboardCurrency();
    const sourceCurrency = String(fromCurrency || targetCurrency).toUpperCase();

    if (sourceCurrency === targetCurrency) {
        return amount;
    }

    const rates = window.state.currencyRates || {};
    const sourceRate = sourceCurrency === "EUR" ? 1 : rates[sourceCurrency];
    const targetRate = targetCurrency === "EUR" ? 1 : rates[targetCurrency];

    if (typeof sourceRate !== "number" || typeof targetRate !== "number" || targetRate === 0) {
        return amount;
    }

    return (amount * sourceRate) / targetRate;
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

    while (cursor.toISOString().slice(0, 7) <= toMonth) {
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

function getSeriesNameFromLegendLabel(label) {
    return String(label || "Value").split(":")[0].trim() || "Value";
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

function getNetWorthPoints() {
    const liquidPoints = getLiquidAssetsPoints();
    const receivablePoints = getCategoryTypeBalancePoints({ categoryType: "receivable", positiveCashflow: "out" });
    const payablePoints = getCategoryTypeBalancePoints({ categoryType: "payable", positiveCashflow: "in" });

    const liquidByMonth = {};
    liquidPoints.forEach((point) => {
        liquidByMonth[point.month] = point.amount;
    });

    const receivableByMonth = {};
    receivablePoints.forEach((point) => {
        receivableByMonth[point.month] = point.amount;
    });

    const payableByMonth = {};
    payablePoints.forEach((point) => {
        payableByMonth[point.month] = point.amount;
    });

    const months = Array.from(new Set([
        ...Object.keys(liquidByMonth),
        ...Object.keys(receivableByMonth),
        ...Object.keys(payableByMonth)
    ])).sort();

    return months.map((month) => {
        const liquid = liquidByMonth[month] || 0;
        const receivables = receivableByMonth[month] || 0;
        const payables = payableByMonth[month] || 0;

        return {
            month,
            amount: liquid + receivables - payables
        };
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

    const incomePoints = getMonthlyPointsByCategoryType({ categoryTypes: ["income"] });
    const expensePoints = getMonthlyPointsByCategoryType({ categoryTypes: ["expense"], cashflow: "out" });
    const nonExpensePoints = getMonthlyPointsByCategoryType({ categoryTypes: ["non_expense"] });
    const nonIncomePoints = getMonthlyPointsByCategoryType({ categoryTypes: ["non_income"] });
    const expensesByMonth = {};
    expensePoints.forEach((point) => {
        expensesByMonth[point.month] = (expensesByMonth[point.month] || 0) + point.amount;
    });
    nonExpensePoints.forEach((point) => {
        expensesByMonth[point.month] = (expensesByMonth[point.month] || 0) + point.amount;
    });

    const nonIncomeByMonth = {};
    nonIncomePoints.forEach((point) => {
        nonIncomeByMonth[point.month] = point.amount;
    });

    const netExpenseMonths = Array.from(new Set([
        ...Object.keys(expensesByMonth),
        ...Object.keys(nonIncomeByMonth)
    ])).sort();

    const netExpensePoints = netExpenseMonths.map((month) => ({
        month,
        amount: (expensesByMonth[month] || 0) - (nonIncomeByMonth[month] || 0)
    }));
    const netWorthPoints = getNetWorthPoints();

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
            ...netWorthPoints.map((point) => point.month)
        ])
    ).sort();

    return {
        labels,
        series: {
            income: seriesToMap(incomePoints),
            netExpenses: seriesToMap(netExpensePoints),
            netWorth: seriesToMap(netWorthPoints)
        }
    };
}

function renderDashboardTrendChart() {
    const chart = getElement("dashboard-trend-chart");
    const trendData = getDashboardTrendData();
    const dashboardCurrency = getDashboardCurrency();

    if (dashboardTrendChart) {
        dashboardTrendChart.destroy();
        dashboardTrendChart = null;
    }

    if (!trendData || !trendData.labels.length) {
        chart.innerHTML = '<p class="empty-copy">Select a date range.</p>';
        return { incomeTotal: 0, netExpenseTotal: 0, netWorthTotal: 0 };
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
    const netWorthValues = Object.values(trendData.series.netWorth);
    const netWorthTotal = netWorthValues.length ? netWorthValues[netWorthValues.length - 1] : 0;

    dashboardTrendChart = new Chart(canvas, {
        plugins: [verticalHoverLinePlugin],
        type: "line",
        data: {
            labels: trendData.labels.map((month) => formatMonthLabel(month)),
            datasets: [
                
                {
                    label: `Net Worth: ${formatMoney(netWorthTotal, dashboardCurrency)}`,
                    data: trendData.labels.map((month) => trendData.series.netWorth[month] ?? null),
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
                    label: `Net Expenses: ${formatMoney(netExpenseTotal, dashboardCurrency)}`,
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
                    label: `Income: ${formatMoney(incomeTotal, dashboardCurrency)}`,
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
                verticalHoverLine: {
                    color: axisColor
                },
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
                            const seriesName = getSeriesNameFromLegendLabel(context.dataset.label);
                            return `${seriesName}: ${formatMoney(context.parsed.y, dashboardCurrency)}`;
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
                            return formatMoney(value, dashboardCurrency);
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
        netWorthTotal
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
    const currency = account ? account.currency : getDashboardCurrency();

    const monthlyBalances = window.db.getAccountMonthlyBalances(accountName) || [];

    const startMonth = fromMonth ? shiftMonth(fromMonth, -1) : null;
    const startBalance = fromMonth
        ? getAccountBalanceAtMonthEnd(monthlyBalances, startMonth, openingBalance)
        : openingBalance;
    const endBalance = getAccountBalanceAtMonthEnd(monthlyBalances, toMonth, openingBalance);

    return convertAmountToDashboardCurrency(endBalance - startBalance, currency);
}

function getMonthlyTotalsByCategoryType({ categoryTypes, cashflow }) {
    const from = getElement("dashboard-from").value;
    const to = getElement("dashboard-to").value;
    const typeSet = new Set((categoryTypes || []).map((t) => String(t || "").trim().toLowerCase()));

    const matchingTransactions = (window.state.transactions || []).filter((transaction) => {
        const categoryType = String(transaction.categoryType || "").trim().toLowerCase();
        if (!typeSet.has(categoryType)) return false;
        if (cashflow && transaction.cashflow !== cashflow) return false;

        const date = String(transaction.date || "");
        if (from && date < from) return false;
        if (to && date > to) return false;
        return true;
    });

    const totalsByMonth = {};
    matchingTransactions.forEach((transaction) => {
        const month = String(transaction.date || "").slice(0, 7);
        totalsByMonth[month] = (totalsByMonth[month] || 0) + convertAmountToDashboardCurrency(transaction.amount, transaction.currency);
    });

    return totalsByMonth;
}

function getMonthlyPointsByCategoryType({ categoryTypes, cashflow }) {
    const totalsByMonth = getMonthlyTotalsByCategoryType({ categoryTypes, cashflow });

    return Object.entries(totalsByMonth)
        .map(([month, amount]) => ({ month, amount }))
        .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
}

function getCategoryTypeBalancePoints({ categoryType, positiveCashflow }) {
    const from = getElement("dashboard-from").value;
    const to = getElement("dashboard-to").value;
    const fromMonth = from ? from.slice(0, 7) : null;
    const toMonth = to ? to.slice(0, 7) : null;
    const normalizedType = String(categoryType || "").trim().toLowerCase();

    const transactions = (window.state.transactions || [])
        .filter((transaction) => String(transaction.categoryType || "").trim().toLowerCase() === normalizedType)
        .filter((transaction) => {
            const date = String(transaction.date || "");
            return /^\d{4}-\d{2}-\d{2}$/.test(date);
        })
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    if (!transactions.length) return [];

    const impactFor = (transaction) => {
        const convertedAmount = convertAmountToDashboardCurrency(transaction.amount, transaction.currency);
        const oppositeCashflow = positiveCashflow === "in" ? "out" : "in";

        if (transaction.cashflow === positiveCashflow) {
            return convertedAmount;
        }

        if (transaction.cashflow === oppositeCashflow) {
            return -convertedAmount;
        }

        return 0;
    };

    const openingBalance = transactions
        .filter((transaction) => !from || transaction.date < from)
        .reduce((sum, transaction) => sum + impactFor(transaction), 0);

    const inRangeTransactions = transactions.filter((transaction) => {
        if (from && transaction.date < from) return false;
        if (to && transaction.date > to) return false;
        return true;
    });

    const months = fromMonth && toMonth
        ? getMonthRange(fromMonth, toMonth)
        : (() => {
              const firstMonth = transactions[0].date.slice(0, 7);
              const lastMonth = transactions[transactions.length - 1].date.slice(0, 7);
              return getMonthRange(firstMonth, lastMonth);
          })();

    if (!months.length) return [];

    const impactByMonth = {};
    inRangeTransactions.forEach((transaction) => {
        const month = transaction.date.slice(0, 7);
        impactByMonth[month] = (impactByMonth[month] || 0) + impactFor(transaction);
    });

    let runningBalance = openingBalance;
    return months.map((month) => {
        runningBalance += impactByMonth[month] || 0;
        return { month, amount: runningBalance };
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
    const receivablePoints = getCategoryTypeBalancePoints({ categoryType: "receivable", positiveCashflow: "out" });

    const accountsData = getDashboardAccountNames().map((name) => {
        const account = (window.state.accounts || []).find((a) => a.name === name);
        const openingBalance = account ? Number(account.openingBalance) || 0 : 0;
        const currency = account ? account.currency : getDashboardCurrency();
        const monthlyBalances = window.db.getAccountMonthlyBalances(name) || [];
        return { openingBalance, currency, monthlyBalances };
    });

    const points = months.map((month) => {
        const receivableBalance = getAccountBalanceAtMonthEnd(receivablePoints, month, 0);
        const accountsBalance = accountsData.reduce((sum, acc) => {
            const balance = getAccountBalanceAtMonthEnd(acc.monthlyBalances, month, acc.openingBalance);
            return sum + convertAmountToDashboardCurrency(balance, acc.currency);
        }, 0);

        return { month, amount: receivableBalance + accountsBalance };
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

    const isTracked = (t) => TRACKED_CATEGORY_TYPES.has(String(t.categoryType || "").trim().toLowerCase());

    const untracked = (window.state.transactions || []).filter((t) => {
        if (isTracked(t)) return false;
        const d = String(t.date || "");
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
    });

    const groups = {};
    untracked.forEach((t) => {
        const key = `${t.cashflow}|${t.category || "Uncategorized"}`;
        if (!groups[key]) {
            groups[key] = { cashflow: t.cashflow, category: t.category || "Uncategorized", count: 0, total: 0 };
        }
        groups[key].count += 1;
        groups[key].total += convertAmountToDashboardCurrency(t.amount, t.currency);
    });

    return Object.values(groups).sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
}

function renderUntrackedCategoriesCard() {
    const groups = getUntrackedTransactionSummary();
    const list = getElement("untracked-categories-list");
    const dashboardCurrency = getDashboardCurrency();

    if (!groups.length) {
        list.innerHTML = '<p class="empty-copy">All transactions in this range are covered by the dashboard categories.</p>';
        return;
    }

    list.innerHTML = groups
        .map((g) => {
            const amountClass = g.total >= 0 ? "amount-positive" : "amount-negative";
            return `
                <div class="list-row">
                    <span>${escapeHtml(g.category)} (${escapeHtml(formatCashflowLabel(g.cashflow))}) — ${g.count} tx</span>
                        <strong class="${amountClass}">${escapeHtml(formatMoney(g.total, dashboardCurrency))}</strong>
                </div>`;
        })
        .join("");
}

const getNetBalanceSeries = (subtractSeries, fromSeries) => {
    const subtractByMonth = {};
    subtractSeries.forEach((point) => {
        subtractByMonth[point.month] = point.amount;
    });

    const fromByMonth = {};
    fromSeries.forEach((point) => {
        fromByMonth[point.month] = point.amount;
    });

    const months = new Set([...Object.keys(subtractByMonth), ...Object.keys(fromByMonth)]);

    return Array.from(months)
        .map((month) => ({
            month,
            amount: (subtractByMonth[month] || 0) - (fromByMonth[month] || 0)
        }))
        .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
};

function renderLoanKautionBalanceChart() {
    const receivablePoints = getCategoryTypeBalancePoints({ categoryType: "receivable", positiveCashflow: "out" });
    const combinedTotal = receivablePoints.length ? receivablePoints[receivablePoints.length - 1].amount : 0;
    const combinedTotalElement = getElement("loan-kaution-balance-total");
    const dashboardCurrency = getDashboardCurrency();

    combinedTotalElement.textContent = formatMoney(combinedTotal, dashboardCurrency);
    combinedTotalElement.classList.toggle("amount-negative", combinedTotal < 0);
    combinedTotalElement.classList.toggle("amount-positive", combinedTotal >= 0);

    const months = receivablePoints.map((point) => point.month);
    const chartElementId = "loan-kaution-balance-chart";
    const chartHost = getElement(chartElementId);

    if (dashboardMiniLineCharts[chartElementId]) {
        dashboardMiniLineCharts[chartElementId].destroy();
        dashboardMiniLineCharts[chartElementId] = null;
    }

    if (!months.length) {
        chartHost.innerHTML = '<p class="empty-copy">No receivable activity in this range.</p>';
        return { combinedTotal };
    }

    chartHost.innerHTML = `<canvas id="${chartElementId}-canvas"></canvas>`;
    const canvas = getElement(`${chartElementId}-canvas`);
    const textColor = getThemeColor("--color-text-muted", "#64748b");
    const axisColor = getThemeColor("--color-border", "#cbd5e1");
    const gridColor = getThemeColor("--color-border-light", "#e2e8f0");
    const receivableColor = getThemeColor("--color-positive-mid", "#16a34a");

    dashboardMiniLineCharts[chartElementId] = new Chart(canvas, {
        plugins: [verticalHoverLinePlugin],
        type: "line",
        data: {
            labels: months.map((month) => formatMonthLabel(month)),
            datasets: [
                {
                    label: `Receivables: ${formatMoney(combinedTotal, dashboardCurrency)}`,
                    data: receivablePoints.map((point) => point.amount),
                    borderColor: receivableColor,
                    backgroundColor: "transparent",
                    pointBackgroundColor: receivableColor,
                    pointBorderColor: receivableColor,
                    pointRadius: 0,
                    pointHoverRadius: 3,
                    borderWidth: 2,
                    tension: 0.3,
                    fill: false
                }
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
                verticalHoverLine: {
                    color: axisColor
                },
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
                            const seriesName = getSeriesNameFromLegendLabel(context.dataset.label);
                            return `${seriesName}: ${formatMoney(context.parsed.y, dashboardCurrency)}`;
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
                        autoSkip: true,
                        maxTicksLimit: 6
                    },
                    border: {
                        color: axisColor
                    }
                },
                y: {
                    ticks: {
                        color: textColor,
                        callback(value) {
                            return formatMoney(value, dashboardCurrency);
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

    return { combinedTotal };
}

function renderPayablesBalanceChart() {
    const payablesPoints = getCategoryTypeBalancePoints({ categoryType: "payable", positiveCashflow: "in" });
    const total = payablesPoints.length ? payablesPoints[payablesPoints.length - 1].amount : 0;
    const totalElement = getElement("payables-balance-total");
    const dashboardCurrency = getDashboardCurrency();

    totalElement.textContent = formatMoney(total, dashboardCurrency);
    totalElement.classList.toggle("amount-negative", total >= 0);
    totalElement.classList.toggle("amount-positive", total < 0);

    const months = payablesPoints.map((point) => point.month);
    const chartElementId = "payables-balance-chart";
    const chartHost = getElement(chartElementId);

    if (dashboardMiniLineCharts[chartElementId]) {
        dashboardMiniLineCharts[chartElementId].destroy();
        dashboardMiniLineCharts[chartElementId] = null;
    }

    if (!months.length) {
        chartHost.innerHTML = '<p class="empty-copy">No payable activity in this range.</p>';
        return { total };
    }

    chartHost.innerHTML = `<canvas id="${chartElementId}-canvas"></canvas>`;
    const canvas = getElement(`${chartElementId}-canvas`);
    const textColor = getThemeColor("--color-text-muted", "#64748b");
    const axisColor = getThemeColor("--color-border", "#cbd5e1");
    const gridColor = getThemeColor("--color-border-light", "#e2e8f0");
    const payablesColor = "#ef4444";

    dashboardMiniLineCharts[chartElementId] = new Chart(canvas, {
        plugins: [verticalHoverLinePlugin],
        type: "line",
        data: {
            labels: months.map((month) => formatMonthLabel(month)),
            datasets: [
                {
                    label: `Payables: ${formatMoney(total, dashboardCurrency)}`,
                    data: payablesPoints.map((point) => point.amount),
                    borderColor: payablesColor,
                    backgroundColor: "transparent",
                    pointBackgroundColor: payablesColor,
                    pointBorderColor: payablesColor,
                    pointRadius: 0,
                    pointHoverRadius: 3,
                    borderWidth: 2,
                    tension: 0.3,
                    fill: false
                }
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
                verticalHoverLine: {
                    color: axisColor
                },
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
                            const seriesName = getSeriesNameFromLegendLabel(context.dataset.label);
                            return `${seriesName}: ${formatMoney(context.parsed.y, dashboardCurrency)}`;
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
                        autoSkip: true,
                        maxTicksLimit: 6
                    },
                    border: {
                        color: axisColor
                    }
                },
                y: {
                    ticks: {
                        color: textColor,
                        callback(value) {
                            return formatMoney(value, dashboardCurrency);
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

    return { total };
}

function getSourceAccountsSeriesData() {
    const from = getElement("dashboard-from").value;
    const to = getElement("dashboard-to").value;
    const fromMonth = from ? from.slice(0, 7) : null;
    const toMonth = to ? to.slice(0, 7) : null;

    const seriesByAccount = {};
    const monthsSet = new Set();

    const accountNames = getDashboardAccountNames();

    accountNames.forEach((accountName) => {
        const points = (window.db.getAccountMonthlyBalances(accountName) || [])
            .filter((entry) => {
                if (fromMonth && entry.month < fromMonth) return false;
                if (toMonth && entry.month > toMonth) return false;
                return true;
            })
            .map((entry) => ({
                month: entry.month,
                amount: convertAmountToDashboardCurrency(entry.balance, entry.currency)
            }));

        const byMonth = {};
        points.forEach((point) => {
            byMonth[point.month] = point.amount;
            monthsSet.add(point.month);
        });

        seriesByAccount[accountName] = byMonth;
    });

    return {
        accountNames,
        seriesByAccount,
        months: Array.from(monthsSet).sort()
    };
}

function getLiquidAssetsPoints() {
    const { accountNames, seriesByAccount, months } = getSourceAccountsSeriesData();
    return months.map((month) => ({
        month,
        amount: accountNames.reduce((sum, accountName) => {
            const byMonth = seriesByAccount[accountName] || {};
            return sum + (byMonth[month] || 0);
        }, 0)
    }));
}

function renderSourceAccountsBalanceChart() {
    const { accountNames, seriesByAccount, months } = getSourceAccountsSeriesData();
    const chartElementId = "source-accounts-balance-chart";
    const chartHost = getElement(chartElementId);
    const totalElement = getElement("source-accounts-balance-total");
    const dashboardCurrency = getDashboardCurrency();

    if (dashboardMiniLineCharts[chartElementId]) {
        dashboardMiniLineCharts[chartElementId].destroy();
        dashboardMiniLineCharts[chartElementId] = null;
    }

    if (!months.length) {
        totalElement.textContent = formatMoney(0, dashboardCurrency);
        totalElement.classList.toggle("amount-negative", false);
        totalElement.classList.toggle("amount-positive", true);
        chartHost.innerHTML = '<p class="empty-copy">No account balance data found in this range.</p>';
        return { total: 0 };
    }

    const textColor = getThemeColor("--color-text-muted", "#64748b");
    const axisColor = getThemeColor("--color-border", "#cbd5e1");
    const gridColor = getThemeColor("--color-border-light", "#e2e8f0");

    const palette = [
        "#1d4ed8",
        "#0f766e",
        "#16a34a",
        "#ca8a04",
        "#9333ea",
        "#dc2626",
        "#0891b2",
        "#b45309",
        "#4f46e5",
        "#047857"
    ];

    const datasets = accountNames.map((accountName, index) => {
        const byMonth = seriesByAccount[accountName] || {};
        const values = months.map((month) => (byMonth[month] == null ? null : byMonth[month]));
        const lastValue = [...values].reverse().find((value) => value != null) || 0;
        const color = palette[index % palette.length];

        return {
            label: `${accountName}: ${formatMoney(lastValue, dashboardCurrency)}`,
            data: values,
            borderColor: color,
            backgroundColor: "transparent",
            pointBackgroundColor: color,
            pointBorderColor: color,
            pointRadius: 0,
            pointHoverRadius: 3,
            borderWidth: 2,
            tension: 0.3,
            fill: false
        };
    });

    const total = accountNames.reduce((sum, accountName) => {
        const byMonth = seriesByAccount[accountName] || {};
        const latestMonth = months[months.length - 1];
        const latestValue = byMonth[latestMonth] || 0;
        return sum + latestValue;
    }, 0);

    totalElement.textContent = formatMoney(total, dashboardCurrency);
    totalElement.classList.toggle("amount-negative", total < 0);
    totalElement.classList.toggle("amount-positive", total >= 0);

    chartHost.innerHTML = `<canvas id="${chartElementId}-canvas"></canvas>`;
    const canvas = getElement(`${chartElementId}-canvas`);

    dashboardMiniLineCharts[chartElementId] = new Chart(canvas, {
        plugins: [verticalHoverLinePlugin],
        type: "line",
        data: {
            labels: months.map((month) => formatMonthLabel(month)),
            datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: "index",
                intersect: false
            },
            plugins: {
                verticalHoverLine: {
                    color: axisColor
                },
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
                            const seriesName = getSeriesNameFromLegendLabel(context.dataset.label);
                            return `${seriesName}: ${formatMoney(context.parsed.y, dashboardCurrency)}`;
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
                        autoSkip: true,
                        maxTicksLimit: 6
                    },
                    border: {
                        color: axisColor
                    }
                },
                y: {
                    ticks: {
                        color: textColor,
                        callback(value) {
                            return formatMoney(value, dashboardCurrency);
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

    return { total };
}

function renderDashboard() {
    const trendTotals = renderDashboardTrendChart();

    renderMonthlyLineChartByCategoryType({
        categoryTypes: ["income"],
        totalElementId: "income-category-total",
        chartElementId: "income-category-chart",
        emptyMessage: "No incomes in this range."
    });

    renderMonthlyLineChartByCategoryType({
        categoryTypes: ["expense"],
        cashflow: "out",
        totalElementId: "expense-category-total",
        chartElementId: "expense-category-chart",
        emptyMessage: "No expenses in this range.",
        tone: "negative"
    });

    renderMonthlyLineChartByCategoryType({
        categoryTypes: ["non_income"],
        totalElementId: "cashflow-category-total",
        chartElementId: "cashflow-category-chart",
        emptyMessage: "No incoming cash flow in this range."
    });

    renderMonthlyLineChartByCategoryType({
        categoryTypes: ["non_expense"],
        totalElementId: "non-expense-category-total",
        chartElementId: "non-expense-category-chart",
        emptyMessage: "No non-expenses in this range.",
        tone: "negative"
    });

    const receivablesResult = renderLoanKautionBalanceChart();
    const payablesResult = renderPayablesBalanceChart();
    const liquidAssetsResult = renderSourceAccountsBalanceChart();

    const netWorthTotal =
        liquidAssetsResult.total +
        receivablesResult.combinedTotal -
        payablesResult.total;

    const balanceNetWorth = trendTotals.netWorthTotal;

    renderOverviewCard({
        incomeTotal: trendTotals.incomeTotal,
        netExpenseTotal: trendTotals.netExpenseTotal,
        netWorthTotal,
        reconciliationGap: netWorthTotal - balanceNetWorth
    });

    renderQuickOverviewCard({
        netWorthTotal,
        liquidAssetsTotal: liquidAssetsResult.total,
        receivablesTotal: receivablesResult.combinedTotal,
        payablesTotal: payablesResult.total
    });

    renderUntrackedCategoriesCard();
}

function renderQuickOverviewCard({ netWorthTotal, liquidAssetsTotal, receivablesTotal, payablesTotal }) {
    const dashboardCurrency = getDashboardCurrency();

    const setAmount = (elementId, value, isNegative = value < 0) => {
        const element = getElement(elementId);
        if (!element) return;
        element.textContent = formatMoney(value, dashboardCurrency);
        element.classList.toggle("amount-negative", isNegative);
        element.classList.toggle("amount-positive", !isNegative);
    };

    setAmount("quick-net-worth", netWorthTotal);
    setAmount("quick-liquid-assets", liquidAssetsTotal);
    setAmount("quick-receivables", receivablesTotal);
    setAmount("quick-payables", payablesTotal, payablesTotal > 0);
}

function renderOverviewCard({ incomeTotal, netExpenseTotal, netWorthTotal, reconciliationGap }) {
    const dashboardCurrency = getDashboardCurrency();
    const incomeElement = getElement("overview-income-total");
    incomeElement.textContent = formatMoney(incomeTotal, dashboardCurrency);
    incomeElement.classList.toggle("amount-negative", incomeTotal < 0);
    incomeElement.classList.toggle("amount-positive", incomeTotal >= 0);

    const netExpenseElement = getElement("overview-net-expense-total");
    netExpenseElement.textContent = formatMoney(netExpenseTotal, dashboardCurrency);
    netExpenseElement.classList.toggle("amount-negative", netExpenseTotal >= 0);
    netExpenseElement.classList.toggle("amount-positive", netExpenseTotal < 0);

    const assetsElement = getElement("overview-assets-total");
    assetsElement.textContent = formatMoney(netWorthTotal, dashboardCurrency);
    assetsElement.classList.toggle("amount-negative", netWorthTotal < 0);
    assetsElement.classList.toggle("amount-positive", netWorthTotal >= 0);

    const balanceElement = getElement("overview-balance-total");
    balanceElement.textContent = formatMoney(reconciliationGap, dashboardCurrency);
    balanceElement.classList.toggle("amount-negative", reconciliationGap < 0);
    balanceElement.classList.toggle("amount-positive", reconciliationGap >= 0);
}

function getMonthlyTotalsForTransactions({ cashflow, categories }) {
    const from = getElement("dashboard-from").value;
    const to = getElement("dashboard-to").value;

    const matchingTransactions = (window.state.transactions || []).filter((t) => {
        if (t.cashflow !== cashflow || !categories.includes(t.category)) return false;
        const d = String(t.date || "");
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
    });

    const totalsByMonth = {};
    matchingTransactions.forEach((t) => {
        const key = String(t.date || "").slice(0, 7); // YYYY-MM
        totalsByMonth[key] = (totalsByMonth[key] || 0) + convertAmountToDashboardCurrency(t.amount, t.currency);
    });

    return totalsByMonth;
}

function renderMonthlyLineChartByCategoryType({ categoryTypes, cashflow, totalElementId, chartElementId, emptyMessage, tone = "positive" }) {
    const points = getMonthlyPointsByCategoryType({ categoryTypes, cashflow });
    const total = points.reduce((sum, point) => sum + point.amount, 0);
    const totalElement = getElement(totalElementId);
    const dashboardCurrency = getDashboardCurrency();

    totalElement.textContent = formatMoney(total, dashboardCurrency);
    totalElement.classList.toggle("amount-negative", tone === "negative");
    totalElement.classList.toggle("amount-positive", tone !== "negative");

    const chartHost = getElement(chartElementId);
    if (dashboardMiniLineCharts[chartElementId]) {
        dashboardMiniLineCharts[chartElementId].destroy();
        dashboardMiniLineCharts[chartElementId] = null;
    }

    if (!points.length) {
        chartHost.innerHTML = `<p class="empty-copy">${escapeHtml(emptyMessage)}</p>`;
        return { points, total };
    }

    chartHost.innerHTML = `<canvas id="${chartElementId}-canvas"></canvas>`;
    const canvas = getElement(`${chartElementId}-canvas`);

    const textColor = getThemeColor("--color-text-muted", "#64748b");
    const axisColor = getThemeColor("--color-border", "#cbd5e1");
    const gridColor = getThemeColor("--color-border-light", "#e2e8f0");
    const lineColor = tone === "negative"
        ? getThemeColor("--color-negative-mid", "#dc2626")
        : getThemeColor("--color-positive-mid", "#16a34a");

    dashboardMiniLineCharts[chartElementId] = new Chart(canvas, {
        plugins: [verticalHoverLinePlugin],
        type: "line",
        data: {
            labels: points.map((point) => formatMonthLabel(point.month)),
            datasets: [
                {
                    data: points.map((point) => point.amount),
                    borderColor: lineColor,
                    backgroundColor: hexToRgba(lineColor, 0.15),
                    pointBackgroundColor: lineColor,
                    pointBorderColor: lineColor,
                    pointRadius: 0,
                    pointHoverRadius: 3,
                    borderWidth: 2,
                    tension: 0.3,
                    fill: true
                }
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
                verticalHoverLine: {
                    color: axisColor
                },
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label(context) {
                            return formatMoney(context.parsed.y, dashboardCurrency);
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
                        autoSkip: true,
                        maxTicksLimit: 6
                    },
                    border: {
                        color: axisColor
                    }
                },
                y: {
                    ticks: {
                        color: textColor,
                        callback(value) {
                            return formatMoney(value, dashboardCurrency);
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

    return { points, total };
}

function getMonthlyPoints({ cashflow, categories }) {
    const totalsByMonth = getMonthlyTotalsForTransactions({ cashflow, categories });

    return Object.entries(totalsByMonth)
        .map(([month, amount]) => ({ month, amount }))
        .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
}

function renderMonthlyBarChart({ cashflow, categories, totalElementId, chartElementId, emptyMessage, tone = "positive" }) {
    const points = getMonthlyPoints({ cashflow, categories });

    const total = renderBarChartCard({ points, totalElementId, chartElementId, emptyMessage, tone });

    return { points, total };
}

function renderMonthlyLineChart({ cashflow, categories, totalElementId, chartElementId, emptyMessage, tone = "positive" }) {
    const points = getMonthlyPoints({ cashflow, categories });
    const total = points.reduce((sum, point) => sum + point.amount, 0);
    const totalElement = getElement(totalElementId);
    const dashboardCurrency = getDashboardCurrency();

    totalElement.textContent = formatMoney(total, dashboardCurrency);
    totalElement.classList.toggle("amount-negative", tone === "negative");
    totalElement.classList.toggle("amount-positive", tone !== "negative");

    const chartHost = getElement(chartElementId);
    if (dashboardMiniLineCharts[chartElementId]) {
        dashboardMiniLineCharts[chartElementId].destroy();
        dashboardMiniLineCharts[chartElementId] = null;
    }

    if (!points.length) {
        chartHost.innerHTML = `<p class="empty-copy">${escapeHtml(emptyMessage)}</p>`;
        return { points, total };
    }

    chartHost.innerHTML = `<canvas id="${chartElementId}-canvas"></canvas>`;
    const canvas = getElement(`${chartElementId}-canvas`);

    const textColor = getThemeColor("--color-text-muted", "#64748b");
    const axisColor = getThemeColor("--color-border", "#cbd5e1");
    const gridColor = getThemeColor("--color-border-light", "#e2e8f0");
    const lineColor = tone === "negative"
        ? getThemeColor("--color-negative-mid", "#dc2626")
        : getThemeColor("--color-positive-mid", "#16a34a");

    dashboardMiniLineCharts[chartElementId] = new Chart(canvas, {
        plugins: [verticalHoverLinePlugin],
        type: "line",
        data: {
            labels: points.map((point) => formatMonthLabel(point.month)),
            datasets: [
                {
                    data: points.map((point) => point.amount),
                    borderColor: lineColor,
                    backgroundColor: hexToRgba(lineColor, 0.15),
                    pointBackgroundColor: lineColor,
                    pointBorderColor: lineColor,
                    pointRadius: 0,
                    pointHoverRadius: 3,
                    borderWidth: 2,
                    tension: 0.3,
                    fill: true
                }
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
                verticalHoverLine: {
                    color: axisColor
                },
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label(context) {
                            return formatMoney(context.parsed.y, dashboardCurrency);
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
                        autoSkip: true,
                        maxTicksLimit: 6
                    },
                    border: {
                        color: axisColor
                    }
                },
                y: {
                    ticks: {
                        color: textColor,
                        callback(value) {
                            return formatMoney(value, dashboardCurrency);
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
    const dashboardCurrency = getDashboardCurrency();
    totalElement.textContent = formatMoney(total, dashboardCurrency);

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
                <div class="bar-chart-col" title="${escapeHtml(p.month)}: ${escapeHtml(formatMoney(p.amount, dashboardCurrency))}">
                    <span class="bar-chart-value">${escapeHtml(formatMoney(p.amount, dashboardCurrency))}</span>
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

    const monthlyBalances = (window.db.getAccountMonthlyBalances(accountName) || []).filter((entry) => {
        if (fromMonth && entry.month < fromMonth) return false;
        if (toMonth && entry.month > toMonth) return false;
        return true;
    });

    const points = monthlyBalances.map((entry) => ({
        month: entry.month,
        amount: convertAmountToDashboardCurrency(entry.balance, entry.currency)
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
