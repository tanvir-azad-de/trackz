// Data import/export utility for migration and backup, using CSV as the file format

const CSV_HEADERS = [
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

function csvEscapeField(value) {
    const str = value === null || value === undefined ? "" : String(value);
    return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function transactionsToCsv(transactions) {
    const lines = [CSV_HEADERS.join(",")];
    transactions.forEach((t) => {
        lines.push([
            t.date,
            t.account,
            t.destinationAccount,
            t.cashflow,
            t.category,
            t.categoryType,
            t.subcategory,
            t.amount,
            t.currency,
            t.notes
        ].map(csvEscapeField).join(","));
    });
    return lines.join("\r\n");
}

function parseCsvLine(line) {
    const result = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];

        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
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

function toIsoDate(date) {
    const parsed = new Date(`${date}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

// Parses raw CSV text into normalized trackz transaction records
function parseTransactionsCsv(text) {
    const rows = text
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter((line) => line.length > 0);

    if (!rows.length) {
        throw new Error("CSV file is empty.");
    }

    const headers = parseCsvLine(rows[0]).map((h) => h.trim());
    const missingHeaders = CSV_HEADERS.filter((header) => !headers.includes(header));
    if (missingHeaders.length) {
        throw new Error(`Missing required CSV columns: ${missingHeaders.join(", ")}`);
    }

    const transactions = [];
    for (let i = 1; i < rows.length; i += 1) {
        const lineNumber = i + 1;
        const values = parseCsvLine(rows[i]);
        const row = {};
        headers.forEach((header, idx) => {
            row[header] = (values[idx] || "").trim();
        });

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

        if (!date) throw new Error(`Invalid date at line ${lineNumber}: ${row.date}`);
        if (!account) throw new Error(`Missing account at line ${lineNumber}`);
        if (!["in", "out", "none"].includes(cashflow)) {
            throw new Error(`Invalid cashflow at line ${lineNumber}: ${row.cashflow}`);
        }
        if (!category) throw new Error(`Missing category at line ${lineNumber}`);
        if (!categoryType) throw new Error(`Missing category_type at line ${lineNumber}`);
        if (!Number.isFinite(amount)) throw new Error(`Invalid amount at line ${lineNumber}: ${row.amount}`);
        if (!currency) throw new Error(`Missing currency at line ${lineNumber}`);
        if (cashflow === "none" && !destinationAccount) {
            throw new Error(`Missing destinationAccount for transfer at line ${lineNumber}`);
        }

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
    }

    return transactions;
}

async function exportAllData() {
    const data = window.db.exportAll();
    // db.exportAll() returns transactions latest-first; CSV should read oldest-first
    const csv = transactionsToCsv([...data.transactions].reverse());
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trackz-backup-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

function importData(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const transactions = parseTransactionsCsv(e.target.result);
                window.db.importAll({ transactions });
                window.loadData().then(resolve).catch(reject);
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
    });
}

// Show import/export dialog
function showDataUtilityDialog() {
    const existing = document.getElementById("data-utility-dialog");
    if (existing) {
        existing.remove();
    }

    const dialog = document.createElement("div");
    dialog.id = "data-utility-dialog";
    dialog.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: var(--color-bg, #fff);
        border: 1px solid var(--color-border, #ccc);
        border-radius: 8px;
        padding: 24px;
        max-width: 400px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.2);
        z-index: 1000;
    `;

    dialog.innerHTML = `
        <h2 style="margin-top:0;margin-bottom:16px">Data Management</h2>
        <div style="display:flex;flex-direction:column;gap:12px">
            <button onclick="exportAllData()" class="primary-button" style="width:100%;padding:10px">
                Download Backup
            </button>
            <label class="primary-button" style="width:100%;padding:10px;text-align:center;cursor:pointer;display:block;margin:0">
                Import from CSV
                <input type="file" accept=".csv,text/csv" onchange="handleImport(this)" style="display:none">
            </label>
            <button onclick="closeDataUtilityDialog()" class="ghost-button" style="width:100%;padding:10px">
                Close
            </button>
        </div>
        <div id="import-status" style="margin-top:12px;font-size:0.9rem"></div>
    `;

    document.body.appendChild(dialog);
}

function closeDataUtilityDialog() {
    const dialog = document.getElementById("data-utility-dialog");
    if (dialog) dialog.remove();
}

async function handleImport(input) {
    if (!input.files[0]) return;
    
    const status = document.getElementById("import-status");
    status.textContent = "Importing...";
    status.style.color = "var(--color-text, #000)";

    try {
        await importData(input.files[0]);
        if (window.driveSync && window.driveSync.isSignedIn()) {
            await window.driveSync.syncNow();
            status.textContent = "Import successful and synced to Drive.";
        } else {
            status.textContent = "Import successful! Sign in to sync this data to Drive.";
        }
        status.style.color = "green";
        setTimeout(() => closeDataUtilityDialog(), 2000);
    } catch (err) {
        status.textContent = `Error: ${err.message}`;
        status.style.color = "red";
    }
}

window.exportAllData = exportAllData;
window.importData = importData;
window.showDataUtilityDialog = showDataUtilityDialog;
window.closeDataUtilityDialog = closeDataUtilityDialog;
window.handleImport = handleImport;
