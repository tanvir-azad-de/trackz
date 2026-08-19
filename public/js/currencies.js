function renderCurrencies() {
    const currencies = window.state.currencies || [];
    const rates = window.state.currencyRates || {};
    const tbody = getElement("currency-list");

    if (!currencies.length) {
        tbody.innerHTML = '<tr><td colspan="3" class="empty-cell">No currencies yet.</td></tr>';
        return;
    }

    tbody.innerHTML = currencies
        .map((code) => {
            const rate = code === "EUR" ? 1 : (rates[code] ?? "");
            const isBase = code === "EUR";
            return `
                <tr>
                    <td>${escapeHtml(code)}</td>
                    <td class="align-right">
                        ${isBase
                            ? '<span class="muted">Base currency</span>'
                            : `<input type="number" class="inline-input" min="0.000001" step="any"
                                value="${escapeHtml(String(rate))}"
                                onchange="updateCurrencyRate('${escapeHtml(code)}', this.value)">`
                        }
                    </td>
                    <td class="align-right">
                        ${isBase
                            ? ""
                            : `<button class="table-button" onclick="deleteCurrency('${escapeHtml(code)}')">Delete</button>`
                        }
                    </td>
                </tr>
            `;
        })
        .join("");
}

function resetCurrencyForm() {
    getElement("currency-code").value = "";
    getElement("currency-rate").value = "";
}

function toggleCurrencyForm(force) {
    const form = getElement("currency-form");
    form.hidden = typeof force === "boolean" ? !force : !form.hidden;
    if (!form.hidden) {
        hideStatus("currency-feedback");
        resetCurrencyForm();
    }
}

async function saveCurrency() {
    const code = getElement("currency-code").value.trim().toUpperCase();
    const rate = Number(getElement("currency-rate").value);

    try {
        window.db.saveCurrency(code, rate);
    } catch (err) {
        showStatus("currency-feedback", err.message || "Could not save currency.", "error");
        return;
    }

    await loadData();
    toggleCurrencyForm(false);
    showStatus("currency-feedback", "Currency saved.");
}

async function updateCurrencyRate(code, value) {
    const rate = Number(value);
    try {
        window.db.updateCurrencyRate(code, rate);
    } catch (err) {
        showStatus("currency-feedback", err.message || "Could not update rate.", "error");
    }
    await loadData();
}

async function deleteCurrency(code) {
    const confirmed = window.confirm(`Delete currency "${code}"? Accounts using it will be affected.`);
    if (!confirmed) return;

    try {
        window.db.deleteCurrency(code);
    } catch (err) {
        showStatus("currency-feedback", err.message || "Could not delete currency.", "error");
        return;
    }

    await loadData();
    showStatus("currency-feedback", "Currency deleted.");
}

window.renderCurrencies = renderCurrencies;
window.toggleCurrencyForm = toggleCurrencyForm;
window.saveCurrency = saveCurrency;
window.updateCurrencyRate = updateCurrencyRate;
window.deleteCurrency = deleteCurrency;
