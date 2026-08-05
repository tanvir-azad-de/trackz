const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = 3000;

const DATA_DIR = path.join(__dirname, "data");
const TRANSACTION_TYPES = new Set(["Income", "Expense", "Transfer"]);

app.use(express.json());
app.use(express.static("public"));

function readJSON(file) {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8"));
}

function writeJSON(file, data) {
    fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 4));
}

function createId(prefix) {
    return `${prefix}_${crypto.randomUUID()}`;
}

function isValidDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function toPositiveNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
}

function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function getRates() {
    return readJSON("currency-rate.json");
}

function getRate(currency, rates) {
    if (currency === "EUR") {
        return 1;
    }

    const rate = rates[currency];
    return typeof rate === "number" ? rate : null;
}

function ensureTransactionIds() {
    const transactions = readJSON("transactions.json");
    let changed = false;

    const nextTransactions = transactions.map((transaction) => {
        if (transaction.id) {
            return transaction;
        }

        changed = true;

        return {
            ...transaction,
            id: createId("txn"),
            createdAt: transaction.createdAt || new Date().toISOString()
        };
    });

    if (changed) {
        writeJSON("transactions.json", nextTransactions);
    }
}

function getTransactions() {
    return readJSON("transactions.json")
        .map((transaction) => ({
            ...transaction,
            amount: toNumber(transaction.amount),
            destinationAccount: transaction.destinationAccount || "",
            notes: transaction.notes || ""
        }))
        .sort((left, right) => {
            const leftKey = `${left.date || ""}T${left.createdAt || ""}`;
            const rightKey = `${right.date || ""}T${right.createdAt || ""}`;
            return rightKey.localeCompare(leftKey);
        });
}

function getAccounts() {
    return readJSON("accounts.json").map((account) => ({
        ...account,
        openingBalance: toNumber(account.openingBalance)
    }));
}

function normalizeCategoryTree(raw) {
    if (!Array.isArray(raw)) {
        return [];
    }

    const byName = new Map();

    raw.forEach((item) => {
        if (typeof item === "string") {
            const name = item.trim();
            if (!name) return;
            if (!byName.has(name.toLowerCase())) {
                byName.set(name.toLowerCase(), { name, subcategories: [] });
            }
            return;
        }

        const name = String(item?.name || "").trim();
        if (!name) return;

        if (!byName.has(name.toLowerCase())) {
            byName.set(name.toLowerCase(), { name, subcategories: [] });
        }

        const category = byName.get(name.toLowerCase());
        const rawSubcategories = Array.isArray(item?.subcategories) ? item.subcategories : [];

        rawSubcategories.forEach((subcategoryName) => {
            const subcategory = String(subcategoryName || "").trim();
            if (!subcategory) return;
            if (!category.subcategories.some((entry) => entry.toLowerCase() === subcategory.toLowerCase())) {
                category.subcategories.push(subcategory);
            }
        });
    });

    return Array.from(byName.values()).sort((left, right) => left.name.localeCompare(right.name));
}

function getCategoryTree() {
    return normalizeCategoryTree(readJSON("categories.json"));
}

function getCategories() {
    const tree = getCategoryTree();
    const optionNames = new Map();

    tree.forEach((category) => {
        optionNames.set(category.name.toLowerCase(), category.name);
        category.subcategories.forEach((subcategory) => {
            optionNames.set(subcategory.toLowerCase(), subcategory);
        });
    });

    return Array.from(optionNames.values())
        .sort((left, right) => left.localeCompare(right))
        .map((name) => ({ name }));
}

function getCategoryByName(name) {
    const categoryName = String(name || "").trim().toLowerCase();
    return getCategoryTree().find((category) => category.name.toLowerCase() === categoryName) || null;
}

function getCurrencies() {
    return readJSON("currencies.json");
}

function getTransactionImpact(transaction, accountName) {
    if (transaction.type === "Income" && transaction.account === accountName) {
        return transaction.amount;
    }

    if (transaction.type === "Expense" && transaction.account === accountName) {
        return -transaction.amount;
    }

    if (transaction.type === "Transfer") {
        if (transaction.account === accountName) {
            return -transaction.amount;
        }

        if (transaction.destinationAccount === accountName) {
            return transaction.amount;
        }
    }

    return 0;
}

function computeAccountSummaries() {
    const accounts = getAccounts();
    const transactions = getTransactions();
    const rates = getRates();

    return accounts.map((account) => {
        const matchingTransactions = transactions.filter(
            (transaction) =>
                transaction.account === account.name ||
                transaction.destinationAccount === account.name
        );

        const currentBalance = matchingTransactions.reduce(
            (sum, transaction) => sum + getTransactionImpact(transaction, account.name),
            account.openingBalance
        );

        const rate = getRate(account.currency, rates);

        return {
            ...account,
            transactionCount: matchingTransactions.length,
            currentBalance,
            eurEquivalent: rate === null ? null : currentBalance * rate
        };
    });
}

function computeSummary(range = {}) {
    const transactions = getTransactions();
    const accounts = computeAccountSummaries();
    const rates = getRates();
    const today = new Date().toISOString().slice(0, 7);

    const toEUR = (amount, currency) => {
        const rate = getRate(currency, rates);
        return rate === null ? 0 : amount * rate;
    };

    const hasRange = Boolean(range.from || range.to);
    const from = String(range.from || "").trim();
    const to = String(range.to || "").trim();

    const scopedTransactions = hasRange
        ? transactions.filter((transaction) => {
              const date = String(transaction.date || "");
              if (!date) return false;
              if (from && date < from) return false;
              if (to && date > to) return false;
              return true;
          })
        : transactions;

    const income = scopedTransactions
        .filter((transaction) => transaction.type === "Income")
        .reduce((sum, transaction) => sum + toEUR(transaction.amount, transaction.currency), 0);

    const expense = scopedTransactions
        .filter((transaction) => transaction.type === "Expense")
        .reduce((sum, transaction) => sum + toEUR(transaction.amount, transaction.currency), 0);

    const transfer = scopedTransactions
        .filter((transaction) => transaction.type === "Transfer")
        .reduce((sum, transaction) => sum + toEUR(transaction.amount, transaction.currency), 0);

    const monthIncome = hasRange
        ? scopedTransactions
              .filter((transaction) => transaction.type === "Income")
              .reduce((sum, transaction) => sum + toEUR(transaction.amount, transaction.currency), 0)
        : transactions
              .filter(
                  (transaction) =>
                      transaction.type === "Income" && String(transaction.date || "").startsWith(today)
              )
              .reduce((sum, transaction) => sum + toEUR(transaction.amount, transaction.currency), 0);

    const monthExpense = hasRange
        ? scopedTransactions
              .filter((transaction) => transaction.type === "Expense")
              .reduce((sum, transaction) => sum + toEUR(transaction.amount, transaction.currency), 0)
        : transactions
              .filter(
                  (transaction) =>
                      transaction.type === "Expense" && String(transaction.date || "").startsWith(today)
              )
              .reduce((sum, transaction) => sum + toEUR(transaction.amount, transaction.currency), 0);

    const expenseByCategory = Object.entries(
        scopedTransactions
            .filter((transaction) => transaction.type === "Expense")
            .reduce((groups, transaction) => {
                const key = transaction.category || "Uncategorized";
                groups[key] = (groups[key] || 0) + toEUR(transaction.amount, transaction.currency);
                return groups;
            }, {})
    )
        .map(([name, amount]) => ({ name, amount }))
        .sort((left, right) => right.amount - left.amount);

    return {
        totals: {
            balance: accounts.reduce(
                (sum, account) => sum + (typeof account.eurEquivalent === "number" ? account.eurEquivalent : 0),
                0
            ),
            netWorthEUR: accounts.reduce(
                (sum, account) => sum + (typeof account.eurEquivalent === "number" ? account.eurEquivalent : 0),
                0
            ),
            income,
            expense,
            transfer,
            netCashFlow: income - expense,
            monthIncome,
            monthExpense
        },
        accounts,
        expenseByCategory,
        recentTransactions: scopedTransactions.slice(0, 5)
    };
}

function sendError(res, status, message) {
    res.status(status).json({ success: false, message });
}

function validateAccountPayload(body) {
    const accounts = getAccounts();
    const currencies = getCurrencies();
    const name = String(body.name || "").trim();

    if (!name) {
        throw new Error("Account name is required.");
    }

    if (accounts.some((account) => account.name.toLowerCase() === name.toLowerCase())) {
        throw new Error("Account name must be unique.");
    }

    if (!currencies.includes(body.currency)) {
        throw new Error("Select a valid currency.");
    }

    const openingBalance = Number(body.openingBalance);

    if (!Number.isFinite(openingBalance)) {
        throw new Error("Opening balance must be a valid number.");
    }

    return {
        name,
        currency: body.currency,
        openingBalance
    };
}

function validateTransactionPayload(body) {
    const accounts = getAccounts();
    const accountNames = new Set(accounts.map((account) => account.name));
    const sourceAccount = accounts.find((account) => account.name === body.account);

    if (!isValidDate(body.date)) {
        throw new Error("Choose a valid date.");
    }

    if (!accountNames.has(body.account)) {
        throw new Error("Select a valid account.");
    }

    if (!TRANSACTION_TYPES.has(body.type)) {
        throw new Error("Select a valid transaction type.");
    }

    const amount = toPositiveNumber(body.amount);

    if (amount === null) {
        throw new Error("Amount must be greater than zero.");
    }

    const currency = sourceAccount?.currency;

    if (!currency) {
        throw new Error("The selected account must have a valid currency.");
    }

    const debtId = String(body.debtId || "").trim();
    let category = String(body.category || "").trim();
    let subcategory = String(body.subcategory || "").trim();
    let destinationAccount = "";

    if (debtId && !["Expense", "Income"].includes(body.type)) {
        throw new Error("Debt-linked transactions must be Income or Expense.");
    }

    if (debtId) {
        const debtExists = getDebts().some((debt) => debt.id === debtId);
        if (!debtExists) {
            throw new Error("Select a valid debt.");
        }
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
        const selectedCategory = getCategoryByName(category);

        if (!selectedCategory) {
            throw new Error("Select a valid category.");
        }

        if (
            subcategory &&
            !selectedCategory.subcategories.some((entry) => entry.toLowerCase() === subcategory.toLowerCase())
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

ensureTransactionIds();

app.get("/api/transactions", (req, res) => {
    res.json(getTransactions());
});

app.post("/api/transactions", (req, res) => {
    try {
        const transactions = getTransactions();
        const transaction = validateTransactionPayload(req.body);

        transactions.push(transaction);
        writeJSON("transactions.json", transactions);

        res.status(201).json({ success: true, data: transaction });
    } catch (error) {
        sendError(res, 400, error.message);
    }
});

app.delete("/api/transactions/:id", (req, res) => {
    const transactions = getTransactions();
    const nextTransactions = transactions.filter((transaction) => transaction.id !== req.params.id);

    if (nextTransactions.length === transactions.length) {
        return sendError(res, 404, "Transaction not found.");
    }

    writeJSON("transactions.json", nextTransactions);
    return res.json({ success: true });
});

app.get("/api/categories", (req, res) => {
    res.json(getCategories());
});

app.get("/api/categories/tree", (req, res) => {
    res.json(getCategoryTree());
});

app.post("/api/categories", (req, res) => {
    try {
        const categoryName = String(req.body?.name || "").trim();

        if (!categoryName) {
            throw new Error("Category name is required.");
        }

        const categories = getCategoryTree();
        const exists = categories.some(
            (category) => category.name.toLowerCase() === categoryName.toLowerCase()
        );

        if (exists) {
            throw new Error("Category already exists.");
        }

        categories.push({ name: categoryName, subcategories: [] });
        categories.sort((left, right) => left.name.localeCompare(right.name));
        writeJSON("categories.json", categories);

        return res.status(201).json({ success: true, data: { name: categoryName, subcategories: [] } });
    } catch (error) {
        return sendError(res, 400, error.message);
    }
});

app.post("/api/categories/subcategories", (req, res) => {
    try {
        const categoryName = String(req.body?.categoryName || "").trim();
        const subcategoryName = String(req.body?.subcategoryName || "").trim();

        if (!categoryName) {
            throw new Error("Category is required.");
        }

        if (!subcategoryName) {
            throw new Error("Subcategory name is required.");
        }

        const categories = getCategoryTree();
        const index = categories.findIndex(
            (category) => category.name.toLowerCase() === categoryName.toLowerCase()
        );

        if (index === -1) {
            throw new Error("Category not found.");
        }

        const duplicate = categories[index].subcategories.some(
            (subcategory) => subcategory.toLowerCase() === subcategoryName.toLowerCase()
        );

        if (duplicate) {
            throw new Error("Subcategory already exists in this category.");
        }

        categories[index].subcategories.push(subcategoryName);
        categories[index].subcategories.sort((left, right) => left.localeCompare(right));
        writeJSON("categories.json", categories);

        return res.status(201).json({
            success: true,
            data: { categoryName: categories[index].name, subcategoryName }
        });
    } catch (error) {
        return sendError(res, 400, error.message);
    }
});

app.get("/api/currencies", (req, res) => {
    res.json(getCurrencies());
});

app.get("/api/accounts", (req, res) => {
    res.json(computeAccountSummaries());
});

app.post("/api/accounts", (req, res) => {
    try {
        const accounts = getAccounts();
        const account = validateAccountPayload(req.body);

        accounts.push(account);
        writeJSON("accounts.json", accounts);

        res.status(201).json({ success: true, data: account });
    } catch (error) {
        sendError(res, 400, error.message);
    }
});

/*
    Debts
*/

function getDebts() {
    return readJSON("debts.json");
}

function validateDebtPayload(body) {
    const currencies = getCurrencies();
    const person = String(body.person || "").trim();

    if (!person) {
        throw new Error("Person name is required.");
    }

    if (!["owed_to_me", "i_owe"].includes(body.direction)) {
        throw new Error("Direction must be 'owed_to_me' or 'i_owe'.");
    }

    const originalAmount = Number(body.originalAmount);

    if (!Number.isFinite(originalAmount) || originalAmount <= 0) {
        throw new Error("Original amount must be greater than zero.");
    }

    if (!currencies.includes(body.currency)) {
        throw new Error("Select a valid currency.");
    }

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

function validatePaymentPayload(body) {
    const accounts = getAccounts();
    const accountNames = new Set(accounts.map((a) => a.name));
    const amount = Number(body.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Payment amount must be greater than zero.");
    }

    if (!isValidDate(body.date)) {
        throw new Error("Choose a valid date.");
    }

    const account = String(body.account || "").trim();
    if (!account || !accountNames.has(account)) {
        throw new Error("Select a valid account for this payment.");
    }

    // Currency is always taken from the account
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

function buildDebtPaymentTransaction(debt, payment) {
    const accounts = getAccounts();
    const fallbackAccount =
        payment.account ||
        accounts.find((account) => account.currency === payment.currency)?.name ||
        accounts[0]?.name ||
        "";

    const fallbackCurrency = payment.currency || debt.currency;

    return {
        id: payment.transactionId || createId("txn"),
        date: payment.date,
        account: fallbackAccount,
        destinationAccount: "",
        type: debt.direction === "i_owe" ? "Expense" : "Income",
        category: debt.direction === "i_owe" ? "Debt Payment" : "Debt Collection",
        amount: payment.amount,
        currency: fallbackCurrency,
        notes:
            payment.notes ||
            (debt.direction === "i_owe" ? `Payment to ${debt.person}` : `Payment from ${debt.person}`),
        debtId: debt.id,
        paymentId: payment.id,
        createdAt: payment.createdAt || new Date().toISOString()
    };
}

function getDebtPaymentsFromTransactions(debtId) {
    return getTransactions()
        .filter((transaction) => transaction.debtId === debtId)
        .map((transaction) => ({
            id: transaction.paymentId || transaction.id,
            date: transaction.date,
            amount: transaction.amount,
            account: transaction.account,
            currency: transaction.currency,
            notes: transaction.notes || "",
            createdAt: transaction.createdAt,
            transactionId: transaction.id
        }))
        .sort((left, right) => String(right.date).localeCompare(String(left.date)));
}

function migrateEmbeddedDebtPayments() {
    const debts = getDebts();
    const transactions = getTransactions();
    let debtsChanged = false;
    let transactionsChanged = false;

    const nextDebts = debts.map((debt) => {
        if (!Array.isArray(debt.payments) || debt.payments.length === 0) {
            if (Object.prototype.hasOwnProperty.call(debt, "payments")) {
                debtsChanged = true;
                const { payments, ...rest } = debt;
                return rest;
            }

            return debt;
        }

        debt.payments.forEach((payment) => {
            const existingTransaction = transactions.find(
                (transaction) =>
                    transaction.id === payment.transactionId ||
                    (transaction.debtId === debt.id && transaction.paymentId === payment.id)
            );

            if (!existingTransaction) {
                transactions.push(buildDebtPaymentTransaction(debt, payment));
                transactionsChanged = true;
            }
        });

        debtsChanged = true;
        const { payments, ...rest } = debt;
        return rest;
    });

    if (transactionsChanged) {
        writeJSON("transactions.json", transactions);
    }

    if (debtsChanged) {
        writeJSON("debts.json", nextDebts);
    }
}

function computeDebtSummaries() {
    const rates = getRates();
    return getDebts().map((debt) => {
        const payments = getDebtPaymentsFromTransactions(debt.id);
        const toDebtCurrency = (payment) => {
            if (payment.currency === debt.currency) return payment.amount;
            const fromRate = getRate(payment.currency, rates);
            const toRate = getRate(debt.currency, rates);
            if (!fromRate || !toRate) return 0;
            return (payment.amount * fromRate) / toRate;
        };

        const paidBack = payments.reduce((sum, payment) => sum + toDebtCurrency(payment), 0);
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

app.get("/api/debts", (req, res) => {
    res.json(computeDebtSummaries());
});

app.post("/api/debts", (req, res) => {
    try {
        const debts = getDebts();
        const debt = validateDebtPayload(req.body);
        debts.push(debt);
        writeJSON("debts.json", debts);
        res.status(201).json({ success: true, data: debt });
    } catch (error) {
        sendError(res, 400, error.message);
    }
});

app.delete("/api/debts/:id", (req, res) => {
    const debts = getDebts();
    const next = debts.filter((d) => d.id !== req.params.id);
    if (next.length === debts.length) return sendError(res, 404, "Debt not found.");

    const transactions = getTransactions();
    writeJSON(
        "transactions.json",
        transactions.filter((transaction) => transaction.debtId !== req.params.id)
    );

    writeJSON("debts.json", next);
    return res.json({ success: true });
});

app.post("/api/debts/:id/payments", (req, res) => {
    try {
        const debts = getDebts();
        const index = debts.findIndex((d) => d.id === req.params.id);
        if (index === -1) return sendError(res, 404, "Debt not found.");

        const debt = debts[index];
        const payment = validatePaymentPayload(req.body);

        const transactions = getTransactions();
        const txn = buildDebtPaymentTransaction(debt, payment);
        transactions.push(txn);
        writeJSON("transactions.json", transactions);

        payment.transactionId = txn.id;

        return res.status(201).json({ success: true, data: payment });
    } catch (error) {
        return sendError(res, 400, error.message);
    }
});

app.delete("/api/debts/:id/payments/:paymentId", (req, res) => {
    const debts = getDebts();
    const debt = debts.find((item) => item.id === req.params.id);
    if (!debt) return sendError(res, 404, "Debt not found.");

    const transactions = getTransactions();
    const nextTransactions = transactions.filter(
        (transaction) => !(transaction.debtId === req.params.id && transaction.paymentId === req.params.paymentId)
    );

    if (nextTransactions.length === transactions.length) {
        return sendError(res, 404, "Payment not found.");
    }

    writeJSON("transactions.json", nextTransactions);
    return res.json({ success: true });
});

migrateEmbeddedDebtPayments();

app.get("/api/summary", (req, res) => {
    const from = String(req.query.from || "").trim();
    const to = String(req.query.to || "").trim();
    res.json(computeSummary({ from, to }));
});

app.listen(PORT, () => {
    console.log(`Trackz running at http://localhost:${PORT}`);
});
