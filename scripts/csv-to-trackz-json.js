#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function printUsage() {
    console.log("Usage: npm run convert");
    console.log("Reads: dummyData/in.csv");
    console.log("Writes: dummyData/output.json");
}

function toIsoDate(date) {
    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
}

function parseCsvLine(line) {
    const result = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];

        if (ch === '"') {
            const isEscapedQuote = inQuotes && line[i + 1] === '"';
            if (isEscapedQuote) {
                current += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (ch === "," && !inQuotes) {
            result.push(current);
            current = "";
            continue;
        }

        current += ch;
    }

    result.push(current);
    return result;
}

function parseCsv(text) {
    const rows = text
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter((line) => line.length > 0);

    if (!rows.length) {
        throw new Error("CSV file is empty.");
    }

    const headers = parseCsvLine(rows[0]).map((h) => h.trim());
    const expected = [
        "date",
        "account",
        "destinationAccount",
        "cashflow",
        "category",
        "category_type",
        "subcategory",
        "amount",
        "currency",
        "notes"
    ];

    const missingHeaders = expected.filter((header) => !headers.includes(header));
    if (missingHeaders.length) {
        throw new Error(`Missing required CSV headers: ${missingHeaders.join(", ")}`);
    }

    const records = [];
    for (let i = 1; i < rows.length; i += 1) {
        const values = parseCsvLine(rows[i]);
        const record = {};

        headers.forEach((header, idx) => {
            record[header] = (values[idx] || "").trim();
        });

        records.push(record);
    }

    return records;
}

function buildTrackzJson(records) {
    const transactions = [];
    const accountsByName = new Map();
    const categoriesByName = new Map();
    const currencies = new Set();

    records.forEach((row, index) => {
        const lineNumber = index + 2;
        const date = toIsoDate(row.date);
        const account = row.account;
        const destinationAccount = row.destinationAccount || "";
        const cashflow = String(row.cashflow || "").toLowerCase();
        const category = row.category;
        const categoryType = String(row.category_type || "").toLowerCase();
        const subcategory = row.subcategory || "";
        const amount = Number(row.amount);
        const currency = String(row.currency || "").toUpperCase();
        const notes = row.notes || "";

        if (!date) {
            throw new Error(`Invalid date at line ${lineNumber}: ${row.date}`);
        }
        if (!account) {
            throw new Error(`Missing account at line ${lineNumber}`);
        }
        if (!["in", "out", "none"].includes(cashflow)) {
            throw new Error(`Invalid cashflow at line ${lineNumber}: ${row.cashflow}`);
        }
        if (!category) {
            throw new Error(`Missing category at line ${lineNumber}`);
        }
        if (!categoryType) {
            throw new Error(`Missing category_type at line ${lineNumber}`);
        }
        if (!Number.isFinite(amount)) {
            throw new Error(`Invalid amount at line ${lineNumber}: ${row.amount}`);
        }
        if (!currency) {
            throw new Error(`Missing currency at line ${lineNumber}`);
        }
        if (cashflow === "none" && !destinationAccount) {
            throw new Error(`Missing destinationAccount for transfer at line ${lineNumber}`);
        }

        if (!accountsByName.has(account)) {
            accountsByName.set(account, {
                name: account,
                currency,
                openingBalance: 0
            });
        }

        if (destinationAccount && !accountsByName.has(destinationAccount)) {
            accountsByName.set(destinationAccount, {
                name: destinationAccount,
                currency,
                openingBalance: 0
            });
        }

        if (!categoriesByName.has(category)) {
            categoriesByName.set(category, {
                name: category,
                categoryType,
                subcategories: []
            });
        }

        const existingCategory = categoriesByName.get(category);
        if (subcategory && !existingCategory.subcategories.includes(subcategory)) {
            existingCategory.subcategories.push(subcategory);
        }

        currencies.add(currency);

        transactions.push({
            id: `txn_${crypto.randomUUID()}`,
            date,
            account,
            destinationAccount,
            cashflow,
            category,
            categoryType,
            subcategory,
            amount,
            currency,
            notes,
            createdAt: `${date}T00:00:00.000Z`
        });
    });

    const accounts = Array.from(accountsByName.values()).sort((a, b) => a.name.localeCompare(b.name));
    const categories = Array.from(categoriesByName.values())
        .map((cat) => ({
            ...cat,
            subcategories: [...cat.subcategories].sort((a, b) => a.localeCompare(b))
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

    const currencyList = Array.from(currencies).sort((a, b) => a.localeCompare(b));
    const currencyRates = {};
    currencyList.forEach((code) => {
        currencyRates[code] = null;
    });

    return {
        transactions,
        accounts,
        categories,
        currencies: currencyList,
        currencyRates
    };
}

function main() {
    const [, , ...args] = process.argv;
    if (args.length) {
        console.error("This command takes no arguments.");
        printUsage();
        process.exit(1);
    }

    const projectRoot = path.resolve(__dirname, "..");
    const dataDir = path.join(projectRoot, "dummyData");
    const inputPath = path.join(dataDir, "in.csv");
    const outputPath = path.join(dataDir, "output.json");

    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    if (!fs.existsSync(inputPath)) {
        console.error(`Input file not found: ${inputPath}`);
        process.exit(1);
    }

    const raw = fs.readFileSync(inputPath, "utf8");
    const records = parseCsv(raw);
    const payload = buildTrackzJson(records);

    fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(`Created ${outputPath}`);
    console.log(`Transactions: ${payload.transactions.length}`);
    console.log(`Accounts: ${payload.accounts.length}`);
    console.log(`Categories: ${payload.categories.length}`);
}

main();
