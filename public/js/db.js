// In-browser data layer — replaces server.js. All data lives in localStorage.

const DB_KEYS = {
    transactions: "trackz_transactions",
    accounts: "trackz_accounts",
    categories: "trackz_categories",
    currencies: "trackz_currencies",
    currencyRates: "trackz_currency_rates",
    debts: "trackz_debts"
};

const DEFAULT_CURRENCIES = ["EUR", "USD", "BDT", "JPY"];

const DEFAULT_CURRENCY_RATES = { EUR: 1, BDT: 0.0071, JPY: 0.0054 };

const DEFAULT_CATEGORIES = [
    { name: "Charges", subcategories: ["Bank Fee", "University Fee", "Credit Card Interest"] },
    { name: "Debt Collection", subcategories: ["Loan", "Credit Card Bill", "Friends", "Family"] },
    { name: "Debt Payment", subcategories: ["Loan", "Credit Card Bill", "Friends", "Family"] },
    { name: "Entertainment", subcategories: ["Movies", "Transport"] },
    { name: "Family and Friends", subcategories: [] },
    { name: "Groceries", subcategories: ["Supermarket"] },
    { name: "Housing", subcategories: ["Rent", "Electricity", "Water", "Furniture"] },
    { name: "Income", subcategories: ["Salary", "Bonus"] },
    { name: "Internet", subcategories: ["Wi-Fi", "Mobile"] },
    { name: "Other", subcategories: ["Miscellaneous"] },
    { name: "Shopping", subcategories: ["Amazon", "Clothing", "Electronics"] },
    { name: "Subscriptions", subcategories: ["YouTube", "Netflix", "Spotify"] },
    { name: "Transfer", subcategories: [] }
];

const TRANSACTION_TYPES = new Set(["Income", "Expense", "Transfer"]);

// ── Storage helpers ───────────────────────────────────────────────────────────

function readStore(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch {
        return fallback;
    }
}

function writeStore(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
    if (window.driveSync) {
        window.driveSync.markDirty();
    }
}

// Export all data as a single object for Drive sync
function exportAll() {
    return {
        transactions: readStore(DB_KEYS.transactions, []),
        accounts: readStore(DB_KEYS.accounts, []),
        categories: readStore(DB_KEYS.categories, DEFAULT_CATEGORIES),
        currencies: readStore(DB_KEYS.currencies, DEFAULT_CURRENCIES),
        currencyRates: readStore(DB_KEYS.currencyRates, DEFAULT_CURRENCY_RATES),
        debts: readStore(DB_KEYS.debts, [])
    };
}

// Import all data from Drive (overwrites localStorage)
function importAll(data) {
    if (data.transactions) localStorage.setItem(DB_KEYS.transactions, JSON.stringify(data.transactions));
    if (data.accounts) localStorage.setItem(DB_KEYS.accounts, JSON.stringify(data.accounts));
    if (data.categories) localStorage.setItem(DB_KEYS.categories, JSON.stringify(data.categories));
    if (data.currencies) localStorage.setItem(DB_KEYS.currencies, JSON.stringify(data.currencies));
    if (data.currencyRates) localStorage.setItem(DB_KEYS.currencyRates, JSON.stringify(data.currencyRates));
    if (data.debts) localStorage.setItem(DB_KEYS.debts, JSON.stringify(data.debts));
}

// ── Initialisation ────────────────────────────────────────────────────────────

function initDefaults() {
    if (!localStorage.getItem(DB_KEYS.currencies)) {
        localStorage.setItem(DB_KEYS.currencies, JSON.stringify(DEFAULT_CURRENCIES));
    }
    if (!localStorage.getItem(DB_KEYS.currencyRates)) {
        localStorage.setItem(DB_KEYS.currencyRates, JSON.stringify(DEFAULT_CURRENCY_RATES));
    }
    if (!localStorage.getItem(DB_KEYS.categories)) {
        localStorage.setItem(DB_KEYS.categories, JSON.stringify(DEFAULT_CATEGORIES));
    }
    if (!localStorage.getItem(DB_KEYS.transactions)) {
        localStorage.setItem(DB_KEYS.transactions, JSON.stringify([]));
    }
    if (!localStorage.getItem(DB_KEYS.accounts)) {
        localStorage.setItem(DB_KEYS.accounts, JSON.stringify([]));
    }
    if (!localStorage.getItem(DB_KEYS.debts)) {
        localStorage.setItem(DB_KEYS.debts, JSON.stringify([]));
    }
}

// ── Utility ───────────────────────────────────────────────────────────────────

function createId(prefix) {
    return `${prefix}_${crypto.randomUUID()}`;
}

function isValidDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function toPositiveNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

// ── Currency ──────────────────────────────────────────────────────────────────

function getRates() {
    return readStore(DB_KEYS.currencyRates, DEFAULT_CURRENCY_RATES);
}

function getRate(currency, rates) {
    if (currency === "EUR") return 1;
    const rate = rates[currency];
    return typeof rate === "number" ? rate : null;
}

function convertAmountBetweenCurrencies(amount, fromCurrency, toCurrency, rates) {
    if (fromCurrency === toCurrency) return amount;
    const fromRate = getRate(fromCurrency, rates);
    const toRate = getRate(toCurrency, rates);
    if (fromRate === null || toRate === null || toRate === 0) return amount;
    return (amount * fromRate) / toRate;
}

function dbGetCurrencies() {
    return readStore(DB_KEYS.currencies, DEFAULT_CURRENCIES);
}

// ── Accounts ──────────────────────────────────────────────────────────────────

function dbGetRawAccounts() {
    return readStore(DB_KEYS.accounts, []).map((a) => ({
        ...a,
        openingBalance: toNumber(a.openingBalance)
    }));
}

function getTransactionImpact(transaction, accountName, context = {}) {
    const { accountCurrencyByName = new Map(), rates = {} } = context;

    if (transaction.type === "Income" && transaction.account === accountName) {
        return transaction.amount;
    }
    if (transaction.type === "Expense" && transaction.account === accountName) {
        return -transaction.amount;
    }
    if (transaction.type === "Transfer") {
        if (transaction.account === accountName) return -transaction.amount;
        if (transaction.destinationAccount === accountName) {
            const destCurrency = accountCurrencyByName.get(accountName);
            return convertAmountBetweenCurrencies(
                transaction.amount,
                transaction.currency,
                destCurrency,
                rates
            );
        }
    }
    return 0;
}

function dbComputeAccountSummaries() {
    const accounts = dbGetRawAccounts();
    const transactions = dbGetTransactions();
    const rates = getRates();
    const accountCurrencyByName = new Map(accounts.map((a) => [a.name, a.currency]));

    return accounts.map((account) => {
        const matching = transactions.filter(
            (t) => t.account === account.name || t.destinationAccount === account.name
        );
        const currentBalance = matching.reduce(
            (sum, t) => sum + getTransactionImpact(t, account.name, { accountCurrencyByName, rates }),
            account.openingBalance
        );
        const rate = getRate(account.currency, rates);
        return {
            ...account,
            transactionCount: matching.length,
            currentBalance,
            eurEquivalent: rate === null ? null : currentBalance * rate
        };
    });
}

function dbValidateAccountPayload(body) {
    const accounts = dbGetRawAccounts();
    const currencies = dbGetCurrencies();
    const name = String(body.name || "").trim();

    if (!name) throw new Error("Account name is required.");
    if (accounts.some((a) => a.name.toLowerCase() === name.toLowerCase())) {
        throw new Error("Account name must be unique.");
    }
    if (!currencies.includes(body.currency)) throw new Error("Select a valid currency.");

    const openingBalance = Number(body.openingBalance);
    if (!Number.isFinite(openingBalance)) throw new Error("Opening balance must be a valid number.");

    return { name, currency: body.currency, openingBalance };
}

function dbSaveAccount(body) {
    const account = dbValidateAccountPayload(body);
    const accounts = dbGetRawAccounts();
    accounts.push(account);
    writeStore(DB_KEYS.accounts, accounts);
    return account;
}

function dbDeleteAccount(name) {
    const accounts = dbGetRawAccounts();
    if (!accounts.some((a) => a.name === name)) throw new Error("Account not found.");
    const hasLinked = dbGetTransactions().some(
        (t) => t.account === name || t.destinationAccount === name
    );
    if (hasLinked) throw new Error("Cannot delete account with linked transactions.");
    writeStore(
        DB_KEYS.accounts,
        accounts.filter((a) => a.name !== name)
    );
}

// ── Transactions ──────────────────────────────────────────────────────────────

function dbGetTransactions() {
    return readStore(DB_KEYS.transactions, [])
        .map((t) => ({
            ...t,
            amount: toNumber(t.amount),
            destinationAccount: t.destinationAccount || "",
            notes: t.notes || ""
        }))
        .sort((a, b) => {
            const ak = `${a.date || ""}T${a.createdAt || ""}`;
            const bk = `${b.date || ""}T${b.createdAt || ""}`;
            return bk.localeCompare(ak);
        });
}

function dbValidateTransactionPayload(body) {
    const accounts = dbGetRawAccounts();
    const accountNames = new Set(accounts.map((a) => a.name));
    const sourceAccount = accounts.find((a) => a.name === body.account);

    if (!isValidDate(body.date)) throw new Error("Choose a valid date.");
    if (!accountNames.has(body.account)) throw new Error("Select a valid account.");
    if (!TRANSACTION_TYPES.has(body.type)) throw new Error("Select a valid transaction type.");

    const amount = toPositiveNumber(body.amount);
    if (amount === null) throw new Error("Amount must be greater than zero.");

    const currency = sourceAccount?.currency;
    if (!currency) throw new Error("The selected account must have a valid currency.");

    const debtId = String(body.debtId || "").trim();
    let category = String(body.category || "").trim();
    let subcategory = String(body.subcategory || "").trim();
    let destinationAccount = "";

    if (debtId && !["Expense", "Income"].includes(body.type)) {
        throw new Error("Debt-linked transactions must be Income or Expense.");
    }
    if (debtId) {
        const debts = dbGetRawDebts();
        if (!debts.some((d) => d.id === debtId)) throw new Error("Select a valid debt.");
    }

    if (body.type === "Transfer") {
        destinationAccount = String(body.destinationAccount || "").trim();
        if (!destinationAccount || !accountNames.has(destinationAccount)) {
            throw new Error("Select a destination account for transfers.");
        }
        if (destinationAccount === body.account) {
            throw new Error("Transfer destination must be different from the source account.");
        }
        category = "Transfer";
        subcategory = "";
    } else {
        const selectedCategory = dbGetCategoryByName(category);
        if (!selectedCategory) throw new Error("Select a valid category.");
        if (
            subcategory &&
            !selectedCategory.subcategories.some((s) => s.toLowerCase() === subcategory.toLowerCase())
        ) {
            throw new Error("Select a valid subcategory.");
        }
    }

    return {
        id: createId("txn"),
        date: body.date,
        account: body.account,
        destinationAccount,
        type: body.type,
        category,
        subcategory,
        amount,
        currency,
        notes: String(body.notes || "").trim(),
        createdAt: new Date().toISOString(),
        ...(debtId && { debtId })
    };
}

function dbSaveTransaction(body) {
    const transaction = dbValidateTransactionPayload(body);
    const transactions = dbGetTransactions();
    transactions.push(transaction);
    writeStore(DB_KEYS.transactions, transactions);
    return transaction;
}

function dbDeleteTransaction(id) {
    const transactions = dbGetTransactions();
    const next = transactions.filter((t) => t.id !== id);
    if (next.length === transactions.length) throw new Error("Transaction not found.");
    writeStore(DB_KEYS.transactions, next);
}

// ── Categories ────────────────────────────────────────────────────────────────

function normalizeCategoryTree(raw) {
    if (!Array.isArray(raw)) return [];
    const byName = new Map();

    raw.forEach((item) => {
        if (typeof item === "string") {
            const name = item.trim();
            if (!name) return;
            if (!byName.has(name.toLowerCase())) byName.set(name.toLowerCase(), { name, subcategories: [] });
            return;
        }
        const name = String(item?.name || "").trim();
        if (!name) return;
        if (!byName.has(name.toLowerCase())) byName.set(name.toLowerCase(), { name, subcategories: [] });

        const cat = byName.get(name.toLowerCase());
        (Array.isArray(item?.subcategories) ? item.subcategories : []).forEach((sub) => {
            const s = String(sub || "").trim();
            if (s && !cat.subcategories.some((e) => e.toLowerCase() === s.toLowerCase())) {
                cat.subcategories.push(s);
            }
        });
    });

    return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function dbGetCategoryTree() {
    return normalizeCategoryTree(readStore(DB_KEYS.categories, DEFAULT_CATEGORIES));
}

function dbGetCategories() {
    const tree = dbGetCategoryTree();
    const names = new Map();
    tree.forEach((cat) => {
        names.set(cat.name.toLowerCase(), cat.name);
        cat.subcategories.forEach((sub) => names.set(sub.toLowerCase(), sub));
    });
    return Array.from(names.values())
        .sort((a, b) => a.localeCompare(b))
        .map((name) => ({ name }));
}

function dbGetCategoryByName(name) {
    const lower = String(name || "").trim().toLowerCase();
    return dbGetCategoryTree().find((c) => c.name.toLowerCase() === lower) || null;
}

function dbSaveCategory(name) {
    const categoryName = String(name || "").trim();
    if (!categoryName) throw new Error("Category name is required.");
    const categories = dbGetCategoryTree();
    if (categories.some((c) => c.name.toLowerCase() === categoryName.toLowerCase())) {
        throw new Error("Category already exists.");
    }
    categories.push({ name: categoryName, subcategories: [] });
    categories.sort((a, b) => a.name.localeCompare(b.name));
    writeStore(DB_KEYS.categories, categories);
    return { name: categoryName, subcategories: [] };
}

function dbSaveSubcategory(categoryName, subcategoryName) {
    if (!categoryName) throw new Error("Category is required.");
    if (!subcategoryName) throw new Error("Subcategory name is required.");

    const categories = dbGetCategoryTree();
    const idx = categories.findIndex((c) => c.name.toLowerCase() === categoryName.toLowerCase());
    if (idx === -1) throw new Error("Category not found.");

    if (categories[idx].subcategories.some((s) => s.toLowerCase() === subcategoryName.toLowerCase())) {
        throw new Error("Subcategory already exists in this category.");
    }

    categories[idx].subcategories.push(subcategoryName);
    categories[idx].subcategories.sort((a, b) => a.localeCompare(b));
    writeStore(DB_KEYS.categories, categories);
    return { categoryName: categories[idx].name, subcategoryName };
}

// ── Debts ─────────────────────────────────────────────────────────────────────

function dbGetRawDebts() {
    return readStore(DB_KEYS.debts, []);
}

function dbGetDebtPaymentsFromTransactions(debtId) {
    return dbGetTransactions()
        .filter((t) => t.debtId === debtId)
        .map((t) => ({
            id: t.paymentId || t.id,
            date: t.date,
            amount: t.amount,
            account: t.account,
            currency: t.currency,
            notes: t.notes || "",
            createdAt: t.createdAt,
            transactionId: t.id
        }))
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function dbComputeDebtSummaries() {
    const rates = getRates();
    return dbGetRawDebts().map((debt) => {
        const payments = dbGetDebtPaymentsFromTransactions(debt.id);
        const toDebtCurrency = (p) => {
            if (p.currency === debt.currency) return p.amount;
            const fromRate = getRate(p.currency, rates);
            const toRate = getRate(debt.currency, rates);
            if (!fromRate || !toRate) return 0;
            return (p.amount * fromRate) / toRate;
        };
        const paidBack = payments.reduce((sum, p) => sum + toDebtCurrency(p), 0);
        const remaining = Math.max(0, debt.originalAmount - paidBack);
        const rate = getRate(debt.currency, rates);
        return {
            ...debt,
            payments,
            paidBack,
            remaining,
            eurEquivalent: rate === null ? null : remaining * rate
        };
    });
}

function dbValidateDebtPayload(body) {
    const currencies = dbGetCurrencies();
    const person = String(body.person || "").trim();
    if (!person) throw new Error("Person name is required.");
    if (!["owed_to_me", "i_owe"].includes(body.direction)) {
        throw new Error("Direction must be 'owed_to_me' or 'i_owe'.");
    }
    const originalAmount = Number(body.originalAmount);
    if (!Number.isFinite(originalAmount) || originalAmount <= 0) {
        throw new Error("Original amount must be greater than zero.");
    }
    if (!currencies.includes(body.currency)) throw new Error("Select a valid currency.");
    return {
        id: createId("debt"),
        person,
        direction: body.direction,
        originalAmount,
        currency: body.currency,
        notes: String(body.notes || "").trim(),
        createdAt: new Date().toISOString()
    };
}

function dbSaveDebt(body) {
    const debt = dbValidateDebtPayload(body);
    const debts = dbGetRawDebts();
    debts.push(debt);
    writeStore(DB_KEYS.debts, debts);
    return debt;
}

function dbDeleteDebt(id) {
    const debts = dbGetRawDebts();
    const next = debts.filter((d) => d.id !== id);
    if (next.length === debts.length) throw new Error("Debt not found.");
    writeStore(DB_KEYS.debts, next);
    // Remove linked transactions
    const transactions = dbGetTransactions();
    writeStore(
        DB_KEYS.transactions,
        transactions.filter((t) => t.debtId !== id)
    );
}

function dbValidatePaymentPayload(body) {
    const accounts = dbGetRawAccounts();
    const accountNames = new Set(accounts.map((a) => a.name));
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Payment amount must be greater than zero.");
    if (!isValidDate(body.date)) throw new Error("Choose a valid date.");
    const account = String(body.account || "").trim();
    if (!account || !accountNames.has(account)) throw new Error("Select a valid account for this payment.");
    const currency = accounts.find((a) => a.name === account).currency;
    return {
        id: createId("pmt"),
        date: body.date,
        amount,
        account,
        currency,
        notes: String(body.notes || "").trim(),
        createdAt: new Date().toISOString()
    };
}

function dbAddPayment(debtId, body) {
    const debts = dbGetRawDebts();
    const debt = debts.find((d) => d.id === debtId);
    if (!debt) throw new Error("Debt not found.");

    const payment = dbValidatePaymentPayload(body);

    const txn = {
        id: createId("txn"),
        date: payment.date,
        account: payment.account,
        destinationAccount: "",
        type: debt.direction === "i_owe" ? "Expense" : "Income",
        category: debt.direction === "i_owe" ? "Debt Payment" : "Debt Collection",
        subcategory: "",
        amount: payment.amount,
        currency: payment.currency,
        notes: payment.notes || (debt.direction === "i_owe" ? `Payment to ${debt.person}` : `Payment from ${debt.person}`),
        debtId: debt.id,
        paymentId: payment.id,
        createdAt: payment.createdAt
    };

    const transactions = dbGetTransactions();
    transactions.push(txn);
    writeStore(DB_KEYS.transactions, transactions);

    payment.transactionId = txn.id;
    return payment;
}

function dbDeletePayment(debtId, paymentId) {
    const transactions = dbGetTransactions();
    const next = transactions.filter(
        (t) => !(t.debtId === debtId && t.paymentId === paymentId)
    );
    if (next.length === transactions.length) throw new Error("Payment not found.");
    writeStore(DB_KEYS.transactions, next);
}

// ── Summary ───────────────────────────────────────────────────────────────────

function dbComputeSummary(range = {}) {
    const transactions = dbGetTransactions();
    const accounts = dbComputeAccountSummaries();
    const rates = getRates();
    const today = new Date().toISOString().slice(0, 7);

    const toEUR = (amount, currency) => {
        const rate = getRate(currency, rates);
        return rate === null ? 0 : amount * rate;
    };

    const hasRange = Boolean(range.from || range.to);
    const from = String(range.from || "").trim();
    const to = String(range.to || "").trim();

    const scoped = hasRange
        ? transactions.filter((t) => {
              const d = String(t.date || "");
              if (!d) return false;
              if (from && d < from) return false;
              if (to && d > to) return false;
              return true;
          })
        : transactions;

    const income = scoped
        .filter((t) => t.type === "Income")
        .reduce((s, t) => s + toEUR(t.amount, t.currency), 0);
    const expense = scoped
        .filter((t) => t.type === "Expense")
        .reduce((s, t) => s + toEUR(t.amount, t.currency), 0);
    const transfer = scoped
        .filter((t) => t.type === "Transfer")
        .reduce((s, t) => s + toEUR(t.amount, t.currency), 0);

    const monthIncome = hasRange
        ? income
        : transactions
              .filter((t) => t.type === "Income" && String(t.date || "").startsWith(today))
              .reduce((s, t) => s + toEUR(t.amount, t.currency), 0);
    const monthExpense = hasRange
        ? expense
        : transactions
              .filter((t) => t.type === "Expense" && String(t.date || "").startsWith(today))
              .reduce((s, t) => s + toEUR(t.amount, t.currency), 0);

    const expenseByCategory = Object.entries(
        scoped
            .filter((t) => t.type === "Expense")
            .reduce((groups, t) => {
                const key = t.category || "Uncategorized";
                groups[key] = (groups[key] || 0) + toEUR(t.amount, t.currency);
                return groups;
            }, {})
    )
        .map(([name, amount]) => ({ name, amount }))
        .sort((a, b) => b.amount - a.amount);

    return {
        totals: {
            balance: accounts.reduce((s, a) => s + (typeof a.eurEquivalent === "number" ? a.eurEquivalent : 0), 0),
            netWorthEUR: accounts.reduce((s, a) => s + (typeof a.eurEquivalent === "number" ? a.eurEquivalent : 0), 0),
            income,
            expense,
            transfer,
            netCashFlow: income - expense,
            monthIncome,
            monthExpense
        },
        accounts,
        expenseByCategory,
        recentTransactions: scoped.slice(0, 5)
    };
}

// ── Exports ───────────────────────────────────────────────────────────────────

window.db = {
    init: initDefaults,
    exportAll,
    importAll,
    getTransactions: dbGetTransactions,
    saveTransaction: dbSaveTransaction,
    deleteTransaction: dbDeleteTransaction,
    getAccounts: dbComputeAccountSummaries,
    saveAccount: dbSaveAccount,
    deleteAccount: dbDeleteAccount,
    getCategoryTree: dbGetCategoryTree,
    getCategories: dbGetCategories,
    saveCategory: dbSaveCategory,
    saveSubcategory: dbSaveSubcategory,
    getCurrencies: dbGetCurrencies,
    getDebts: dbComputeDebtSummaries,
    saveDebt: dbSaveDebt,
    deleteDebt: dbDeleteDebt,
    addPayment: dbAddPayment,
    deletePayment: dbDeletePayment,
    getSummary: dbComputeSummary
};
