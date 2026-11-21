const RAW_JSON_URL =
  "https://raw.githubusercontent.com/cokereyaicardi/Pipo/main/data/briefing.json";
const WORKFLOW_DISPATCH_URL =
  "https://api.github.com/repos/cokereyaicardi/Pipo/actions/workflows/actualizar.yml/dispatches";
const TOKEN_STORAGE_KEY = "pipo_gh_token";

let currentCategory = "all";
let currentMode = "all";
let briefingData = null;

function setStatus(msg) {
  const el = document.getElementById("status-msg");
  if (el) el.textContent = msg;
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

  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.textContent = "Revisando pizarra...";
  }

  try {
    const previousTimestamp = briefingData ? briefingData.updated_at : null;
    const savedToken = localStorage.getItem(TOKEN_STORAGE_KEY);

    if (isManualClick && savedToken) {
      setStatus("Enviando orden al robot de Pipo en GitHub...");
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
        setStatus("Robot corriendo (tarda ~35 seg). Esperando noticias nuevas...");
        for (let i = 0; i < 8; i++) {
          await new Promise((r) => setTimeout(r, 8000));
          const candidate = await fetchLatestBriefing();
          if (candidate.updated_at !== previousTimestamp) {
            briefingData = candidate;
            if (lastUpdatedEl) {
              lastUpdatedEl.textContent = `Actualizado: ${briefingData.updated_at}`;
            }
            render();
            setStatus("¡Pizarra renovada con noticias recién salidas del horno!");
            return;
          }
        }
        setStatus("El robot sigue procesando; vuelve a pulsar en unos segundos.");
        return;
      } else {
        setStatus("Token inválido o sin permiso Actions:write. Leyendo última pizarra...");
      }
    }

    const latest = await fetchLatestBriefing();
    briefingData = latest;

    if (lastUpdatedEl) {
      lastUpdatedEl.textContent = `Actualizado: ${briefingData.updated_at || "Recién"}`;
    }
    render();

    if (isManualClick) {
      if (previousTimestamp && latest.updated_at === previousTimestamp) {
        setStatus(
          "Ya estás viendo la última edición publicada. Pulsa 'Correr robot ↗' o configura tu token para generar noticias nuevas ahora."
        );
      } else {
        setStatus("Pizarra sincronizada con la última edición.");
      }
    }
  } catch (err) {
    if (feedContainer && !briefingData) {
      feedContainer.innerHTML = `<p>Error cargando noticias. Intenta recargar en unos segundos.</p>`;
    }
    setStatus("No se pudo conectar con GitHub en este intento.");
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

    const imageHtml = item.image
      ? `<img
           src="${item.image}"
           alt=""
           loading="lazy"
           onerror="this.style.display='none'"
           style="width: 100%; height: 170px; object-fit: cover; border-radius: 8px; margin-bottom: 12px; display: block;"
         />`
      : "";

    const sourceLinkHtml = item.url
      ? `<div class="card-footer" style="margin-top: 12px;">
           <a href="${item.url}" target="_blank" rel="noopener noreferrer">Leer noticia ↗</a>
         </div>`
      : "";

    card.innerHTML = `
      ${imageHtml}
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
      setStatus("Token guardado en tu navegador. ¡Ahora 'Actualizar noticias' dispara el robot!");
    }
  });
}

loadBriefing(false);
