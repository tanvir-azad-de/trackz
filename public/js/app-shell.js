function renderAll() {
    renderDashboard();
    renderTransactions();
    renderAccounts();
    renderCategories();
    renderDebts();
}

const PAGES = ["dashboard", "transactions", "accounts", "categories", "debts"];

function _showPage(name) {
    if (!PAGES.includes(name)) name = "dashboard";
    window.state.currentPage = name;

    PAGES.forEach((pageName) => {
        getElement(pageName).hidden = pageName !== name;
    });

    document.querySelectorAll(".nav-button").forEach((button) => {
        button.classList.toggle("active", button.dataset.page === name);
    });
}

function page(name) {
    if (location.hash !== `#${name}`) {
        location.hash = name;
    } else {
        _showPage(name);
    }
}

async function loadData() {
    const [transactions, accounts, categories, categoryTree, currencies, summary, debts] = await Promise.all([
        fetch("/api/transactions").then((response) => response.json()),
        fetch("/api/accounts").then((response) => response.json()),
        fetch("/api/categories").then((response) => response.json()),
        fetch("/api/categories/tree").then((response) => response.json()),
        fetch("/api/currencies").then((response) => response.json()),
        fetch("/api/summary").then((response) => response.json()),
        fetch("/api/debts").then((response) => response.json())
    ]);

    window.state.transactions = transactions;
    window.state.accounts = accounts;
    window.state.categories = categories;
    window.state.categoryTree = categoryTree;
    window.state.currencies = currencies;
    window.state.summary = summary;
    window.state.dashboardSummary = null;
    window.state.debts = debts;

    setOptions("account", window.state.accounts);
    setOptions("destination-account", window.state.accounts, { includeBlankLabel: "Select account" });
    setOptions("account-filter", window.state.accounts, { includeBlankLabel: "All accounts" });
    setOptions("category", window.state.categoryTree);
    setOptions("subcategory", [], { includeBlankLabel: "No subcategories" });
    setOptions("subcategory-category", window.state.categoryTree);
    setOptions("account-currency", window.state.currencies, { valueKey: null, labelKey: null });
    setOptions("debt-currency", window.state.currencies, { valueKey: null, labelKey: null });

    getElement("account").onchange = syncCurrencyWithAccount;

    initializeDashboardRange();
    renderAll();
    resetTransactionForm();
    resetAccountForm();
    resetCategoryForms();
}

function initializeApp() {
    const hashPage = location.hash.replace(/^#/, "");
    const initialPage = PAGES.includes(hashPage) ? hashPage : "dashboard";
    _showPage(initialPage);
    loadData();
}

window.addEventListener("hashchange", () => {
    const hashPage = location.hash.replace(/^#/, "");
    _showPage(PAGES.includes(hashPage) ? hashPage : "dashboard");
});

window.renderAll = renderAll;
window.page = page;
window.loadData = loadData;
window.initializeApp = initializeApp;