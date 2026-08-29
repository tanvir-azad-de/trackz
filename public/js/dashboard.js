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

    if (!fromInput.value && !toInput.value) {
        const defaultRange = getDashboardRangeByPreset("last_3_months");
        if (defaultRange) {
            fromInput.value = defaultRange.from;
            toInput.value = defaultRange.to;
        }
    }

    if (!fromInput.value) {
        fromInput.value = defaultDashboardFromDate();
    }

    if (!toInput.value) {
        toInput.value = toISODate(new Date());
    }

    syncDashboardRangePresetFromInputs();
}

function getDashboardAvailableDateBounds() {
    const transactions = window.state.transactions || [];
    const validDates = transactions
        .map((transaction) => String(transaction?.date || "").trim())
        .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));

    if (!validDates.length) {
        const today = toISODate(new Date());
        return { from: today, to: today };
    }

    const from = validDates.reduce((earliest, date) => (date < earliest ? date : earliest));
    const to = validDates.reduce((latest, date) => (date > latest ? date : latest));
    return { from, to };
}

function getDashboardThisMonthRange() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    return {
        from: `${year}-${month}-01`,
        to: toISODate(today)
    };
}

function getDashboardLastMonthsRange(monthCount) {
    const today = new Date();
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (monthCount - 1), 1));
    return {
        from: start.toISOString().slice(0, 10),
        to: toISODate(today)
    };
}

function getDashboardYearToDateRange() {
    const today = new Date();
    const start = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
    return {
        from: start.toISOString().slice(0, 10),
        to: toISODate(today)
    };
}

function getDashboardRangeByPreset(preset) {
    switch (preset) {
        case "this_month":
            return getDashboardThisMonthRange();
        case "last_3_months":
            return getDashboardLastMonthsRange(3);
        case "last_6_months":
            return getDashboardLastMonthsRange(6);
        case "year_to_date":
            return getDashboardYearToDateRange();
        case "all_time":
            return getDashboardAvailableDateBounds();
        default:
            return null;
    }
}

function syncDashboardRangePresetFromInputs() {
    const presetInput = getElement("dashboard-range-preset");
    if (!presetInput) return;

    const from = getElement("dashboard-from").value;
    const to = getElement("dashboard-to").value;

    const orderedPresets = ["this_month", "last_3_months", "last_6_months", "year_to_date", "all_time"];
    for (const preset of orderedPresets) {
        const range = getDashboardRangeByPreset(preset);
        if (range && from === range.from && to === range.to) {
            presetInput.value = preset;
            return;
        }
    }

    presetInput.value = "custom";
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
    syncDashboardRangePresetFromInputs();
    refreshDashboardSummaryForRange();
}

function onDashboardRangePresetChange() {
    const presetInput = getElement("dashboard-range-preset");
    if (!presetInput) {
        refreshDashboardSummaryForRange();
        return;
    }

    if (presetInput.value === "custom") {
        refreshDashboardSummaryForRange();
        return;
    }

    const fromInput = getElement("dashboard-from");
    const toInput = getElement("dashboard-to");

    const range = getDashboardRangeByPreset(presetInput.value);
    if (!range) {
        refreshDashboardSummaryForRange();
        return;
    }

    fromInput.value = range.from;
    toInput.value = range.to;
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

const DASHBOARD_BREAKDOWN_CONFIG = {
    liquid: { title: "Assets: Liquid", source: "accounts" },
    receivables: { title: "Assets: Receivables", source: "category", categoryType: "receivable" },
    payables: { title: "Liabilities: Payables", source: "category", categoryType: "payable" },
    expenses: { title: "Expenses", source: "category", categoryType: "expense", cashflow: "out" },
    incomes: { title: "Incomes", source: "category", categoryType: "income", cashflow: "in" },
    non_expenses: { title: "Non Expenses", source: "category", categoryType: "non_expense" },
    non_incomes: { title: "Non Incomes", source: "category", categoryType: "non_income" }
};

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

    const transactionCurrency = transactions.find((transaction) => String(transaction.currency || "").trim())?.currency;
    if (transactionCurrency) {
        return String(transactionCurrency).toUpperCase();
    }

    const accountCurrency = accounts.find((account) => String(account.currency || "").trim())?.currency;
    if (accountCurrency) {
        return String(accountCurrency).toUpperCase();
    }

    return "EUR";
}

function getTransactionCategoryType(transaction) {
    const explicitType = String(transaction?.categoryType || "").trim().toLowerCase();
    if (explicitType) {
        return explicitType;
    }

    const categoryName = String(transaction?.category || "").trim().toLowerCase();
    if (categoryName) {
        const categories = window.state.categories || [];
        const matchedCategory = categories.find((item) => String(item?.name || "").trim().toLowerCase() === categoryName);
        const mappedType = String(matchedCategory?.categoryType || "").trim().toLowerCase();
        if (mappedType) {
            return mappedType;
        }
    }

    const cashflow = String(transaction?.cashflow || "").trim().toLowerCase();
    if (cashflow === "in") return "income";
    if (cashflow === "out") return "expense";
    if (cashflow === "none") return "transfer";
    return "";
}

function convertAmountToDashboardCurrency(amount, _fromCurrency) {
    return Number(amount) || 0;
}

function shiftMonth(monthStr, delta) {
    const [y, m] = monthStr.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    return d.toISOString().slice(0, 7);
}

function getMonthEndDate(monthStr) {
    const [year, month] = String(monthStr || "").split("-").map(Number);
    if (!Number.isFinite(year) || !Number.isFinite(month)) {
        return null;
    }

    return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function minISODate(left, right) {
    if (!left) return right;
    if (!right) return left;
    return left < right ? left : right;
}

function getPreviousISODate(date) {
    if (!date) return "";

    const cursor = new Date(`${date}T00:00:00Z`);
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    return cursor.toISOString().slice(0, 10);
}

function getDashboardRangeGranularity(from, to) {
    if (!from || !to) return "month";

    const [fromYear, fromMonth] = from.slice(0, 7).split("-").map(Number);
    const [toYear, toMonth] = to.slice(0, 7).split("-").map(Number);
    if (!Number.isFinite(fromYear) || !Number.isFinite(fromMonth) || !Number.isFinite(toYear) || !Number.isFinite(toMonth)) {
        return "month";
    }

    const monthSpanInclusive = (toYear - fromYear) * 12 + (toMonth - fromMonth) + 1;
    return monthSpanInclusive <= 3 ? "day" : "month";
}

function getDayRange(from, to) {
    if (!from || !to) return [];

    const days = [];
    let cursor = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);

    while (cursor <= end) {
        days.push(cursor.toISOString().slice(0, 10));
        cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() + 1));
    }

    return days;
}

function getDashboardPeriodRange({ from, to, granularity }) {
    if (!from || !to) return [];
    if (granularity === "day") {
        return getDayRange(from, to);
    }

    return getMonthRange(from.slice(0, 7), to.slice(0, 7));
}

function getPeriodKeyFromDate(date, granularity) {
    return granularity === "day" ? String(date || "") : String(date || "").slice(0, 7);
}

function formatDashboardPeriodLabel(periodKey, granularity) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(periodKey || ""))) {
        return formatDate(periodKey);
    }

    return formatMonthLabel(periodKey);
}

function getBaselinePeriodKey({ from, baselineDate, granularity }) {
    if (!baselineDate) return "";
    if (granularity === "day") return baselineDate;

    const fromDay = Number(String(from || "").slice(8, 10));
    if (fromDay === 1) {
        return shiftMonth(String(from || "").slice(0, 7), -1);
    }

    // For monthly charts starting mid-month, keep the baseline keyed by exact date
    // so the starting value is not incorrectly displayed under the previous month label.
    return baselineDate;
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

function getNetWorthPoints({ granularity, mode = "absolute" }) {
    const liquidPoints = getLiquidAssetsPoints({ granularity, mode });
    const receivablePoints = getCategoryTypeBalancePoints({ categoryType: "receivable", positiveCashflow: "out", granularity, mode });
    const payablePoints = getCategoryTypeBalancePoints({ categoryType: "payable", positiveCashflow: "in", granularity, mode });

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
    const granularity = "month";

    if (!from || !to) {
        return null;
    }

    const incomePoints = getMonthlyPointsByCategoryType({ categoryTypes: ["income"], granularity });
    const expensePoints = getMonthlyPointsByCategoryType({ categoryTypes: ["expense"], cashflow: "out", granularity });
    const nonExpensePoints = getMonthlyPointsByCategoryType({ categoryTypes: ["non_expense"], granularity });
    const nonIncomePoints = getMonthlyPointsByCategoryType({ categoryTypes: ["non_income"], granularity });
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
    const netWorthAbsolutePoints = getNetWorthPoints({ granularity, mode: "absolute" });

    const seriesToMap = (points) => {
        const lookup = {};
        points.forEach((point) => {
            lookup[point.month] = point.amount;
        });
        return lookup;
    };

    const labels = getDashboardPeriodRange({ from, to, granularity });
    const incomeByMonth = seriesToMap(incomePoints);
    const netExpenseByMonth = seriesToMap(netExpensePoints);
    const netWorthAbsoluteByMonth = seriesToMap(netWorthAbsolutePoints);

    const netWorthByMonth = Object.fromEntries(
        labels.map((period) => [period, (incomeByMonth[period] || 0) - (netExpenseByMonth[period] || 0)])
    );

    return {
        granularity,
        labels,
        series: {
            income: Object.fromEntries(labels.map((month) => [month, incomeByMonth[month] || 0])),
            netExpenses: Object.fromEntries(labels.map((month) => [month, netExpenseByMonth[month] || 0])),
            netWorth: netWorthByMonth,
            netWorthAbsolute: Object.fromEntries(labels.map((month) => [month, netWorthAbsoluteByMonth[month] || 0]))
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
        return { incomeTotal: 0, netExpenseTotal: 0, netWorthTotal: 0, netWorthAbsoluteTotal: 0 };
    }

    chart.innerHTML = '<canvas id="dashboard-trend-chart-canvas"></canvas>';

    const canvas = getElement("dashboard-trend-chart-canvas");
    const incomeColor = getThemeColor("--color-info-mid", "#16a34a20");
    const expenseColor = getThemeColor("--color-warning-mid", "#dc262620");
    const balancePositiveColor = getThemeColor("--color-positive-mid", "#16a34a");
    const balanceNegativeColor = getThemeColor("--color-negative-mid", "#dc2626");
    const gridColor = getThemeColor("--color-border-light", "#e2e8f0");
    const textColor = getThemeColor("--color-text-muted", "#64748b");
    const axisColor = getThemeColor("--color-border", "#cbd5e1");

    const incomeTotal = Object.values(trendData.series.income).reduce((sum, amount) => sum + amount, 0);
    const netExpenseTotal = Object.values(trendData.series.netExpenses).reduce((sum, amount) => sum + amount, 0);
    const monthlyBalance = trendData.labels.map(
        (month) => (trendData.series.income[month] || 0) - (trendData.series.netExpenses[month] || 0)
    );
    const netWorthValues = Object.values(trendData.series.netWorth);
    const netWorthTotal = netWorthValues.length ? netWorthValues[netWorthValues.length - 1] : 0;
    const netWorthAbsoluteValues = Object.values(trendData.series.netWorthAbsolute || {});
    const netWorthAbsoluteTotal = netWorthAbsoluteValues.length
        ? netWorthAbsoluteValues[netWorthAbsoluteValues.length - 1]
        : 0;

    dashboardTrendChart = new Chart(canvas, {
        plugins: [verticalHoverLinePlugin],
        type: "line",
        data: {
            labels: trendData.labels.map((period) => formatDashboardPeriodLabel(period, trendData.granularity)),
            datasets: [
                {
                    label: "Net Expenses",
                    type: "bar",
                    grouped: false,
                    data: trendData.labels.map((month) => {
                        const value = trendData.series.netExpenses[month];
                        return value == null ? null : -value;
                    }),
                    borderColor: expenseColor,
                    backgroundColor: hexToRgba(expenseColor, 0.45),
                    pointBackgroundColor: expenseColor,
                    pointBorderColor: expenseColor,
                    borderWidth: 1,
                    borderRadius: 4,
                    barPercentage: 0.72,
                    categoryPercentage: 0.76
                },
                {
                    label: "Income",
                    type: "bar",
                    grouped: false,
                    data: trendData.labels.map((month) => trendData.series.income[month] ?? null),
                    borderColor: incomeColor,
                    backgroundColor: hexToRgba(incomeColor, 0.45),
                    pointBackgroundColor: incomeColor,
                    pointBorderColor: incomeColor,
                    borderWidth: 1,
                    borderRadius: 4,
                    barPercentage: 0.72,
                    categoryPercentage: 0.76
                },
                {
                    label: "Surplus / Deficit",
                    type: "bar",
                    grouped: false,
                    data: monthlyBalance,
                    borderColor(context) {
                        const value = context.parsed?.y ?? 0;
                        return value >= 0 ? balancePositiveColor : balanceNegativeColor;
                    },
                    backgroundColor(context) {
                        const value = context.parsed?.y ?? 0;
                        return hexToRgba(value >= 0 ? balancePositiveColor : balanceNegativeColor, 0.65);
                    },
                    borderWidth: 1,
                    borderRadius: 4,
                    barPercentage: 0.36,
                    categoryPercentage: 0.76
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
                        autoSkip: true,
                        maxTicksLimit: trendData.granularity === "day" ? 10 : 6
                    },
                    border: {
                        color: axisColor
                    }
                },
                y: {
                    beginAtZero: true,
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
        netWorthTotal,
        netWorthAbsoluteTotal
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

function getMonthlyTotalsByCategoryType({ categoryTypes, cashflow, granularity }) {
    const from = getElement("dashboard-from").value;
    const to = getElement("dashboard-to").value;
    const typeSet = new Set((categoryTypes || []).map((t) => String(t || "").trim().toLowerCase()));
    const rangeGranularity = granularity || getDashboardRangeGranularity(from, to);

    const matchingTransactions = (window.state.transactions || []).filter((transaction) => {
        const categoryType = getTransactionCategoryType(transaction);
        if (!typeSet.has(categoryType)) return false;
        if (cashflow && transaction.cashflow !== cashflow) return false;

        const date = String(transaction.date || "");
        if (from && date < from) return false;
        if (to && date > to) return false;
        return true;
    });

    const totalsByMonth = {};
    matchingTransactions.forEach((transaction) => {
        const month = getPeriodKeyFromDate(transaction.date, rangeGranularity);
        totalsByMonth[month] = (totalsByMonth[month] || 0) + convertAmountToDashboardCurrency(transaction.amount, transaction.currency);
    });

    return totalsByMonth;
}

function getMonthlyPointsByCategoryType({ categoryTypes, cashflow, granularity }) {
    const totalsByMonth = getMonthlyTotalsByCategoryType({ categoryTypes, cashflow, granularity });

    return Object.entries(totalsByMonth)
        .map(([month, amount]) => ({ month, amount }))
        .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
}

function getCategoryTypeBalancePoints({ categoryType, positiveCashflow, granularity, mode = "absolute" }) {
    const from = getElement("dashboard-from").value;
    const to = getElement("dashboard-to").value;
    const rangeGranularity = granularity || getDashboardRangeGranularity(from, to);
    const normalizedType = String(categoryType || "").trim().toLowerCase();

    const transactions = (window.state.transactions || [])
        .filter((transaction) => getTransactionCategoryType(transaction) === normalizedType)
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

    const months = from && to
        ? getDashboardPeriodRange({ from, to, granularity: rangeGranularity })
        : (() => {
              const firstDay = transactions[0].date;
              const lastDay = transactions[transactions.length - 1].date;
              return getDashboardPeriodRange({ from: firstDay, to: lastDay, granularity: rangeGranularity });
          })();

    if (!months.length) return [];

    const impactByMonth = {};
    inRangeTransactions.forEach((transaction) => {
        const month = getPeriodKeyFromDate(transaction.date, rangeGranularity);
        impactByMonth[month] = (impactByMonth[month] || 0) + impactFor(transaction);
    });

    let runningBalance = mode === "delta" ? 0 : openingBalance;
    return months.map((month) => {
        runningBalance += impactByMonth[month] || 0;
        return { month, amount: runningBalance };
    });
}

function getCategoryTypeBalanceAtDate({ categoryType, positiveCashflow, date, categoryName = "" }) {
    if (!date) return 0;

    const normalizedType = String(categoryType || "").trim().toLowerCase();
    const normalizedCategoryName = String(categoryName || "").trim().toLowerCase();
    const oppositeCashflow = positiveCashflow === "in" ? "out" : "in";

    const impactFor = (transaction) => {
        const convertedAmount = convertAmountToDashboardCurrency(transaction.amount, transaction.currency);

        if (transaction.cashflow === positiveCashflow) {
            return convertedAmount;
        }

        if (transaction.cashflow === oppositeCashflow) {
            return -convertedAmount;
        }

        return 0;
    };

    return (window.state.transactions || [])
        .filter((transaction) => getTransactionCategoryType(transaction) === normalizedType)
        .filter((transaction) => {
            if (!normalizedCategoryName) return true;
            return String(transaction.category || "").trim().toLowerCase() === normalizedCategoryName;
        })
        .filter((transaction) => {
            const transactionDate = String(transaction.date || "");
            if (!/^\d{4}-\d{2}-\d{2}$/.test(transactionDate)) return false;
            return transactionDate <= date;
        })
        .reduce((sum, transaction) => sum + impactFor(transaction), 0);
}

function getCategoryTypeCategoryNames(categoryType) {
    const normalizedType = String(categoryType || "").trim().toLowerCase();
    const names = new Set();

    (window.state.transactions || []).forEach((transaction) => {
        const transactionDate = String(transaction.date || "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(transactionDate)) return;
        if (getTransactionCategoryType(transaction) !== normalizedType) return;

        const category = String(transaction.category || "").trim() || "Uncategorized";
        names.add(category);
    });

    return Array.from(names).sort((a, b) => a.localeCompare(b));
}

function getCategoryTypeSeriesByCategory({ categoryType, positiveCashflow, from, to, granularity }) {
    const baselineDate = from ? getPreviousISODate(from) : "";
    const baselinePeriod = getBaselinePeriodKey({ from, baselineDate, granularity });
    const rangePeriods = getDashboardPeriodRange({ from, to, granularity });
    const periods = baselineDate && baselinePeriod ? [baselinePeriod, ...rangePeriods] : [...rangePeriods];
    const categoryNames = getCategoryTypeCategoryNames(categoryType);
    const seriesByCategory = {};

    categoryNames.forEach((categoryName) => {
        const byPeriod = {};

        periods.forEach((period) => {
            const pointDate = period === baselinePeriod
                ? baselineDate
                : granularity === "day"
                    ? period
                    : minISODate(getMonthEndDate(period), to);

            byPeriod[period] = getCategoryTypeBalanceAtDate({
                categoryType,
                positiveCashflow,
                date: pointDate,
                categoryName
            });
        });

        seriesByCategory[categoryName] = byPeriod;
    });

    const endingBalance = categoryNames.reduce((sum, categoryName) => {
        const byPeriod = seriesByCategory[categoryName] || {};
        const latestPeriod = rangePeriods[rangePeriods.length - 1];
        return sum + (latestPeriod ? byPeriod[latestPeriod] || 0 : 0);
    }, 0);

    const startingBalance = categoryNames.reduce((sum, categoryName) => {
        const byPeriod = seriesByCategory[categoryName] || {};
        return sum + (baselineDate ? byPeriod[baselinePeriod] || 0 : 0);
    }, 0);

    return {
        periods,
        categoryNames,
        seriesByCategory,
        endingBalance,
        rangeChange: endingBalance - startingBalance
    };
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
    const { from, to } = getDashboardDateRange();
    const granularity = getDashboardRangeGranularity(from, to);
    const {
        periods,
        categoryNames,
        seriesByCategory,
        endingBalance,
        rangeChange
    } = getCategoryTypeSeriesByCategory({
        categoryType: "receivable",
        positiveCashflow: "out",
        from,
        to,
        granularity
    });
    const combinedTotalElement = getElement("loan-kaution-balance-total");
    const dashboardCurrency = getDashboardCurrency();

    combinedTotalElement.textContent = formatMoney(endingBalance, dashboardCurrency);
    combinedTotalElement.classList.toggle("amount-negative", endingBalance < 0);
    combinedTotalElement.classList.toggle("amount-positive", endingBalance >= 0);

    const chartElementId = "loan-kaution-balance-chart";
    const chartHost = getElement(chartElementId);

    if (dashboardMiniLineCharts[chartElementId]) {
        dashboardMiniLineCharts[chartElementId].destroy();
        dashboardMiniLineCharts[chartElementId] = null;
    }

    if (!periods.length || !categoryNames.length) {
        chartHost.innerHTML = '<p class="empty-copy">No receivable activity in this range.</p>';
        return { total: endingBalance, endingBalance, rangeChange };
    }

    chartHost.innerHTML = `<canvas id="${chartElementId}-canvas"></canvas>`;
    const canvas = getElement(`${chartElementId}-canvas`);
    const textColor = getThemeColor("--color-text-muted", "#64748b");
    const axisColor = getThemeColor("--color-border", "#cbd5e1");
    const gridColor = getThemeColor("--color-border-light", "#e2e8f0");
    const palette = [
        "#16a34a",
        "#1d4ed8",
        "#0f766e",
        "#ca8a04",
        "#9333ea",
        "#dc2626",
        "#0891b2",
        "#b45309",
        "#4f46e5",
        "#047857"
    ];

    const datasets = categoryNames.map((categoryName, index) => {
        const color = palette[index % palette.length];
        const byPeriod = seriesByCategory[categoryName] || {};
        const values = periods.map((period) => (byPeriod[period] == null ? null : byPeriod[period]));
        const lastValue = [...values].reverse().find((value) => value != null) || 0;

        return {
            label: `${categoryName}: ${formatMoney(lastValue, dashboardCurrency)}`,
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

    dashboardMiniLineCharts[chartElementId] = new Chart(canvas, {
        plugins: [verticalHoverLinePlugin],
        type: "line",
        data: {
            labels: periods.map((period) => formatDashboardPeriodLabel(period, granularity)),
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
                        maxTicksLimit: granularity === "day" ? 10 : 6
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

    return { total: endingBalance, endingBalance, rangeChange };
}

function renderPayablesBalanceChart() {
    const { from, to } = getDashboardDateRange();
    const granularity = getDashboardRangeGranularity(from, to);
    const baselineDate = from ? getPreviousISODate(from) : "";
    const baselinePeriod = granularity === "day" ? baselineDate : shiftMonth(from.slice(0, 7), -1);
    const rangePeriods = getDashboardPeriodRange({ from, to, granularity });
    const periods = baselineDate ? [baselinePeriod, ...rangePeriods] : [...rangePeriods];

    const points = periods.map((period) => {
        const pointDate = period === baselinePeriod
            ? baselineDate
            : granularity === "day"
                ? period
                : minISODate(getMonthEndDate(period), to);

        return {
            month: period,
            amount: getCategoryTypeBalanceAtDate({
                categoryType: "payable",
                positiveCashflow: "in",
                date: pointDate
            })
        };
    });

    const endingBalance = rangePeriods.length ? points[points.length - 1].amount : 0;
    const startingBalance = baselineDate && points.length ? points[0].amount : 0;
    const rangeChange = endingBalance - startingBalance;
    const totalElement = getElement("payables-balance-total");
    const dashboardCurrency = getDashboardCurrency();

    totalElement.textContent = formatMoney(endingBalance, dashboardCurrency);
    totalElement.classList.toggle("amount-negative", endingBalance >= 0);
    totalElement.classList.toggle("amount-positive", endingBalance < 0);

    const months = points.map((point) => point.month);
    const chartElementId = "payables-balance-chart";
    const chartHost = getElement(chartElementId);

    if (dashboardMiniLineCharts[chartElementId]) {
        dashboardMiniLineCharts[chartElementId].destroy();
        dashboardMiniLineCharts[chartElementId] = null;
    }

    if (!months.length) {
        chartHost.innerHTML = '<p class="empty-copy">No payable activity in this range.</p>';
        return { total: endingBalance, endingBalance, rangeChange };
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
            labels: months.map((month) => formatDashboardPeriodLabel(month, granularity)),
            datasets: [
                {
                    label: `Payables: ${formatMoney(endingBalance, dashboardCurrency)}`,
                    data: points.map((point) => point.amount),
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
                        maxTicksLimit: granularity === "day" ? 10 : 6
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

    return { total: endingBalance, endingBalance, rangeChange };
}

function getSourceAccountsSeriesData({ mode = "absolute" } = {}) {
    const from = getElement("dashboard-from").value;
    const to = getElement("dashboard-to").value;
    const granularity = getDashboardRangeGranularity(from, to);

    if (!from || !to) {
        return {
            accountNames: getDashboardAccountNames(),
            seriesByAccount: {},
            months: [],
            granularity
        };
    }

    const months = getDashboardPeriodRange({ from, to, granularity });

    const seriesByAccount = {};

    const accountNames = getDashboardAccountNames();

    accountNames.forEach((accountName) => {
        const points = getAccountMonthlyRangePoints({ accountName, from, to, granularity, mode });

        const byMonth = {};
        points.forEach((point) => {
            byMonth[point.month] = point.amount;
        });

        seriesByAccount[accountName] = byMonth;
    });

    return {
        accountNames,
        seriesByAccount,
        months,
        granularity
    };
}

function getAccountBalanceAtDate({ accountName, date }) {
    if (!accountName || !date) {
        return 0;
    }

    const account = (window.state.accounts || []).find((entry) => entry.name === accountName);
    if (!account) {
        return 0;
    }

    const openingBalance = Number(account.openingBalance) || 0;
    const currency = account.currency || getDashboardCurrency();

    const balance = (window.state.transactions || [])
        .filter((transaction) => {
            const transactionDate = String(transaction.date || "");
            if (!/^\d{4}-\d{2}-\d{2}$/.test(transactionDate)) return false;
            if (transactionDate > date) return false;
            return transaction.account === accountName || transaction.destinationAccount === accountName;
        })
        .reduce((sum, transaction) => sum + getTransactionImpact(transaction, accountName), openingBalance);

    return convertAmountToDashboardCurrency(balance, currency);
}

function getAccountMonthlyRangePoints({ accountName, from, to, granularity, mode = "absolute" }) {
    const rangeGranularity = granularity || getDashboardRangeGranularity(from, to);

    if (!from || !to) {
        return [];
    }

    const baseline = mode === "delta"
        ? getAccountBalanceAtDate({ accountName, date: getPreviousISODate(from) })
        : 0;

    return getDashboardPeriodRange({ from, to, granularity: rangeGranularity }).map((month) => {
        const dateForPoint = rangeGranularity === "day"
            ? month
            : minISODate(getMonthEndDate(month), to);
        return {
            month,
            amount: getAccountBalanceAtDate({ accountName, date: dateForPoint }) - baseline
        };
    });
}

function getLiquidAssetsPoints({ granularity, mode = "absolute" } = {}) {
    const { from, to } = getDashboardDateRange();
    const effectiveGranularity = granularity || getDashboardRangeGranularity(from, to);
    const { accountNames, seriesByAccount, months } = getSourceAccountsSeriesData({ mode });

    const periodKeys = months.length
        ? months
        : getDashboardPeriodRange({ from, to, granularity: effectiveGranularity });

    return periodKeys.map((month) => ({
        month,
        amount: accountNames.reduce((sum, accountName) => {
            const byMonth = seriesByAccount[accountName] || {};
            return sum + (byMonth[month] || 0);
        }, 0)
    }));
}

function renderSourceAccountsBalanceChart() {
    const { from, to } = getDashboardDateRange();
    const granularity = getDashboardRangeGranularity(from, to);
    const accountNames = getDashboardAccountNames();
    const chartElementId = "source-accounts-balance-chart";
    const chartHost = getElement(chartElementId);
    const totalElement = getElement("source-accounts-balance-total");
    const dashboardCurrency = getDashboardCurrency();

    if (!from || !to) {
        totalElement.textContent = formatMoney(0, dashboardCurrency);
        totalElement.classList.toggle("amount-negative", false);
        totalElement.classList.toggle("amount-positive", true);
        chartHost.innerHTML = '<p class="empty-copy">No account balance data found in this range.</p>';
        return { total: 0, endingBalance: 0, rangeChange: 0 };
    }

    const baselineDate = getPreviousISODate(from);
    const baselinePeriod = getBaselinePeriodKey({ from, baselineDate, granularity });
    const rangePeriods = getDashboardPeriodRange({ from, to, granularity });
    const periods = baselineDate && baselinePeriod ? [baselinePeriod, ...rangePeriods] : [...rangePeriods];

    const seriesByAccount = {};
    accountNames.forEach((accountName) => {
        const byPeriod = {};

        if (baselineDate) {
            byPeriod[baselinePeriod] = getAccountBalanceAtDate({ accountName, date: baselineDate });
        }

        rangePeriods.forEach((period) => {
            const pointDate = granularity === "day" ? period : minISODate(getMonthEndDate(period), to);
            byPeriod[period] = getAccountBalanceAtDate({ accountName, date: pointDate });
        });

        seriesByAccount[accountName] = byPeriod;
    });

    if (dashboardMiniLineCharts[chartElementId]) {
        dashboardMiniLineCharts[chartElementId].destroy();
        dashboardMiniLineCharts[chartElementId] = null;
    }

    if (!periods.length) {
        totalElement.textContent = formatMoney(0, dashboardCurrency);
        totalElement.classList.toggle("amount-negative", false);
        totalElement.classList.toggle("amount-positive", true);
        chartHost.innerHTML = '<p class="empty-copy">No account balance data found in this range.</p>';
        return { total: 0, endingBalance: 0, rangeChange: 0 };
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
        const values = periods.map((month) => (byMonth[month] == null ? null : byMonth[month]));
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

    const endingBalance = accountNames.reduce((sum, accountName) => {
        const byMonth = seriesByAccount[accountName] || {};
        const latestMonth = rangePeriods[rangePeriods.length - 1];
        const latestValue = byMonth[latestMonth] || 0;
        return sum + latestValue;
    }, 0);

    const startingBalance = accountNames.reduce((sum, accountName) => {
        const byMonth = seriesByAccount[accountName] || {};
        const startValue = baselineDate ? byMonth[baselinePeriod] || 0 : 0;
        return sum + startValue;
    }, 0);
    const rangeChange = endingBalance - startingBalance;

    totalElement.textContent = formatMoney(endingBalance, dashboardCurrency);
    totalElement.classList.toggle("amount-negative", endingBalance < 0);
    totalElement.classList.toggle("amount-positive", endingBalance >= 0);

    chartHost.innerHTML = `<canvas id="${chartElementId}-canvas"></canvas>`;
    const canvas = getElement(`${chartElementId}-canvas`);

    dashboardMiniLineCharts[chartElementId] = new Chart(canvas, {
        plugins: [verticalHoverLinePlugin],
        type: "line",
        data: {
            labels: periods.map((month) => formatDashboardPeriodLabel(month, granularity)),
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
                        maxTicksLimit: granularity === "day" ? 10 : 6
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

    return { total: endingBalance, endingBalance, rangeChange };
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
        liquidAssetsResult.endingBalance +
        receivablesResult.endingBalance -
        payablesResult.endingBalance;

    const netWorthQuickOverviewTotal =
        liquidAssetsResult.total +
        receivablesResult.total -
        payablesResult.total;

    const balanceNetWorth = trendTotals.netWorthAbsoluteTotal;

    renderOverviewCard({
        incomeTotal: trendTotals.incomeTotal,
        netExpenseTotal: trendTotals.netExpenseTotal,
        netWorthTotal,
        reconciliationGap: netWorthTotal - balanceNetWorth
    });

    renderQuickOverviewCard({
        netWorthTotal: netWorthQuickOverviewTotal,
        liquidAssetsTotal: liquidAssetsResult.total,
        receivablesTotal: receivablesResult.total,
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

function getDashboardDateRange() {
    return {
        from: getElement("dashboard-from").value,
        to: getElement("dashboard-to").value
    };
}

function getTransactionsInDashboardRange() {
    const { from, to } = getDashboardDateRange();

    return (window.state.transactions || []).filter((transaction) => {
        const date = String(transaction.date || "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
        if (from && date < from) return false;
        if (to && date > to) return false;
        return true;
    });
}

function getLiquidAssetsBreakdownItems() {
    const { to } = getDashboardDateRange();
    const effectiveTo = to || toISODate(new Date());

    const items = getDashboardAccountNames().map((accountName) => {
        const account = (window.state.accounts || []).find((entry) => entry.name === accountName);
        const converted = getAccountBalanceAtDate({ accountName, date: effectiveTo });

        return {
            label: accountName,
            amount: converted,
            meta: `As of ${effectiveTo}`,
            drilldown: {
                mode: "account",
                account: accountName
            }
        };
    });

    return items
        .filter((item) => Math.abs(item.amount) > 0)
        .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

function getCategoryBreakdownItems({ categoryType, cashflow }) {
    const normalizedType = String(categoryType || "").trim().toLowerCase();

    const groups = {};
    getTransactionsInDashboardRange()
        .filter((transaction) => getTransactionCategoryType(transaction) === normalizedType)
        .filter((transaction) => !cashflow || transaction.cashflow === cashflow)
        .forEach((transaction) => {
            const key = String(transaction.category || "Uncategorized").trim() || "Uncategorized";
            if (!groups[key]) {
                groups[key] = { label: key, amount: 0, count: 0 };
            }

            groups[key].amount += convertAmountToDashboardCurrency(transaction.amount, transaction.currency);
            groups[key].count += 1;
        });

    return Object.values(groups)
        .map((group) => ({
            label: group.label,
            amount: group.amount,
            meta: `${group.count} tx`,
            drilldown: {
                mode: "category",
                category: group.label,
                cashflow: cashflow || ""
            }
        }))
        .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

function getBreakdownItemsByType(type) {
    const config = DASHBOARD_BREAKDOWN_CONFIG[type];
    if (!config) {
        return { title: "Breakdown", items: [] };
    }

    if (config.source === "accounts") {
        return { title: config.title, items: getLiquidAssetsBreakdownItems() };
    }

    return {
        title: config.title,
        items: getCategoryBreakdownItems({ categoryType: config.categoryType, cashflow: config.cashflow })
    };
}

function renderDashboardBreakdownList(items) {
    const dashboardCurrency = getDashboardCurrency();
    const list = getElement("dashboard-breakdown-list");

    if (!items.length) {
        list.innerHTML = '<p class="empty-copy">No entries for this date range.</p>';
        return 0;
    }

    list.innerHTML = items
        .map((item) => {
            const amountClass = item.amount < 0 ? "amount-negative" : "amount-positive";
            const encodedDrilldown = encodeURIComponent(JSON.stringify(item.drilldown || {}));
            return `
                <button class="list-row dashboard-breakdown-row" type="button" onclick="openDashboardBreakdownTransactions('${encodedDrilldown}')">
                    <div>
                        <strong>${escapeHtml(item.label)}</strong>
                        <div class="dashboard-breakdown-meta">${escapeHtml(item.meta || "")}</div>
                    </div>
                    <strong class="${amountClass}">${escapeHtml(formatMoney(item.amount, dashboardCurrency))}</strong>
                </button>
            `;
        })
        .join("");

    return items.reduce((sum, item) => sum + item.amount, 0);
}

function openDashboardBreakdownModal(type) {
    const modal = getElement("dashboard-breakdown-modal");
    const titleElement = getElement("dashboard-breakdown-title");
    const subtitleElement = getElement("dashboard-breakdown-subtitle");
    const totalElement = getElement("dashboard-breakdown-total");

    const { title, items } = getBreakdownItemsByType(type);
    const total = renderDashboardBreakdownList(items);
    const dashboardCurrency = getDashboardCurrency();
    const { from, to } = getDashboardDateRange();

    titleElement.textContent = title;
    subtitleElement.textContent = from && to ? `${formatDate(from)} → ${formatDate(to)}` : "All dates";
    totalElement.textContent = formatMoney(total, dashboardCurrency);
    totalElement.classList.toggle("amount-negative", total < 0);
    totalElement.classList.toggle("amount-positive", total >= 0);

    modal.hidden = false;
    document.body.style.overflow = "hidden";
}

function openDashboardBreakdownTransactions(encodedDrilldown) {
    let drilldown = {};
    try {
        drilldown = JSON.parse(decodeURIComponent(String(encodedDrilldown || "")));
    } catch {
        return;
    }

    const searchInput = getElement("search-filter");
    const typeFilter = getElement("type-filter");
    const accountFilter = getElement("account-filter");
    const fromFilter = getElement("tx-from");
    const toFilter = getElement("tx-to");
    const { from, to } = getDashboardDateRange();

    if (searchInput) searchInput.value = "";
    if (typeFilter) typeFilter.value = "";
    if (accountFilter) accountFilter.value = "";

    if (drilldown.mode === "account") {
        if (accountFilter) accountFilter.value = drilldown.account || "";
    } else if (drilldown.mode === "category") {
        if (searchInput) searchInput.value = drilldown.category || "";
        if (typeFilter && drilldown.cashflow) typeFilter.value = drilldown.cashflow;
    }

    if (fromFilter) fromFilter.value = from || "";
    if (toFilter) toFilter.value = to || "";

    closeDashboardBreakdownModal();
    page("transactions");

    const filtersPanel = getElement("filters-panel");
    if (filtersPanel && filtersPanel.hidden) {
        filtersPanel.hidden = false;
    }

    renderTransactions();
}

function closeDashboardBreakdownModal() {
    const modal = getElement("dashboard-breakdown-modal");
    modal.hidden = true;
    document.body.style.overflow = "";
}

function handleDashboardBreakdownBackdropClick(event) {
    if (event.target && event.target.id === "dashboard-breakdown-modal") {
        closeDashboardBreakdownModal();
    }
}

function handleDashboardDrilldownCardKey(event, type) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openDashboardBreakdownModal(type);
}

document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const modal = getElement("dashboard-breakdown-modal");
    if (modal && !modal.hidden) {
        closeDashboardBreakdownModal();
    }
});

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
    const from = getElement("dashboard-from").value;
    const to = getElement("dashboard-to").value;
    const granularity = getDashboardRangeGranularity(from, to);
    const points = getMonthlyPointsByCategoryType({ categoryTypes, cashflow, granularity });
    const rangePeriods = getDashboardPeriodRange({ from, to, granularity });
    const byPeriod = {};
    points.forEach((point) => {
        byPeriod[point.month] = point.amount;
    });
    const chartPeriods = rangePeriods.length ? rangePeriods : points.map((point) => point.month);
    const chartPoints = chartPeriods.map((period) => ({
        month: period,
        amount: byPeriod[period] || 0
    }));

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

    if (!chartPoints.length || !points.length) {
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
            labels: chartPoints.map((point) => formatDashboardPeriodLabel(point.month, granularity)),
            datasets: [
                {
                    data: chartPoints.map((point) => point.amount),
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
                        maxTicksLimit: granularity === "day" ? 10 : 6
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
    const { from, to } = getDashboardDateRange();
    const granularity = getDashboardRangeGranularity(from, to);
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
            labels: points.map((point) => formatDashboardPeriodLabel(point.month, granularity)),
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
                        maxTicksLimit: granularity === "day" ? 10 : 6
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
    const points = getAccountMonthlyRangePoints({ accountName, from, to });

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
window.onDashboardRangePresetChange = onDashboardRangePresetChange;
window.renderDashboard = renderDashboard;
window.toggleDashboardFilters = toggleDashboardFilters;
window.openDashboardBreakdownModal = openDashboardBreakdownModal;
window.openDashboardBreakdownTransactions = openDashboardBreakdownTransactions;
window.closeDashboardBreakdownModal = closeDashboardBreakdownModal;
window.handleDashboardBreakdownBackdropClick = handleDashboardBreakdownBackdropClick;
window.handleDashboardDrilldownCardKey = handleDashboardDrilldownCardKey;
