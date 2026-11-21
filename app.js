const RAW_JSON_URL =
  "https://raw.githubusercontent.com/cokereyaicardi/Pipo/main/data/briefing.json";
const WORKFLOW_DISPATCH_URL =
  "https://api.github.com/repos/cokereyaicardi/Pipo/actions/workflows/actualizar.yml/dispatches";
const TOKEN_STORAGE_KEY = "pipo_gh_token";
const MODE_STORAGE_KEY = "pipo_reading_mode";

let currentCategory = "all";
let currentMode = localStorage.getItem(MODE_STORAGE_KEY) || "all";
let briefingData = null;

function setStatus(msg) {
  const el = document.getElementById("status-msg");
  if (el) el.textContent = msg;
}

function setPulsing(active) {
  const dot = document.getElementById("radar-dot");
  if (!dot) return;
  dot.classList.toggle("is-pulsing", Boolean(active));
}

function renderSkeletons() {
  const container = document.getElementById("feed-container");
  if (!container) return;
  container.innerHTML = Array.from({ length: 6 })
    .map(() => `<div class="skeleton-card" aria-hidden="true"></div>`)
    .join("");
}

function updateCounts() {
  const items = briefingData && Array.isArray(briefingData.items) ? briefingData.items : [];
  const totalEl = document.getElementById("items-count");
  if (totalEl) {
    totalEl.textContent = `${items.length} ${items.length === 1 ? "noticia" : "noticias"}`;
  }

  document.querySelectorAll(".tab-count").forEach((span) => {
    const cat = span.dataset.count;
    const count =
      cat === "all" ? items.length : items.filter((item) => item.category === cat).length;
    span.textContent = count > 0 ? `(${count})` : "";
  });
}

function syncModeButtons() {
  document.querySelectorAll(".mode-btn[data-mode]").forEach((btn) => {
    const isActive = btn.dataset.mode === currentMode;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", String(isActive));
  });
}

async function fetchLatestBriefing() {
  const res = await fetch(`${RAW_JSON_URL}?t=${Date.now()}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return await res.json();
}

async function loadBriefing(isManualClick = false) {
  const refreshBtn = document.getElementById("refresh-btn");
  const lastUpdatedEl = document.getElementById("last-updated");
  const feedContainer = document.getElementById("feed-container");

  if (!briefingData) {
    renderSkeletons();
  }

  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.textContent = "Actualizando...";
  }
  setPulsing(true);

  try {
    const previousTimestamp = briefingData ? briefingData.updated_at : null;
    const savedToken = localStorage.getItem(TOKEN_STORAGE_KEY);

    if (isManualClick && savedToken) {
      setStatus("Enviando orden a GitHub Actions...");
      const dispatchRes = await fetch(WORKFLOW_DISPATCH_URL, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${savedToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: "main" }),
      });

      if (dispatchRes.ok) {
        setStatus("Actualizando briefing... (suele tardar ~35 seg)");
        for (let i = 0; i < 8; i++) {
          await new Promise((r) => setTimeout(r, 8000));
          const candidate = await fetchLatestBriefing();
          if (candidate.updated_at !== previousTimestamp) {
            briefingData = candidate;
            if (lastUpdatedEl) {
              lastUpdatedEl.textContent = `Actualizado: ${briefingData.updated_at}`;
            }
            updateCounts();
            render();
            setStatus("✓ Noticias actualizadas");
            return;
          }
        }
        setStatus("El robot sigue corriendo en GitHub; vuelve a pulsar en unos segundos.");
        return;
      } else {
        setStatus("Token inválido o sin permiso Actions:write. Leyendo última edición...");
      }
    }

    const latest = await fetchLatestBriefing();
    briefingData = latest;

    if (lastUpdatedEl) {
      lastUpdatedEl.textContent = `Actualizado: ${briefingData.updated_at || "Recién"}`;
    }
    updateCounts();
    render();

    if (isManualClick) {
      if (previousTimestamp && latest.updated_at === previousTimestamp) {
        setStatus(
          "Ya estás viendo la última edición publicada. Configura tu token o abre Actions para forzar una nueva."
        );
      } else {
        setStatus("✓ Datos sincronizados");
      }
    }
  } catch (err) {
    if (feedContainer && !briefingData) {
      feedContainer.innerHTML = `<p class="empty-msg">Error al cargar el briefing. Intenta recargar en unos segundos.</p>`;
    }
    setStatus("No se pudo actualizar en este intento.");
  } finally {
    setPulsing(false);
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
    container.innerHTML = `<p class="empty-msg">No hay novedades recientes en esta sección por ahora.</p>`;
    return;
  }

  const showFormal = currentMode === "all" || currentMode === "formal";
  const showTribuna = currentMode === "all" || currentMode === "tribuna";
  const bothClass = currentMode === "all" ? "both-tones" : "";

  items.forEach((item, index) => {
    const isHero = index === 0;
    const card = document.createElement("article");
    card.className = `card${isHero ? " is-hero" : ""}`;

    const imageHtml = item.image
      ? `<div class="card-media">
           <img
             src="${item.image}"
             alt=""
             loading="lazy"
             decoding="async"
             onerror="this.parentElement.style.display='none'"
           />
         </div>`
      : "";

    const dateBadgeHtml = item.date
      ? `<span class="date-tag">🗓️ ${item.date}</span>`
      : "";

    const sourceLinkHtml = item.url
      ? `<div class="card-footer">
           <a href="${item.url}" target="_blank" rel="noopener noreferrer">Leer noticia completa ↗</a>
         </div>`
      : "";

    card.innerHTML = `
      ${imageHtml}
      <div class="card-body">
        <div class="card-meta">
          <span class="badge" data-cat="${item.category || ""}">${item.category_label || item.category}</span>
          ${dateBadgeHtml}
        </div>
        <h2>${item.headline}</h2>
        <div class="tones-wrapper ${bothClass}">
          <div class="block-formal ${showFormal ? "" : "hidden"}">
            <span class="block-label">📊 Dato / Análisis</span>
            <p>${item.formal}</p>
          </div>
          <div class="block-tribuna ${showTribuna ? "" : "hidden"}">
            <span class="block-label">🔥 La Tribuna de Pipo</span>
            <p>${item.tribuna}</p>
          </div>
        </div>
        ${sourceLinkHtml}
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

document.querySelectorAll(".mode-btn[data-mode]").forEach((btn) => {
  btn.addEventListener("click", () => {
    currentMode = btn.dataset.mode;
    localStorage.setItem(MODE_STORAGE_KEY, currentMode);
    syncModeButtons();
    render();
  });
});

const refreshBtn = document.getElementById("refresh-btn");
if (refreshBtn) {
  refreshBtn.addEventListener("click", () => loadBriefing(true));
}

const tokenBtn = document.getElementById("token-btn");
if (tokenBtn) {
  tokenBtn.addEventListener("click", () => {
    const current = localStorage.getItem(TOKEN_STORAGE_KEY) || "";
    const input = prompt(
      "Pega tu GitHub Fine-Grained Token (con permiso Actions: Read & Write solo en el repo Pipo) para que 'Actualizar noticias' dispare el robot desde esta web.\n\nDéjalo vacío para borrarlo:",
      current
    );
    if (input === null) return;
    if (input.trim() === "") {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      setStatus("Token eliminado de este navegador.");
    } else {
      localStorage.setItem(TOKEN_STORAGE_KEY, input.trim());
      setStatus("✓ Token guardado. ¡Ahora 'Actualizar noticias' dispara el robot!");
    }
  });
}

const scrollTopBtn = document.getElementById("scroll-top-btn");
if (scrollTopBtn) {
  window.addEventListener(
    "scroll",
    () => {
      scrollTopBtn.classList.toggle("visible", window.scrollY > 420);
    },
    { passive: true }
  );
  scrollTopBtn.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

syncModeButtons();
loadBriefing(false);
