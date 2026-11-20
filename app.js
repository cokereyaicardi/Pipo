let currentCategory = "all";
let currentMode = "all";
let briefingData = null;

async function loadBriefing() {
  try {
    const res = await fetch("./data/briefing.json");
    briefingData = await res.json();
    document.getElementById("last-updated").textContent =
      `Actualizado: ${briefingData.updated_at}`;
    render();
  } catch (err) {
    document.getElementById("feed-container").innerHTML =
      `<p>Error cargando briefing.json.</p>`;
  }
}

function render() {
  const container = document.getElementById("feed-container");
  container.innerHTML = "";

  const items = briefingData.items.filter(
    (item) => currentCategory === "all" || item.category === currentCategory
  );

  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "card";

    const showFormal = currentMode === "all" || currentMode === "formal";
    const showTribuna = currentMode === "all" || currentMode === "tribuna";

    card.innerHTML = `
      <div>
        <span class="badge">${item.category_label}</span>
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

document.querySelectorAll(".mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".mode-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentMode = btn.dataset.mode;
    render();
  });
});

loadBriefing();
