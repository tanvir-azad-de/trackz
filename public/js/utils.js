function getElement(id) {
    return document.getElementById(id);
}

function formatMoney(amount, currency = "EUR") {
    const symbols = {
        EUR: "€",
        BDT: "৳",
        JPY: "¥",
        USD: "$",
        GBP: "£"
    };

    const safeCurrency = String(currency || "EUR").toUpperCase();
    const symbol = symbols[safeCurrency] || `${safeCurrency} `;
    const numericAmount = Number(amount || 0).toFixed(2);
    const [integerPart, fractionPart] = numericAmount.split(".");
    const withThousands = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

    return `${symbol}${withThousands}.${fractionPart}`;
}

function escapeHtml(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function showStatus(id, message, tone = "success") {
    const element = getElement(id);
    element.textContent = message;
    element.className = `status ${tone}`;
    element.hidden = false;
}

function hideStatus(id) {
    getElement(id).hidden = true;
}

function setOptions(id, items, config = {}) {
    const select = getElement(id);
    const { includeBlankLabel = "", valueKey = "name", labelKey = "name" } = config;

    select.innerHTML = includeBlankLabel
        ? `<option value="">${includeBlankLabel}</option>`
        : "";

    items.forEach((item) => {
        const value = typeof item === "string" ? item : item[valueKey];
        const label = typeof item === "string" ? item : item[labelKey];
        select.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`);
    });
}

function formatDate(value) {
    if (!value) return "";
    const parts = String(value).split("-");
    if (parts.length !== 3) return value;
    return `${parts[2]}.${parts[1]}.${parts[0]}`;
}

window.getElement = getElement;
window.formatDate = formatDate;
window.formatMoney = formatMoney;
window.escapeHtml = escapeHtml;
window.showStatus = showStatus;
window.hideStatus = hideStatus;
window.setOptions = setOptions;