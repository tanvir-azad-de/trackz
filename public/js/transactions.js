function getTransactionSignedAmount(transaction) {
  if (transaction.cashflow === "in") {
    return transaction.amount;
  }

  if (transaction.cashflow === "out" || transaction.cashflow === "none") {
    return -transaction.amount;
  }

  return 0;
}

let selectedTransactionId = "";
let editingTransactionId = "";

function setTransactionFormMode() {
  const saveButton = getElement("transaction-save-button");
  if (!saveButton) return;
  saveButton.textContent = editingTransactionId
    ? "Update transaction"
    : "Save transaction";
}

function getTransactionById(id) {
  return (
    (window.state.transactions || []).find(
      (transaction) => transaction.id === id,
    ) || null
  );
}

function getAmountClassByCashflow(cashflow) {
  const byCashflow = {
    in: "amount-positive",
    out: "amount-negative",
    none: "amount-neutral",
  };

  return byCashflow[cashflow] || "amount-neutral";
}

function getAmountPrefixByCashflow(cashflow) {
  const byCashflow = {
    in: "+",
    out: "-",
    none: "",
  };

  return byCashflow[cashflow] || "";
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

  if (transaction.subcategory) {
    result += ` | ${transaction.subcategory}`;
  }

  if (notesText) {
    result += ` | ${notesText}`;
  }

  return result;
}

function getSelectedCategory() {
  return (
    (window.state.categoryTree || []).find(
      (category) => category.name === getElement("category").value,
    ) || null
  );
}

function populateTransactionSubcategories() {
  const selectedCategory = getSelectedCategory();
  const subcategories = selectedCategory?.subcategories || [];

  setOptions("subcategory", subcategories, {
    includeBlankLabel: subcategories.length
      ? "No subcategory"
      : "No subcategories",
  });
}

function filteredTransactions() {
  const search = getElement("search-filter").value.trim().toLowerCase();
  const type = getElement("type-filter").value;
  const account = getElement("account-filter").value;
  const from = getElement("tx-from").value;
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
    const matchesTo = !to || transaction.date <= to;

    return (
      matchesSearch && matchesType && matchesAccount && matchesFrom && matchesTo
    );
  });
}

function renderTransactions() {
  const rows = filteredTransactions();
  const list = getElement("list");

  if (!rows.length) {
    list.innerHTML =
      '<div class="record-card empty-copy">No transactions match the current filters.</div>';
    return;
  }

  list.innerHTML = rows
    .map((transaction) => {
      const amountClass = getAmountClassByCashflow(transaction.cashflow);
      const amountPrefix = getAmountPrefixByCashflow(transaction.cashflow);
      const notesText = transaction.notes || "";
      const categoryLabel = escapeHtml(
        transactionCategoryLabel(transaction, notesText),
      );
      const dateText = escapeHtml(formatDate(transaction.date));
      const accountText = escapeHtml(transactionDescription(transaction));
      const amountText = `${amountPrefix}${formatMoney(transaction.amount, transaction.currency)}`;

      return `
                <article class="record-card transaction-card" role="button" tabindex="0" onclick="openTransactionDetailsModal('${transaction.id}')" onkeydown="handleTransactionCardKey(event, '${transaction.id}')">
                    <div class="record-main">
                        <span class="record-title">${accountText}</span>
                        <p class="record-subtext">${dateText}</p>
                        <p class="record-subtext">${categoryLabel}</p>

                    </div>
                    <div class="record-side">
                        <strong class="record-amount ${amountClass}">${amountText}</strong>
                    </div>
                </article>
            `;
    })
    .join("");
}

function handleTransactionCardKey(event, id) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  openTransactionDetailsModal(id);
}

function openTransactionDetailsModal(id) {
  const transaction = getTransactionById(id);
  if (!transaction) return;

  selectedTransactionId = id;

  const dateElement = getElement("transaction-details-date");
  const accountElement = getElement("transaction-details-account");
  const cashflowElement = getElement("transaction-details-cashflow");
  const categoryElement = getElement("transaction-details-category");
  const amountElement = getElement("transaction-details-amount");
  const notesElement = getElement("transaction-details-notes");

  const notesText = transaction.notes || "-";
  const categoryText = transaction.subcategory
    ? `${transaction.category} | ${transaction.subcategory}`
    : transaction.category;
  const amountPrefix = getAmountPrefixByCashflow(transaction.cashflow);

  dateElement.textContent = formatDate(transaction.date);
  accountElement.textContent = transactionDescription(transaction);
  cashflowElement.textContent = formatCashflowLabel(transaction.cashflow);
  categoryElement.textContent = categoryText;
  amountElement.textContent = `${amountPrefix}${formatMoney(transaction.amount, transaction.currency)}`;
  notesElement.textContent = notesText;

  amountElement.className = getAmountClassByCashflow(transaction.cashflow);

  const modal = getElement("transaction-details-modal");
  modal.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeTransactionDetailsModal() {
  const modal = getElement("transaction-details-modal");
  modal.hidden = true;
  document.body.style.overflow = "";
}

function handleTransactionDetailsBackdropClick(event) {
  if (event.target && event.target.id === "transaction-details-modal") {
    closeTransactionDetailsModal();
  }
}

function startEditingTransaction(id) {
  const transaction = getTransactionById(id);
  if (!transaction) return;

  toggleForm(true);
  editingTransactionId = id;

  getElement("date").value = transaction.date || "";
  getElement("account").value = transaction.account || "";
  getElement("type").value = transaction.cashflow || "out";
  updateTransactionType();

  if (transaction.cashflow === "none") {
    getElement("destination-account").value =
      transaction.destinationAccount || "";
  } else {
    const hasCategory = (window.state.categoryTree || []).some(
      (category) => category.name === transaction.category,
    );
    if (hasCategory) {
      getElement("category").value = transaction.category;
    }
    populateTransactionSubcategories();
    getElement("subcategory").value = transaction.subcategory || "";
  }

  getElement("amount").value = String(transaction.amount || "");
  getElement("notes").value = transaction.notes || "";
  syncCurrencyWithAccount();
  setTransactionFormMode();
}

function editTransactionFromModal() {
  if (!selectedTransactionId) return;
  closeTransactionDetailsModal();
  startEditingTransaction(selectedTransactionId);
}

async function deleteTransactionFromModal() {
  if (!selectedTransactionId) return;
  closeTransactionDetailsModal();
  await deleteTransaction(selectedTransactionId);
}

function syncCurrencyWithAccount() {
  const selectedAccount = window.state.accounts.find(
    (account) => account.name === getElement("account").value,
  );
  getElement("currency-display").textContent = selectedAccount
    ? "Amount (" + selectedAccount.currency + ")"
    : "Amount";
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
  editingTransactionId = "";
  getElement("date").value = new Date().toISOString().slice(0, 10);
  getElement("amount").value = "";
  getElement("notes").value = "";
  getElement("type").value = "out";
  getElement("destination-account").value = "";
  getElement("subcategory").value = "";

  if (window.state.accounts[0]) {
    getElement("account").value = window.state.accounts[0].name;
    syncCurrencyWithAccount();
  } else {
    getElement("currency-display").textContent = "Amount";
  }

  if (
    window.state.categoryTree.find((category) => category.name === "Shopping")
  ) {
    getElement("category").value = "Shopping";
  } else if (window.state.categoryTree[0]) {
    getElement("category").value = window.state.categoryTree[0].name;
  }

  populateTransactionSubcategories();
  updateTransactionType();
  setTransactionFormMode();
}

function toggleForm(force) {
  if (
    (typeof force === "boolean" ? force : getElement("form").hidden) &&
    !(window.state.accounts || []).length
  ) {
    showStatus(
      "transaction-feedback",
      "Add an account before creating transactions.",
      "error",
    );
    return;
  }

  const form = getElement("form");
  form.hidden = typeof force === "boolean" ? !force : !form.hidden;

  if (!form.hidden) {
    hideStatus("transaction-feedback");
    resetTransactionForm();
  } else {
    editingTransactionId = "";
    setTransactionFormMode();
  }
}

async function saveTransaction() {
  const cashflow = getElement("type").value;
  const isEditing = Boolean(editingTransactionId);

  if (!(window.state.accounts || []).length) {
    showStatus(
      "transaction-feedback",
      "Add an account before creating transactions.",
      "error",
    );
    return;
  }

  if (cashflow !== "none" && !(window.state.categoryTree || []).length) {
    showStatus(
      "transaction-feedback",
      "Add a category before creating non-transfer transactions.",
      "error",
    );
    return;
  }

  const payload = {
    date: getElement("date").value,
    account: getElement("account").value,
    destinationAccount: getElement("destination-account").value,
    cashflow,
    category: getElement("category").value,
    subcategory: getElement("subcategory").value,
    amount: Number(getElement("amount").value),
    notes: getElement("notes").value.trim(),
  };

  try {
    if (isEditing) {
      window.db.updateTransaction(editingTransactionId, payload);
    } else {
      window.db.saveTransaction(payload);
    }
  } catch (err) {
    showStatus(
      "transaction-feedback",
      err.message || "Could not save transaction.",
      "error",
    );
    return;
  }

  await loadData();
  toggleForm(false);
  showStatus(
    "transaction-feedback",
    isEditing ? "Transaction updated." : "Transaction saved.",
  );
  editingTransactionId = "";
  setTransactionFormMode();
}

async function deleteTransaction(id) {
  const confirmed = window.confirm(
    "Are you sure you want to delete this transaction?",
  );

  if (!confirmed) {
    return;
  }

  try {
    window.db.deleteTransaction(id);
  } catch (err) {
    showStatus(
      "transaction-feedback",
      "Could not delete transaction.",
      "error",
    );
    return;
  }

  await loadData();
  selectedTransactionId = "";
  showStatus("transaction-feedback", "Transaction deleted.");
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const modal = getElement("transaction-details-modal");
  if (modal && !modal.hidden) {
    closeTransactionDetailsModal();
  }
});

window.getTransactionSignedAmount = getTransactionSignedAmount;
window.transactionDescription = transactionDescription;
window.transactionCategoryLabel = transactionCategoryLabel;
window.filteredTransactions = filteredTransactions;
window.renderTransactions = renderTransactions;
window.handleTransactionCardKey = handleTransactionCardKey;
window.openTransactionDetailsModal = openTransactionDetailsModal;
window.closeTransactionDetailsModal = closeTransactionDetailsModal;
window.handleTransactionDetailsBackdropClick =
  handleTransactionDetailsBackdropClick;
window.editTransactionFromModal = editTransactionFromModal;
window.deleteTransactionFromModal = deleteTransactionFromModal;
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
