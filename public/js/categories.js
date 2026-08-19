function categoryRows() {
    const tree = window.state.categoryTree || [];
    const rows = [];

    tree.forEach((category) => {
        if (!category.subcategories.length) {
            rows.push({ category: category.name, subcategory: "—" });
            return;
        }

        category.subcategories.forEach((subcategory) => {
            rows.push({ category: category.name, subcategory });
        });
    });

    return rows;
}

function toggleFormCategories(force) {
    const show = typeof force === "boolean" ? force : getElement("category-form").hidden;
    getElement("category-form").hidden = !show;
    getElement("subcategory-form").hidden = !show;

    if (show) {
        hideStatus("category-feedback");
        resetCategoryForms();
        getElement("category-name").focus();
    }
}

function renderCategories() {
    const list = getElement("category-list");
    const rows = categoryRows();

    if (!rows.length) {
        list.innerHTML = '<div class="record-card empty-copy">No categories yet.</div>';
        return;
    }

    list.innerHTML = rows
        .map(
            (row) => `
                <article class="record-card category-card">
                    <div class="record-main">
                        <strong class="record-title">${escapeHtml(row.category)}</strong>
                        <p class="record-subtext">${escapeHtml(row.subcategory)}</p>
                    </div>
                </article>
            `
        )
        .join("");
}

function resetCategoryForms() {
    getElement("category-name").value = "";
    getElement("subcategory-name").value = "";

    if ((window.state.categoryTree || []).length) {
        getElement("subcategory-category").value = window.state.categoryTree[0].name;
    }
}

async function saveCategory() {
    try {
        window.db.saveCategory(getElement("category-name").value.trim());
    } catch (err) {
        showStatus("category-feedback", err.message || "Could not save category.", "error");
        return;
    }

    await loadData();
    resetCategoryForms();
    showStatus("category-feedback", "Category saved.");
}

async function saveSubcategory() {
    try {
        window.db.saveSubcategory(
            getElement("subcategory-category").value,
            getElement("subcategory-name").value.trim()
        );
    } catch (err) {
        showStatus("category-feedback", err.message || "Could not save subcategory.", "error");
        return;
    }

    await loadData();
    getElement("subcategory-name").value = "";
    showStatus("category-feedback", "Subcategory saved.");
}

window.toggleFormCategories = toggleFormCategories;
window.categoryRows = categoryRows;
window.renderCategories = renderCategories;
window.resetCategoryForms = resetCategoryForms;
window.saveCategory = saveCategory;
window.saveSubcategory = saveSubcategory;
