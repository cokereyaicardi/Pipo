let currentCategory = "all";
let currentMode = "all";
let briefingData = null;

async function loadBriefing() {
  const refreshBtn = document.getElementById("refresh-btn");
  const lastUpdatedEl = document.getElementById("last-updated");
  const feedContainer = document.getElementById("feed-container");

  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.textContent = "Actualizando...";
  }

  try {
    const res = await fetch(`./data/briefing.json?v=${Date.now()}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    briefingData = await res.json();
    if (lastUpdatedEl) {
      lastUpdatedEl.textContent = `Actualizado: ${briefingData.updated_at || "Recién"}`;
    }
    render();
  } catch (err) {
    if (feedContainer) {
      feedContainer.innerHTML = `<p>Error cargando briefing.json.</p>`;
    }
  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.textContent = "Actualizar noticias";
    }
  }
}

function render() {
  const container = document.getElementById("feed-container");
  if (!container || !briefingData || !Array.isArray(briefingData.items)) {
    return;
  }

  container.innerHTML = "";

  const items = briefingData.items.filter(
    (item) => currentCategory === "all" || item.category === currentCategory
  );

  if (items.length === 0) {
    container.innerHTML = `<p>No hay tarjetas en esta categoría por ahora.</p>`;
    return;
  }

  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "card";

    const showFormal = currentMode === "all" || currentMode === "formal";
    const showTribuna = currentMode === "all" || currentMode === "tribuna";

    const sourceLinkHtml = item.url
      ? `<div class="card-footer" style="margin-top: 12px;">
           <a href="${item.url}" target="_blank" rel="noopener noreferrer">Leer noticia ↗</a>
         </div>`
      : "";

    card.innerHTML = `
      <div>
        <span class="badge">${item.category_label || item.category}</span>
        <h2>${item.headline}</h2>
      </div>
      <div class="block-formal ${showFormal ? "" : "hidden"}">
        <span class="block-label">Dato / Análisis</span>
        ${item.formal}
      </div>
      <div class="block-tribuna ${showTribuna ? "" : "hidden"}">
        <span class="block-label">La Tribuna de Pipo</span>
        ${item.tribuna}
      </div>
      ${sourceLinkHtml}
    `;
    container.appendChild(card);
  });
}

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentCategory = btn.dataset.cat;
    render();
  });
});

document.querySelectorAll(".mode-btn[data-mode]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document
      .querySelectorAll(".mode-btn[data-mode]")
      .forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentMode = btn.dataset.mode;
    render();
  });
});

const refreshBtn = document.getElementById("refresh-btn");
if (refreshBtn) {
  refreshBtn.addEventListener("click", loadBriefing);
}

loadBriefing();
