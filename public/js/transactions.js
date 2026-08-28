function getTransactionSignedAmount(transaction) {
    if (transaction.cashflow === "in") {
        return transaction.amount;
    }

    if (transaction.cashflow === "out" || transaction.cashflow === "none") {
        return -transaction.amount;
    }

    return 0;
}

function transactionDescription(transaction) {
    if (transaction.cashflow === "none" && transaction.destinationAccount) {
        return `${transaction.account} → ${transaction.destinationAccount}`;
    }

    return transaction.account;
}

function transactionCategoryLabel(transaction, notesText) {
    if (!transaction) {
        return "";
    }

    let result = transaction.category;

    if(transaction.subcategory){
        result +=  ` / ${transaction.subcategory}`;
    }

    if(notesText){
        result += ` / ${notesText}`;
    }

    return result;
}

function getSelectedCategory() {
    return (window.state.categoryTree || []).find((category) => category.name === getElement("category").value) || null;
}

function populateTransactionSubcategories() {
    const selectedCategory = getSelectedCategory();
    const subcategories = selectedCategory?.subcategories || [];

    setOptions("subcategory", subcategories, {
        includeBlankLabel: subcategories.length ? "No subcategory" : "No subcategories"
    });
}

function filteredTransactions() {
    const search = getElement("search-filter").value.trim().toLowerCase();
    const type = getElement("type-filter").value;
    const account = getElement("account-filter").value;
    const from = getElement("tx-from").value;   // "YYYY-MM-DD" or ""
    const to = getElement("tx-to").value;

    return window.state.transactions.filter((transaction) => {
        const categoryLabel = transactionCategoryLabel(transaction).toLowerCase();
        const matchesSearch =
            !search ||
            transaction.notes.toLowerCase().includes(search) ||
            categoryLabel.includes(search) ||
            transaction.account.toLowerCase().includes(search) ||
            transaction.destinationAccount.toLowerCase().includes(search);

        const matchesType = !type || transaction.cashflow === type;
        const matchesAccount =
            !account ||
            transaction.account === account ||
            transaction.destinationAccount === account;

        const matchesFrom = !from || transaction.date >= from;
        const matchesTo   = !to   || transaction.date <= to;

        return matchesSearch && matchesType && matchesAccount && matchesFrom && matchesTo;
    });
}

function renderTransactions() {
    const rows = filteredTransactions();
    const list = getElement("list");

    if (!rows.length) {
        list.innerHTML = '<div class="record-card empty-copy">No transactions match the current filters.</div>';
        return;
    }

    list.innerHTML = rows
        .map((transaction) => {
            const amountClass = getTransactionSignedAmount(transaction) >= 0 ? "amount-positive" : "amount-negative";
            const amountPrefix = getTransactionSignedAmount(transaction) >= 0 ? "+" : "-";
            const notesText = transaction.notes || "";
            const categoryLabel = escapeHtml(transactionCategoryLabel(transaction, notesText));
            const dateText = escapeHtml(formatDate(transaction.date));
            const accountText = escapeHtml(transactionDescription(transaction));
            const amountText = `${amountPrefix}${formatMoney(transaction.amount, transaction.currency)}`;
            const cashflowLabel = escapeHtml(formatCashflowLabel(transaction.cashflow));

            return `
                <article class="record-card transaction-card">
                    <div class="record-main">
                        <strong class="record-title">${accountText}</strong>
                        <p class="record-subtext">${categoryLabel}</p>
                        <div class="record-inline-meta">
                            <span class="record-date">${dateText}</span>
                            <span class="pill ${transaction.cashflow}">${cashflowLabel}</span>
                        </div>
                    </div>
                    <div class="record-side">
                        <strong class="record-amount ${amountClass}">${amountText}</strong>
                        <button class="table-button" onclick="deleteTransaction('${transaction.id}')">Delete</button>
                    </div>
                </article>
            `;
        })
        .join("");
}

function syncCurrencyWithAccount() {
    const selectedAccount = window.state.accounts.find((account) => account.name === getElement("account").value);
    getElement("currency-display").textContent = selectedAccount ? "Amount (" + selectedAccount.currency + ")" : "—";
}

function updateTransactionType() {
    const isTransfer = getElement("type").value === "none";
    getElement("destination-account-group").hidden = !isTransfer;
    getElement("category").disabled = isTransfer;
    getElement("subcategory").disabled = isTransfer;
    getElement("subcategory-group").hidden = isTransfer;

    if (isTransfer) {
        getElement("category").value = "";
        populateTransactionSubcategories();
    }
}

function resetTransactionForm() {
    getElement("date").value = new Date().toISOString().slice(0, 10);
    getElement("amount").value = "";
    getElement("notes").value = "";
    getElement("type").value = "out";
    getElement("destination-account").value = "";
    getElement("subcategory").value = "";

    if (window.state.accounts[0]) {
        getElement("account").value = window.state.accounts[0].name;
        syncCurrencyWithAccount();
    }

    if (window.state.categoryTree.find((category) => category.name === "Shopping")) {
        getElement("category").value = "Shopping";
    } else if (window.state.categoryTree[0]) {
        getElement("category").value = window.state.categoryTree[0].name;
    }

    populateTransactionSubcategories();
    updateTransactionType();
}

function toggleForm(force) {
    const form = getElement("form");
    form.hidden = typeof force === "boolean" ? !force : !form.hidden;

    if (!form.hidden) {
        hideStatus("transaction-feedback");
        resetTransactionForm();
    }
}

async function saveTransaction() {
    const cashflow = getElement("type").value;

    const payload = {
        date: getElement("date").value,
        account: getElement("account").value,
        destinationAccount: getElement("destination-account").value,
        cashflow,
        category: getElement("category").value,
        subcategory: getElement("subcategory").value,
        amount: Number(getElement("amount").value),
        notes: getElement("notes").value.trim()
    };

    try {
        window.db.saveTransaction(payload);
    } catch (err) {
        showStatus("transaction-feedback", err.message || "Could not save transaction.", "error");
        return;
    }

    await loadData();
    toggleForm(false);
    showStatus("transaction-feedback", "Transaction saved.");
}

async function deleteTransaction(id) {
    const confirmed = window.confirm("Are you sure you want to delete this transaction?");

    if (!confirmed) {
        return;
    }

    try {
        window.db.deleteTransaction(id);
    } catch (err) {
        showStatus("transaction-feedback", "Could not delete transaction.", "error");
        return;
    }

    await loadData();
    showStatus("transaction-feedback", "Transaction deleted.");
}

window.getTransactionSignedAmount = getTransactionSignedAmount;
window.transactionDescription = transactionDescription;
window.transactionCategoryLabel = transactionCategoryLabel;
window.filteredTransactions = filteredTransactions;
window.renderTransactions = renderTransactions;
window.syncCurrencyWithAccount = syncCurrencyWithAccount;
window.updateTransactionType = updateTransactionType;
window.populateTransactionSubcategories = populateTransactionSubcategories;
window.resetTransactionForm = resetTransactionForm;
function toggleFilters() {
    const panel = getElement("filters-panel");
    panel.hidden = !panel.hidden;
    if (!panel.hidden) getElement("search-filter").focus();
}

window.toggleForm = toggleForm;
window.toggleFilters = toggleFilters;
window.saveTransaction = saveTransaction;
window.deleteTransaction = deleteTransaction;