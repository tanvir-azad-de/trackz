// Data import/export utility for migration and backup

async function exportAllData() {
    const data = window.db.exportAll();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trackz-backup-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function importData(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (!data.transactions || !data.accounts || !data.categories) {
                    reject(new Error("Invalid data format. Expected transactions, accounts, and categories."));
                    return;
                }
                window.db.importAll(data);
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
                Import from File
                <input type="file" accept=".json" onchange="handleImport(this)" style="display:none">
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
        status.textContent = "Import successful! Data will sync to Drive shortly.";
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
