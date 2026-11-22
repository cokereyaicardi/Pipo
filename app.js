const RAW_JSON_URL =
  "https://raw.githubusercontent.com/cokereyaicardi/Pipo/main/data/briefing.json";
const WORKFLOW_DISPATCH_URL =
  "https://api.github.com/repos/cokereyaicardi/Pipo/actions/workflows/actualizar.yml/dispatches";
const TOKEN_STORAGE_KEY = "pipo_gh_token";
const MODE_STORAGE_KEY = "pipo_reading_mode";

let currentCategory = "all";
let currentMode = localStorage.getItem(MODE_STORAGE_KEY) || "all";
let searchQuery = "";
let briefingData = null;

function setStatus(msg, autoHideMs = 0) {
  const banner = document.getElementById("status-banner");
  const textEl = document.getElementById("status-msg");
  if (!banner || !textEl) return;

  if (!msg) {
    banner.hidden = true;
    textEl.textContent = "";
    return;
  }

  textEl.textContent = msg;
  banner.hidden = false;

  if (autoHideMs > 0) {
    window.clearTimeout(setStatus._timer);
    setStatus._timer = window.setTimeout(() => {
      banner.hidden = true;
    }, autoHideMs);
  }
}

function setLoadingState(loading) {
  const btn = document.getElementById("refresh-btn");
  const label = btn ? btn.querySelector(".btn-label") : null;
  const ping = document.getElementById("radar-ping");

  if (btn) {
    btn.disabled = loading;
    btn.classList.toggle("is-loading", loading);
  }
  if (label) {
    label.textContent = loading ? "Actualizando..." : "Actualizar noticias";
  }
  if (ping) {
    ping.classList.toggle("is-active", loading);
  }
}

function renderSkeletons() {
  const lead = document.getElementById("editorial-lead");
  const grid = document.getElementById("feed-container");
  if (lead) {
    lead.classList.remove("hidden");
    lead.innerHTML = `
      <div class="skeleton" style="min-height: 260px;"></div>
      <div class="secondary-slot">
        <div class="skeleton" style="height: 124px;"></div>
        <div class="skeleton" style="height: 124px;"></div>
      </div>
    `;
  }
  if (grid) {
    grid.innerHTML = Array.from({ length: 6 })
      .map(() => `<div class="skeleton"></div>`)
      .join("");
  }
}

function getAllItems() {
  if (!briefingData || !Array.isArray(briefingData.items)) return [];
  return briefingData.items;
}

function updateCounts() {
  const items = getAllItems();
  const totalEl = document.getElementById("items-count");
  if (totalEl) {
    totalEl.textContent = `${items.length} ${items.length === 1 ? "nota" : "notas"}`;
  }

  document.querySelectorAll(".chip-count").forEach((el) => {
    const cat = el.dataset.count;
    const count = cat === "all" ? items.length : items.filter((i) => i.category === cat).length;
    el.textContent = count > 0 ? count : "";
  });
}

function syncModeButtons() {
  document.querySelectorAll(".mode-btn[data-mode]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === currentMode);
  });
}

function syncCategoryChips() {
  document.querySelectorAll(".cat-chip[data-cat]").forEach((chip) => {
    chip.classList.toggle("active", chip.dataset.cat === currentCategory);
  });
}

function syncMobileNav() {
  document.querySelectorAll(".mob-btn[data-mob-nav]").forEach((btn) => {
    const target = btn.dataset.mobNav;
    const active =
      (target === "top" && currentCategory === "all" && currentMode !== "tribuna") ||
      (target === "mis_equipos" && currentCategory === "mis_equipos") ||
      (target === "fichajes" && currentCategory === "fichajes") ||
      (target === "tribuna" && currentMode === "tribuna");
    btn.classList.toggle("active", active);
  });
}

function getPlayerFallbackAvatar(name) {
  const initials = (name || "FP")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><rect width="80" height="80" rx="40" fill="#182231"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#38bdf8" font-family="Arial, sans-serif" font-size="25" font-weight="700">${initials}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function inferClubsFromHeadline(headline = "") {
  const cleaned = headline.replace(/\s+/g, " ").trim();
  const arrowMatch = cleaned.match(
    /([A-ZÁÉÍÓÚÑ][\w\s.&'-]{1,22}?)\s*(?:->|→|➔|a|al|hacia|rumbo a)\s*([A-ZÁÉÍÓÚÑ][\w\s.&'-]{1,22})/i
  );
  if (arrowMatch) {
    return {
      from: arrowMatch[1].trim(),
      to: arrowMatch[2].trim(),
    };
  }
  const clubMatch = cleaned.match(
    /\b(Milan|AC Milan|Inter|Juventus|Real Madrid|Barcelona|Manchester United|Manchester City|Arsenal|Liverpool|Chelsea|Bayern|PSG|Boca|River|Colo Colo|U\. de Chile|Palestino|Flamengo|Palmeiras|Botafogo|Fluminense)\b/gi
  );
  if (clubMatch && clubMatch.length >= 2) {
    return { from: clubMatch[0], to: clubMatch[1] };
  }
  if (clubMatch && clubMatch.length === 1) {
    return { from: "Club actual", to: clubMatch[0] };
  }
  return { from: "Mercado / Actual", to: "Destino en carpeta" };
}

function getKindLabel(item) {
  if (item.category === "fichajes") {
    const st = (item.transfer_status || "").toUpperCase();
    return st.includes("OFICIAL")
      ? { text: "CONFIRMADO", cls: "is-confirmed" }
      : { text: "RUMOR", cls: "is-rumor" };
  }
  const txt = `${item.headline || ""} ${item.formal || ""}`.toLowerCase();
  if (txt.includes("oficial") || txt.includes("confirmad") || txt.includes("anunció")) {
    return { text: "CONFIRMADO", cls: "is-confirmed" };
  }
  if (
    txt.includes("rumor") ||
    txt.includes("interés") ||
    txt.includes("sondea") ||
    txt.includes("apunta")
  ) {
    return { text: "RUMOR", cls: "is-rumor" };
  }
  return { text: "NOTICIA", cls: "" };
}

function matchesSearch(item) {
  if (!searchQuery) return true;
  const q = searchQuery.toLowerCase();
  const haystack = [
    item.headline,
    item.formal,
    item.tribuna,
    item.category_label,
    item.player_name,
    item.from_club,
    item.to_club,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

function buildEditorialCard(item, variant = "grid") {
  const card = document.createElement("article");
  card.className = `news-card${variant === "hero" ? " is-hero" : ""}${
    variant === "compact" ? " is-compact" : ""
  }`;

  const showFormal = currentMode === "all" || currentMode === "formal";
  const showTribuna = currentMode === "all" || currentMode === "tribuna";
  const kind = getKindLabel(item);

  const mediaHtml = item.image
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

  const formalHtml =
    variant !== "compact" && item.formal
      ? `<div class="tone-box tone-formal ${showFormal ? "" : "hidden"}">
           <span class="tone-label">📊 Dato / Análisis</span>
           <p>${item.formal}</p>
         </div>`
      : "";

  const tribunaHtml =
    variant !== "compact" && item.tribuna
      ? `<div class="tone-box tone-tribuna ${showTribuna ? "" : "hidden"}">
           <span class="tone-label">🔥 La Tribuna de Pipo</span>
           <p>${item.tribuna}</p>
         </div>`
      : "";

  const linkHtml = item.url
    ? `<div class="card-foot">
         <a class="source-link" href="${item.url}" target="_blank" rel="noopener noreferrer">Leer noticia completa ↗</a>
       </div>`
    : "";

  card.innerHTML = `
    ${mediaHtml}
    <div class="card-content">
      <div class="card-top-meta">
        <div class="tags-row">
          <span class="cat-tag">${item.category_label || item.category || "Radar"}</span>
          <span class="kind-tag ${kind.cls}">${kind.text}</span>
        </div>
        <span class="card-date">${item.date || ""}</span>
      </div>
      <h2 class="card-title">${item.headline || "Sin titular"}</h2>
      ${formalHtml}
      ${tribunaHtml}
      ${linkHtml}
    </div>
  `;

  return card;
}

function buildTransferCard(item) {
  const card = document.createElement("article");
  card.className = "news-card transfer-card";

  const inferred = inferClubsFromHeadline(item.headline || "");
  const playerName = item.player_name || item.headline || "Futbolista";
  const fromClub = item.from_club || inferred.from;
  const toClub = item.to_club || inferred.to;
  const kind = getKindLabel(item);
  const fallbackSrc = getPlayerFallbackAvatar(playerName);
  const imgSrc = item.image || fallbackSrc;

  const linkHtml = item.url
    ? `<a class="source-link" href="${item.url}" target="_blank" rel="noopener noreferrer">Ver pase ↗</a>`
    : "";

  card.innerHTML = `
    <div class="transfer-top">
      <img
        class="player-pic"
        src="${imgSrc}"
        alt="${playerName}"
        loading="lazy"
        decoding="async"
        onerror="this.onerror=null;this.src='${fallbackSrc}';"
      />
      <div class="transfer-identity">
        <div class="card-top-meta">
          <span class="kind-tag ${kind.cls}">${kind.text}</span>
          <span class="card-date">${item.date || ""}</span>
        </div>
        <h3>${playerName}</h3>
      </div>
    </div>

    <div class="transfer-flow">
      <span class="club-box origin" title="${fromClub}">${fromClub}</span>
      <span class="flow-arrow" aria-hidden="true">➔</span>
      <span class="club-box dest" title="${toClub}">${toClub}</span>
    </div>

    <div class="transfer-bottom">
      <span class="transfer-headline" title="${item.headline || ""}">${item.headline || ""}</span>
      ${linkHtml}
    </div>
  `;

  return card;
}

function renderTribunaSpotlight(filteredItems) {
  const section = document.getElementById("tribuna-spotlight");
  const strip = document.getElementById("tribuna-strip");
  if (!section || !strip) return;

  const withTribuna = filteredItems.filter((i) => i.category !== "fichajes" && i.tribuna);
  if (withTribuna.length === 0 || currentMode === "formal") {
    section.classList.add("hidden");
    return;
  }

  section.classList.remove("hidden");
  strip.innerHTML = "";

  withTribuna.slice(0, 3).forEach((item) => {
    const box = document.createElement("article");
    box.className = "tribuna-mini";
    box.innerHTML = `
      <div class="tribuna-mini-head">
        <span class="cat-tag">${item.category_label || item.category || "Radar"}</span>
        <span>${item.date || ""}</span>
      </div>
      <h3>${item.headline || ""}</h3>
      <p>${item.tribuna}</p>
      ${item.url ? `<a href="${item.url}" target="_blank" rel="noopener noreferrer">Ver noticia ↗</a>` : ""}
    `;
    strip.appendChild(box);
  });
}

function render() {
  const leadSection = document.getElementById("editorial-lead");
  const grid = document.getElementById("feed-container");
  const heading = document.getElementById("latest-heading");
  const meta = document.getElementById("latest-meta");

  if (!grid) return;

  // Reconstruimos siempre heroSlot y secondarySlot limpios para evitar nodos huérfanos
  if (leadSection) {
    leadSection.innerHTML = `
      <div class="hero-slot" id="hero-slot"></div>
      <aside class="secondary-slot" id="secondary-slot" aria-label="Noticias secundarias"></aside>
    `;
  }
  const heroSlot = document.getElementById("hero-slot");
  const secondarySlot = document.getElementById("secondary-slot");
  grid.innerHTML = "";

  const allItems = getAllItems();
  const filtered = allItems.filter(
    (item) =>
      (currentCategory === "all" || item.category === currentCategory) && matchesSearch(item)
  );

  const activeChip = document.querySelector(`.cat-chip[data-cat="${currentCategory}"]`);
  const catName = activeChip ? activeChip.textContent.replace(/\d+/g, "").trim() : "Portada";

  if (heading) {
    heading.textContent = searchQuery
      ? `Resultados para "${searchQuery}"`
      : currentCategory === "all"
      ? "Últimas noticias del radar"
      : catName;
  }
  if (meta) {
    meta.textContent = `${filtered.length} ${
      filtered.length === 1 ? "publicación" : "publicaciones"
    }`;
  }

  try {
    renderTribunaSpotlight(filtered);
  } catch (e) {
    console.warn("Tribuna spotlight:", e);
  }

  if (filtered.length === 0) {
    if (leadSection) leadSection.classList.add("hidden");
    grid.innerHTML = `<div class="empty-state">No hay noticias que coincidan con el filtro o búsqueda actual.</div>`;
    syncMobileNav();
    return;
  }

  const showLead =
    Boolean(leadSection && heroSlot && secondarySlot) &&
    currentCategory !== "fichajes" &&
    !searchQuery &&
    filtered.length >= 2;

  if (showLead) {
    leadSection.classList.remove("hidden");
    heroSlot.appendChild(buildEditorialCard(filtered[0], "hero"));

    filtered.slice(1, 3).forEach((secItem) => {
      secondarySlot.appendChild(
        secItem.category === "fichajes"
          ? buildTransferCard(secItem)
          : buildEditorialCard(secItem, "compact")
      );
    });

    filtered.slice(3).forEach((item) => {
      grid.appendChild(
        item.category === "fichajes"
          ? buildTransferCard(item)
          : buildEditorialCard(item, "grid")
      );
    });
  } else {
    if (leadSection) leadSection.classList.add("hidden");
    filtered.forEach((item) => {
      grid.appendChild(
        item.category === "fichajes"
          ? buildTransferCard(item)
          : buildEditorialCard(item, "grid")
      );
    });
  }

  syncMobileNav();
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

async function applyDataAndRender(data) {
  briefingData = data;
  const lastUpdatedEl = document.getElementById("last-updated");
  if (lastUpdatedEl) {
    lastUpdatedEl.textContent = `Actualizado: ${briefingData.updated_at || "Recién"}`;
  }
  updateCounts();
  render();
}

async function loadBriefing(isManualClick = false) {
  if (!briefingData) {
    renderSkeletons();
  }

  setLoadingState(true);

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
        setStatus("Robot en marcha (~35 seg). Esperando noticias nuevas...");
        for (let i = 0; i < 8; i++) {
          await new Promise((r) => setTimeout(r, 8000));
          const candidate = await fetchLatestBriefing();
          if (candidate.updated_at !== previousTimestamp) {
            await applyDataAndRender(candidate);
            setStatus("✓ Noticias actualizadas", 4500);
            return;
          }
        }
        // Si no cambió el timestamp aún, aseguramos que la vista actual esté pintada
        const fallbackLatest = await fetchLatestBriefing();
        await applyDataAndRender(fallbackLatest);
        setStatus("El robot sigue corriendo en GitHub; vuelve a pulsar en unos segundos.", 6000);
        return;
      }

      setStatus("Token sin permiso o inválido. Leyendo última edición publicada...", 5000);
    }

    const latest = await fetchLatestBriefing();
    await applyDataAndRender(latest);

    if (isManualClick) {
      if (previousTimestamp && latest.updated_at === previousTimestamp) {
        setStatus("Ya estás viendo la última edición publicada.", 4500);
      } else {
        setStatus("✓ Datos sincronizados", 3500);
      }
    }
  } catch (err) {
    console.error("Error en loadBriefing:", err);
    if (!briefingData) {
      const grid = document.getElementById("feed-container");
      const lead = document.getElementById("editorial-lead");
      if (lead) lead.classList.add("hidden");
      if (grid) {
        grid.innerHTML = `<div class="empty-state">No se pudo cargar el briefing. Revisa tu conexión o reintenta en un momento.</div>`;
      }
    }
    setStatus("Error al actualizar el briefing.", 5000);
  } finally {
    setLoadingState(false);
  }
}

document.querySelectorAll(".cat-chip[data-cat]").forEach((chip) => {
  chip.addEventListener("click", () => {
    currentCategory = chip.dataset.cat;
    syncCategoryChips();
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

const searchInput = document.getElementById("search-input");
const clearSearchBtn = document.getElementById("clear-search");
if (searchInput) {
  searchInput.addEventListener("input", (e) => {
    searchQuery = e.target.value.trim();
    if (clearSearchBtn) {
      clearSearchBtn.classList.toggle("hidden", !searchQuery);
    }
    render();
  });
}
if (clearSearchBtn && searchInput) {
  clearSearchBtn.addEventListener("click", () => {
    searchInput.value = "";
    searchQuery = "";
    clearSearchBtn.classList.add("hidden");
    render();
  });
}

const focusTribunaBtn = document.getElementById("focus-tribuna-btn");
if (focusTribunaBtn) {
  focusTribunaBtn.addEventListener("click", () => {
    currentMode = "tribuna";
    localStorage.setItem(MODE_STORAGE_KEY, currentMode);
    syncModeButtons();
    render();
    document.getElementById("latest-section")?.scrollIntoView({ behavior: "smooth" });
  });
}

document.querySelectorAll(".mob-btn[data-mob-nav]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const nav = btn.dataset.mobNav;
    if (nav === "top") {
      currentCategory = "all";
      currentMode = "all";
    } else if (nav === "mis_equipos") {
      currentCategory = "mis_equipos";
    } else if (nav === "fichajes") {
      currentCategory = "fichajes";
    } else if (nav === "tribuna") {
      currentMode = "tribuna";
    }
    localStorage.setItem(MODE_STORAGE_KEY, currentMode);
    syncCategoryChips();
    syncModeButtons();
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
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
      "Pega tu GitHub Fine-Grained Token (permiso Actions: Read & Write en Pipo) para que 'Actualizar noticias' dispare el robot desde esta web.\n\nDéjalo vacío para borrarlo:",
      current
    );
    if (input === null) return;
    if (input.trim() === "") {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      setStatus("Token eliminado de este navegador.", 4000);
    } else {
      localStorage.setItem(TOKEN_STORAGE_KEY, input.trim());
      setStatus("✓ Token guardado. ¡El botón ya dispara el robot!", 4500);
    }
  });
}

const scrollTopBtn = document.getElementById("scroll-top-btn");
if (scrollTopBtn) {
  window.addEventListener(
    "scroll",
    () => {
      scrollTopBtn.classList.toggle("is-visible", window.scrollY > 360);
    },
    { passive: true }
  );
  scrollTopBtn.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

syncModeButtons();
syncCategoryChips();
loadBriefing(false);
