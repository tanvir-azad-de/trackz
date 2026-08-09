function getTransactionSignedAmount(transaction) {
    if (transaction.type === "Income") {
        return transaction.amount;
    }

    if (transaction.type === "Expense" || transaction.type === "Transfer") {
        return -transaction.amount;
    }

    return 0;
}

function transactionDescription(transaction) {
    if (transaction.type === "Transfer" && transaction.destinationAccount) {
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

function isDebtTypeAllowed(type) {
    return type === "Expense" || type === "Income";
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

        const matchesType = !type || transaction.type === type;
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
    const tbody = getElement("list");
    const debtNameById = new Map((window.state.debts || []).map((debt) => [debt.id, debt.person]));

    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">No transactions match the current filters.</td></tr>';
        return;
    }

    tbody.innerHTML = rows
        .map((transaction) => {
            const amountClass = getTransactionSignedAmount(transaction) >= 0 ? "amount-positive" : "amount-negative";
            const amountPrefix = getTransactionSignedAmount(transaction) >= 0 ? "+" : "-";
            const debtName = debtNameById.get(transaction.debtId);
            const notesText = [transaction.notes, debtName ? `${debtName}` : ""].filter(Boolean).join(" / ") || "";

            return `
                <tr>
                    <td>${escapeHtml(formatDate(transaction.date))}</td>
                    <td>${escapeHtml(transactionDescription(transaction))}</td>
                    <td><span class="pill ${transaction.type.toLowerCase()}">${escapeHtml(transaction.type)}</span></td>
                    <td>${escapeHtml(transactionCategoryLabel(transaction, notesText))}</td>
                    <td class="align-right ${amountClass}">${amountPrefix}${formatMoney(transaction.amount, transaction.currency)}</td>
                    <td class="align-right"><button class="table-button" onclick="deleteTransaction('${transaction.id}')">Delete</button></td>
                </tr>
            `;
        })
        .join("");
}

function syncCurrencyWithAccount() {
    const selectedAccount = window.state.accounts.find((account) => account.name === getElement("account").value);
    getElement("currency-display").textContent = selectedAccount ? "Amount (" + selectedAccount.currency + ")" : "—";
}

function updateTransactionType() {
    const isTransfer = getElement("type").value === "Transfer";
    getElement("destination-account-group").hidden = !isTransfer;
    getElement("category").disabled = isTransfer;
    getElement("subcategory").disabled = isTransfer;
    getElement("subcategory-group").hidden = isTransfer;
    getElement("debt-group").hidden = isTransfer;

    if (isTransfer) {
        getElement("category").value = "Transfer";
        populateTransactionSubcategories();
    }
}

function populateDebtDropdown() {
    const select = getElement("transaction-debt");
    const debts = window.state.debts || [];
    const options = ['<option value="">— None —</option>'];
    
    debts.forEach((debt) => {
        const label = `${debt.person} (${debt.direction === "owed_to_me" ? "owes me" : "I owe"}) - ${debt.remaining || debt.originalAmount} ${debt.currency}`;
        options.push(`<option value="${debt.id}">${escapeHtml(label)}</option>`);
    });
    
    select.innerHTML = options.join("");
}

function resetTransactionForm() {
    getElement("date").value = new Date().toISOString().slice(0, 10);
    getElement("amount").value = "";
    getElement("notes").value = "";
    getElement("type").value = "Expense";
    getElement("destination-account").value = "";
    getElement("transaction-debt").value = "";
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

    populateDebtDropdown();
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
    const debtId = getElement("transaction-debt").value || "";
    const type = getElement("type").value;

    if (debtId && !isDebtTypeAllowed(type)) {
        showStatus("transaction-feedback", "Debt-linked transactions must be Income or Expense.", "error");
        return;
    }

    const payload = {
        date: getElement("date").value,
        account: getElement("account").value,
        destinationAccount: getElement("destination-account").value,
        type,
        category: getElement("category").value,
        subcategory: getElement("subcategory").value,
        amount: Number(getElement("amount").value),
        notes: getElement("notes").value.trim(),
        debtId: debtId || undefined
    };

    const response = await fetch("/api/transactions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (!response.ok) {
        showStatus("transaction-feedback", result.message || "Could not save transaction.", "error");
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

    const response = await fetch(`/api/transactions/${id}`, {
        method: "DELETE"
    });

    if (!response.ok) {
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
window.populateDebtDropdown = populateDebtDropdown;
window.isDebtTypeAllowed = isDebtTypeAllowed;
window.resetTransactionForm = resetTransactionForm;
window.toggleForm = toggleForm;
window.saveTransaction = saveTransaction;
window.deleteTransaction = deleteTransaction;