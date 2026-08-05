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

function renderCategories() {
    const tbody = getElement("category-list");
    const rows = categoryRows();

    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="2" class="empty-cell">No categories yet.</td></tr>';
        return;
    }

    tbody.innerHTML = rows
        .map(
            (row) => `
                <tr>
                    <td>${escapeHtml(row.category)}</td>
                    <td>${escapeHtml(row.subcategory)}</td>
                </tr>
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
    const payload = {
        name: getElement("category-name").value.trim()
    };

    const response = await fetch("/api/categories", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (!response.ok) {
        showStatus("category-feedback", result.message || "Could not save category.", "error");
        return;
    }

    await loadData();
    resetCategoryForms();
    showStatus("category-feedback", "Category saved.");
}

async function saveSubcategory() {
    const payload = {
        categoryName: getElement("subcategory-category").value,
        subcategoryName: getElement("subcategory-name").value.trim()
    };

    const response = await fetch("/api/categories/subcategories", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (!response.ok) {
        showStatus("category-feedback", result.message || "Could not save subcategory.", "error");
        return;
    }

    await loadData();
    getElement("subcategory-name").value = "";
    showStatus("category-feedback", "Subcategory saved.");
}

window.categoryRows = categoryRows;
window.renderCategories = renderCategories;
window.resetCategoryForms = resetCategoryForms;
window.saveCategory = saveCategory;
window.saveSubcategory = saveSubcategory;
