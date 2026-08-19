function renderCurrencies() {
    const currencies = window.state.currencies || [];
    const rates = window.state.currencyRates || {};
    const list = getElement("currency-list");

    if (!currencies.length) {
        list.innerHTML = '<div class="record-card empty-copy">No currencies yet.</div>';
        return;
    }

    list.innerHTML = currencies
        .map((code) => {
            const rate = code === "EUR" ? 1 : (rates[code] ?? "");
            const isBase = code === "EUR";
            return `
                <article class="record-card currency-card">
                    <div class="record-main">
                        <strong class="record-title">${escapeHtml(code)}</strong>
                        <p class="record-subtext">${isBase ? "Base currency" : "Exchange rate per 1 EUR"}</p>
                    </div>
                    <div class="record-side">
                        ${isBase
                            ? '<strong class="record-amount">1.000000</strong>'
                            : `<input type="number" class="inline-input" min="0.000001" step="any"
                                value="${escapeHtml(String(rate))}"
                                onchange="updateCurrencyRate('${escapeHtml(code)}', this.value)">`
                        }
                        ${isBase
                            ? ""
                            : `<button class="table-button" onclick="deleteCurrency('${escapeHtml(code)}')">Delete</button>`
                        }
                    </div>
                </article>
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
