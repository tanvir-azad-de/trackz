// In-browser data layer — replaces server.js. All data lives in localStorage.

const DB_KEYS = {
    transactions: "trackz_transactions",
    accounts: "trackz_accounts",
    categories: "trackz_categories"
};

const DEFAULT_CATEGORIES = [
    { name: "Charges", subcategories: ["Bank Fee", "University Fee", "Credit Card Interest"] },
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

const TRANSACTION_CASHFLOWS = new Set(["in", "out", "none"]);

function normalizeTransactionRecord(transaction) {
    const source = transaction && typeof transaction === "object" ? transaction : {};
    const cashflow = String(source.cashflow || "").trim().toLowerCase();
    const { cashflow: rawCashflow, destinationAccount, notes, debtId, paymentId, ...rest } = source;

    return {
        ...rest,
        cashflow: TRANSACTION_CASHFLOWS.has(cashflow) ? cashflow : (String(destinationAccount || "").trim() ? "none" : "out"),
        destinationAccount: destinationAccount || "",
        notes: notes || ""
    };
}

function migrationCanRewriteTransactions(rawTransactions) {
    return Array.isArray(rawTransactions) && rawTransactions.some((transaction) => transaction && typeof transaction === "object" && "type" in transaction && !("cashflow" in transaction));
}

function migrateTransactionSchema(rawTransactions) {
    if (!Array.isArray(rawTransactions)) return [];

    return rawTransactions.map((transaction) => {
        const source = transaction && typeof transaction === "object" ? transaction : {};
        let cashflow = String(source.cashflow || "").trim().toLowerCase();

        if (!TRANSACTION_CASHFLOWS.has(cashflow)) {
            if (source.type === "Income") cashflow = "in";
            else if (source.type === "Expense") cashflow = "out";
            else if (source.type === "Transfer") cashflow = "none";
        }

        return normalizeTransactionRecord({ ...source, cashflow });
    });
}

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
        transactions: dbGetTransactions(),
        accounts: readStore(DB_KEYS.accounts, []),
        categories: readStore(DB_KEYS.categories, DEFAULT_CATEGORIES)
    };
}

// Import all data from Drive (overwrites localStorage)
function importAll(data) {
    if (Array.isArray(data.transactions)) {
        localStorage.setItem(
            DB_KEYS.transactions,
            JSON.stringify(migrateTransactionSchema(data.transactions))
        );
    }
    if (data.accounts) localStorage.setItem(DB_KEYS.accounts, JSON.stringify(data.accounts));
    if (data.categories) localStorage.setItem(DB_KEYS.categories, JSON.stringify(data.categories));

    if (window.driveSync) {
        window.driveSync.markDirty();
    }
}

// ── Initialisation ────────────────────────────────────────────────────────────

function initDefaults() {
    const storedTransactions = readStore(DB_KEYS.transactions, []);
    if (migrationCanRewriteTransactions(storedTransactions)) {
        writeStore(DB_KEYS.transactions, migrateTransactionSchema(storedTransactions));
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

    // Hard cleanup for removed features.
    localStorage.removeItem("trackz_currencies");
    localStorage.removeItem("trackz_currency_rates");
    localStorage.removeItem("trackz_debts");
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

// ── Accounts ──────────────────────────────────────────────────────────────────

function dbGetRawAccounts() {
    return readStore(DB_KEYS.accounts, []).map((a) => ({
        ...a,
        openingBalance: toNumber(a.openingBalance)
    }));
}

function getTransactionImpact(transaction, accountName, context = {}) {
    if (transaction.cashflow === "in" && transaction.account === accountName) {
        return transaction.amount;
    }
    if (transaction.cashflow === "out" && transaction.account === accountName) {
        return -transaction.amount;
    }
    if (transaction.cashflow === "none") {
        if (transaction.account === accountName) return -transaction.amount;
        if (transaction.destinationAccount === accountName) {
            return transaction.amount;
        }
    }
    return 0;
}

function dbComputeAccountSummaries() {
    const accounts = dbGetRawAccounts();
    const transactions = dbGetTransactions();

    return accounts.map((account) => {
        const matching = transactions.filter(
            (t) => t.account === account.name || t.destinationAccount === account.name
        );
        const currentBalance = matching.reduce(
            (sum, t) => sum + getTransactionImpact(t, account.name),
            account.openingBalance
        );
        return {
            ...account,
            transactionCount: matching.length,
            currentBalance
        };
    });
}

function dbComputeAccountMonthlyBalances(accountName) {
    const accounts = dbGetRawAccounts();
    const account = accounts.find((a) => a.name === accountName);
    if (!account) return [];

    const transactions = dbGetTransactions();

    const matching = transactions
        .filter((t) => t.account === accountName || t.destinationAccount === accountName)
        .filter((t) => isValidDate(t.date))
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    if (!matching.length) return [];

    const firstMonth = matching[0].date.slice(0, 7);
    const lastMonth = matching[matching.length - 1].date.slice(0, 7);

    const impactByMonth = {};
    matching.forEach((t) => {
        const month = t.date.slice(0, 7);
        impactByMonth[month] =
            (impactByMonth[month] || 0) + getTransactionImpact(t, accountName);
    });

    const months = [];
    let cursor = new Date(`${firstMonth}-01T00:00:00Z`);
    const end = new Date(`${lastMonth}-01T00:00:00Z`);
    while (cursor <= end) {
        months.push(cursor.toISOString().slice(0, 7));
        cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    }

    let runningBalance = account.openingBalance;
    return months.map((month) => {
        runningBalance += impactByMonth[month] || 0;
        return { month, balance: runningBalance, currency: account.currency };
    });
}

function dbValidateAccountPayload(body) {
    const accounts = dbGetRawAccounts();
    const name = String(body.name || "").trim();
    const currency = String(body.currency || "").trim().toUpperCase();

    if (!name) throw new Error("Account name is required.");
    if (accounts.some((a) => a.name.toLowerCase() === name.toLowerCase())) {
        throw new Error("Account name must be unique.");
    }
    if (!/^[A-Z]{2,5}$/.test(currency)) throw new Error("Account currency must be a valid code (e.g. BDT).");

    const openingBalance = Number(body.openingBalance);
    if (!Number.isFinite(openingBalance)) throw new Error("Opening balance must be a valid number.");

    return { name, currency, openingBalance };
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
    const rawTransactions = readStore(DB_KEYS.transactions, []);

    return Array.isArray(rawTransactions)
        ? rawTransactions
              .map((t) => ({
                  ...normalizeTransactionRecord(t),
                  amount: toNumber(t.amount)
              }))
              .sort((a, b) => {
                  const ak = `${a.date || ""}T${a.createdAt || ""}`;
                  const bk = `${b.date || ""}T${b.createdAt || ""}`;
                  return bk.localeCompare(ak);
              })
        : [];
}

function dbValidateTransactionPayload(body) {
    const accounts = dbGetRawAccounts();
    const accountNames = new Set(accounts.map((a) => a.name));
    const sourceAccount = accounts.find((a) => a.name === body.account);
    const cashflow = normalizeTransactionCashflow(body.cashflow ?? body.type);

    if (!isValidDate(body.date)) throw new Error("Choose a valid date.");
    if (!accountNames.has(body.account)) throw new Error("Select a valid account.");
    if (!TRANSACTION_CASHFLOWS.has(cashflow)) throw new Error("Select a valid cash flow.");

    const amount = toPositiveNumber(body.amount);
    if (amount === null) throw new Error("Amount must be greater than zero.");

    const currency = sourceAccount?.currency;
    if (!currency) throw new Error("The selected account must have a valid currency.");

    let category = String(body.category || "").trim();
    let subcategory = String(body.subcategory || "").trim();
    let destinationAccount = "";

    if (cashflow === "none") {
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
        cashflow,
        category,
        subcategory,
        amount,
        currency,
        notes: String(body.notes || "").trim(),
        createdAt: new Date().toISOString()
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

// ── Summary ───────────────────────────────────────────────────────────────────

function dbComputeSummary(range = {}) {
    const transactions = dbGetTransactions();
    const accounts = dbComputeAccountSummaries();
    const today = new Date().toISOString().slice(0, 7);

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
        .filter((t) => t.cashflow === "in")
        .reduce((s, t) => s + t.amount, 0);
    const expense = scoped
        .filter((t) => t.cashflow === "out")
        .reduce((s, t) => s + t.amount, 0);
    const transfer = scoped
        .filter((t) => t.cashflow === "none")
        .reduce((s, t) => s + t.amount, 0);

    const monthIncome = hasRange
        ? income
        : transactions
              .filter((t) => t.cashflow === "in" && String(t.date || "").startsWith(today))
              .reduce((s, t) => s + t.amount, 0);
    const monthExpense = hasRange
        ? expense
        : transactions
              .filter((t) => t.cashflow === "out" && String(t.date || "").startsWith(today))
              .reduce((s, t) => s + t.amount, 0);

    const expenseByCategory = Object.entries(
        scoped
            .filter((t) => t.cashflow === "out")
            .reduce((groups, t) => {
                const key = t.category || "Uncategorized";
                groups[key] = (groups[key] || 0) + t.amount;
                return groups;
            }, {})
    )
        .map(([name, amount]) => ({ name, amount }))
        .sort((a, b) => b.amount - a.amount);

    return {
        totals: {
            balance: accounts.reduce((s, a) => s + a.currentBalance, 0),
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
    getAccountMonthlyBalances: dbComputeAccountMonthlyBalances,
    saveAccount: dbSaveAccount,
    deleteAccount: dbDeleteAccount,
    getCategoryTree: dbGetCategoryTree,
    getCategories: dbGetCategories,
    saveCategory: dbSaveCategory,
    saveSubcategory: dbSaveSubcategory,
    getSummary: dbComputeSummary
};
