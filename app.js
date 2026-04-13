const state = {
  songs: [],
  filtered: [],
  lastUpdated: null,
  queue: { entries: [], next_id: 1 },
};

const els = {
  status: document.getElementById("status"),
  count: document.getElementById("count"),
  lastUpdated: document.getElementById("last-updated"),
  search: document.getElementById("search"),
  chipBar: document.getElementById("chip-bar"),
  chipBackdrop: document.getElementById("chip-backdrop"),
  chipPopover: document.getElementById("chip-popover"),
  chipPopoverTitle: document.getElementById("chip-popover-title"),
  chipPopoverSearch: document.getElementById("chip-popover-search"),
  chipPopoverOptions: document.getElementById("chip-popover-options"),
  chipPopoverClose: document.getElementById("chip-popover-close"),
  table: document.getElementById("songs-body"),
  reset: document.getElementById("reset"),
  notice: document.getElementById("notice"),
  settingsBtn: document.getElementById("settings-btn"),
  settingsModal: document.getElementById("settings-modal"),
  settingsClose: document.getElementById("settings-close"),
  devHdd0Path: document.getElementById("dev-hdd0-path"),
  pathStatus: document.getElementById("path-status"),
  saveSettings: document.getElementById("save-settings"),
  validatePath: document.getElementById("validate-path"),
  requesterName: document.getElementById("requester-name"),
  queueList: document.getElementById("queue-list"),
  queueCount: document.getElementById("queue-count"),
};

const filterState = {
  search: "",
  artist: "",
  title: "",
  type: "",
  pack: "",
  genre: "",
  year: "",
  eurovision: false,
};

const filterOptions = {
  artist: [],
  title: [],
  type: [],
  pack: [],
  genre: [],
  year: [],
};

const filterLabels = {
  artist: "Artist",
  title: "Title",
  type: "Type",
  pack: "Pack",
  genre: "Genre",
  year: "Decade",
  eurovision: "Eurovision",
};

let activePopoverFilter = null;

function timeAgo(isoString) {
  const seconds = Math.floor((Date.now() - new Date(isoString)) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function updateLastBuilt() {
  if (!state.lastUpdated) return;
  els.lastUpdated.textContent = `Last built: ${timeAgo(state.lastUpdated)}`;
  els.lastUpdated.title = state.lastUpdated;
}

function updateStickyOffsets() {
  const header = document.querySelector("header");
  const filterPanel = document.querySelector(".filters-panel");
  const root = document.documentElement;
  if (header) root.style.setProperty("--header-h", `${header.offsetHeight}px`);
  if (filterPanel) root.style.setProperty("--filter-h", `${filterPanel.offsetHeight}px`);
}

function debounce(fn, ms = 150) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function setStatus(message) {
  els.status.textContent = message;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function renderTable() {
  const frag = document.createDocumentFragment();
  state.filtered.forEach((song) => {
    const tr = document.createElement("tr");
    tr.dataset.songKey = song.song_key;
    if (isEurovisionSong(song)) tr.classList.add("row-highlight");
    tr.innerHTML = `
      <td>${escapeHtml(song.artist)}</td>
      <td>${escapeHtml(song.name)}</td>
      <td>${escapeHtml(song.album)}</td>
      <td>${escapeHtml(song.year)}</td>
      <td>${escapeHtml(song.pack_type)}</td>
      <td>${escapeHtml(song.pack_name)}</td>
      <td><button type="button" class="request-btn" data-song-key="${escapeHtml(song.song_key)}">Request</button></td>
    `;
    frag.appendChild(tr);
  });
  els.table.replaceChildren(frag);

  if (window.innerWidth < 768) renderMobileCards();

  els.count.textContent = `${state.filtered.length} songs`;
}

function renderMobileCards() {
  const cardsContainer = document.getElementById("song-cards");
  if (!cardsContainer) return;

  cardsContainer.innerHTML = "";
  const frag = document.createDocumentFragment();

  state.filtered.forEach((song) => {
    const card = document.createElement("div");
    card.className = "song-card";
    if (isEurovisionSong(song)) card.classList.add("row-highlight");

    card.innerHTML = `
      <div class="song-card-title">${escapeHtml(song.name)}</div>
      <div class="song-card-artist">${escapeHtml(song.artist)}</div>
      <div class="song-card-meta">
        ${song.album ? `<span><strong>Album:</strong> ${escapeHtml(song.album)}</span>` : ""}
        ${song.year ? `<span><strong>Year:</strong> ${escapeHtml(song.year)}</span>` : ""}
        ${song.genre ? `<span><strong>Genre:</strong> ${escapeHtml(song.genre)}</span>` : ""}
        ${song.pack_type ? `<span><strong>Type:</strong> ${escapeHtml(song.pack_type)}</span>` : ""}
        ${song.pack_name ? `<span><strong>Pack:</strong> ${escapeHtml(song.pack_name)}</span>` : ""}
      </div>
      <button type="button" class="request-btn" data-song-key="${escapeHtml(song.song_key)}">Request</button>
    `;
    frag.appendChild(card);
  });

  cardsContainer.appendChild(frag);
}

function normalizeDecade(raw) {
  const val = (raw || "").toString().toLowerCase().replace(/'/g, "").trim();
  const match = val.match(/^the(\d{2})s$/);
  if (match) {
    const yy = Number(match[1]);
    const base = yy < 30 ? 2000 : 1900;
    return `${base + yy}s`;
  }
  return raw || "";
}

function isEurovisionSong(song) {
  return song.is_eurovision === true;
}

function renderChips() {
  const buttons = els.chipBar.querySelectorAll(".filter-chip-btn");
  buttons.forEach((btn) => {
    const key = btn.dataset.filter;
    const val = filterState[key];
    const isActive = key === "eurovision" ? val === true : Boolean(val);
    btn.classList.toggle("active", isActive);
    if (key === "eurovision") {
      btn.textContent = "Eurovision";
    } else {
      btn.textContent = isActive ? `${filterLabels[key]}: ${val}` : filterLabels[key];
    }
  });
}

function filterSongs() {
  const q = filterState.search.trim().toLowerCase();
  const { artist, title, type, pack, genre, year: decade, eurovision: eurovisionOnly } = filterState;

  state.filtered = state.songs.filter((song) => {
    if (artist && song.artist !== artist) return false;
    if (title && song.name !== title) return false;
    if (type && song.pack_type !== type) return false;
    if (pack && song.pack_name !== pack) return false;
    if (genre && song.genre !== genre) return false;
    if (decade) {
      const tagged = normalizeDecade(song.decade);
      if (tagged) {
        if (tagged !== decade) return false;
      } else {
        const yearNum = Number(song.year);
        if (!Number.isFinite(yearNum)) return false;
        const songDecade = `${Math.floor(yearNum / 10) * 10}s`;
        if (songDecade !== decade) return false;
      }
    }
    if (eurovisionOnly && !isEurovisionSong(song)) return false;
    if (!q) return true;
    return song._hay.includes(q);
  });
  renderChips();
  renderTable();
}

function hydrateFilters() {
  const artists = new Set(), titles = new Set(), types = new Set(),
        packs = new Set(), genres = new Set(), decades = new Set();

  for (const s of state.songs) {
    s._hay = `${s.artist || ""} ${s.name || ""} ${s.album || ""} ${s.pack_name || ""} ${s.pack_type || ""} ${s.genre || ""}`.toLowerCase();
    if (s.artist) artists.add(s.artist);
    if (s.name) titles.add(s.name);
    if (s.pack_type) types.add(s.pack_type);
    if (s.pack_name) packs.add(s.pack_name);
    if (s.genre) genres.add(s.genre);

    if (s.decade) {
      const norm = normalizeDecade(s.decade.toString().replace(/'/g, ""));
      if (norm) decades.add(norm);
    } else if (s.year) {
      const y = Number(s.year);
      if (Number.isFinite(y)) decades.add(`${Math.floor(y / 10) * 10}s`);
    }
  }

  filterOptions.artist = [...artists].sort();
  filterOptions.title  = [...titles].sort();
  filterOptions.type   = [...types].sort();
  filterOptions.pack   = [...packs].sort();
  filterOptions.genre  = [...genres].sort();
  filterOptions.year   = [...decades].sort();

  state._packCount = packs.size;
}

function resetFilters() {
  filterState.search = "";
  filterState.artist = "";
  filterState.title = "";
  filterState.type = "";
  filterState.pack = "";
  filterState.year = "";
  filterState.genre = "";
  filterState.eurovision = false;
  els.search.value = "";
  closePopover();
  filterSongs();
}

function positionPopover(anchorBtn) {
  if (window.innerWidth < 768) {
    els.chipPopover.style.top = "";
    els.chipPopover.style.left = "";
    return;
  }
  const rect = anchorBtn.getBoundingClientRect();
  const popWidth = 280;
  let left = rect.left;
  const maxLeft = document.documentElement.clientWidth - popWidth - 12;
  if (left > maxLeft) left = maxLeft;
  if (left < 12) left = 12;
  els.chipPopover.style.top = `${rect.bottom + 8}px`;
  els.chipPopover.style.left = `${left}px`;
}

function renderPopoverOptions(filterKey, searchTerm = "") {
  const options = filterOptions[filterKey] || [];
  const term = searchTerm.trim().toLowerCase();
  const filtered = term ? options.filter((o) => o.toLowerCase().includes(term)) : options;
  const current = filterState[filterKey];

  const parts = [`<div class="chip-popover-option${current === "" ? " selected" : ""}" data-value="">All</div>`];
  if (filtered.length === 0) {
    parts.push(`<div class="chip-popover-empty">No matches</div>`);
  } else {
    filtered.forEach((val) => {
      const selected = current === val ? " selected" : "";
      parts.push(`<div class="chip-popover-option${selected}" data-value="${escapeHtml(val)}">${escapeHtml(val)}</div>`);
    });
  }
  els.chipPopoverOptions.innerHTML = parts.join("");
}

function openPopover(filterKey, anchorBtn) {
  if (filterKey === "eurovision") {
    filterState.eurovision = !filterState.eurovision;
    filterSongs();
    scrollToResultsOnMobile();
    return;
  }
  activePopoverFilter = filterKey;
  els.chipPopoverTitle.textContent = filterLabels[filterKey];
  els.chipPopoverSearch.value = "";
  renderPopoverOptions(filterKey);
  els.chipBackdrop.classList.add("active");
  els.chipPopover.classList.add("active");
  positionPopover(anchorBtn);
  if (window.innerWidth >= 768) {
    setTimeout(() => els.chipPopoverSearch.focus(), 0);
  }
}

function closePopover() {
  activePopoverFilter = null;
  els.chipBackdrop.classList.remove("active");
  els.chipPopover.classList.remove("active");
}

function selectOption(value) {
  if (!activePopoverFilter) return;
  filterState[activePopoverFilter] = value;
  closePopover();
  filterSongs();
  scrollToResultsOnMobile();
}

// Settings management
function openSettings({ skipLoad = false } = {}) {
  els.settingsModal.classList.add("active");
  if (!skipLoad) loadCurrentConfig();
}

function closeSettings() {
  els.settingsModal.classList.remove("active");
}

async function loadCurrentConfig() {
  try {
    const res = await fetch("/api/config");
    if (res.ok) {
      const config = await res.json();
      els.devHdd0Path.value = config.dev_hdd0_path || "";
    }
  } catch (err) {
    console.error("Failed to load config:", err);
  }
}

async function validatePath() {
  const path = els.devHdd0Path.value.trim();
  if (!path) {
    showPathStatus("Please enter a path", "error");
    return;
  }

  try {
    const res = await fetch("/api/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    const result = await res.json();

    if (result.valid) {
      showPathStatus(`✓ Valid! Found ${result.song_files} song file(s)`, "success");
    } else {
      showPathStatus(`✗ ${result.error || "Invalid path"}`, "error");
    }
  } catch (err) {
    showPathStatus("✗ Failed to validate path", "error");
  }
}

async function saveSettings() {
  const path = els.devHdd0Path.value.trim();
  if (!path) {
    showPathStatus("Please enter a path", "error");
    return;
  }

  try {
    showPathStatus("Saving configuration...", "warning");

    const res = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dev_hdd0_path: path }),
    });

    if (!res.ok) {
      const error = await res.json();
      showPathStatus(`✗ ${error.error || "Failed to save"}`, "error");
      return;
    }

    showPathStatus("✓ Saved! Rebuilding catalog...", "success");

    const buildRes = await fetch("/api/build", { method: "POST" });
    if (!buildRes.ok) {
      showPathStatus("✗ Catalog rebuild failed", "error");
      return;
    }
    await loadCatalog();

    setTimeout(() => {
      closeSettings();
      els.pathStatus.textContent = "";
      els.pathStatus.className = "setting-status";
    }, 1500);
  } catch (err) {
    showPathStatus("✗ Failed to save settings", "error");
  }
}

function showPathStatus(message, type) {
  els.pathStatus.textContent = message;
  els.pathStatus.className = `setting-status ${type}`;
}

async function checkFirstRun() {
  try {
    const res = await fetch("/api/config");
    if (!res.ok) return;
    const config = await res.json();
    if (config.dev_hdd0_path && config.path_valid) return;

    els.devHdd0Path.value = config.dev_hdd0_path || config.suggested_path || "";
    openSettings({ skipLoad: true });
    showPathStatus(
      config.suggested_path
        ? "Suggested default location. Please verify or update."
        : "Please configure the dev_hdd0 directory location",
      "warning"
    );
  } catch (err) {
    console.error("Failed to check first run:", err);
  }
}

async function loadCatalog() {
  try {
    const res = await fetch("./catalog.json", { cache: "no-store" });
    if (!res.ok) throw new Error("catalog.json missing");
    state.songs = await res.json();
    const metaRes = await fetch("./catalog_meta.json", { cache: "no-store" });
    if (metaRes.ok) {
      const meta = await metaRes.json();
      state.lastUpdated = meta.generated_at;
      updateLastBuilt();
    }
    hydrateFilters();
    state.filtered = [...state.songs];
    filterSongs();
    setStatus("Loaded catalog.json");
  } catch (err) {
    setStatus("Unable to load catalog.json. Run the catalog server or build_catalog.py.");
    els.notice.textContent = "Tip: run `python3 rockdb/server.py` and reopen the page.";
  }
}

// Queue functions
async function loadQueue() {
  try {
    const res = await fetch("/api/queue", { cache: "no-store" });
    if (!res.ok) return;
    state.queue = await res.json();
    renderQueue();
  } catch (err) {
    console.error("Failed to load queue:", err);
  }
}

function queueTimeAgo(ts) {
  const seconds = Math.floor(Date.now() / 1000 - ts);
  if (seconds < 30) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function renderQueue() {
  const entries = state.queue.entries || [];
  els.queueCount.textContent = `${entries.length} in queue`;
  if (entries.length === 0) {
    els.queueList.innerHTML = `<div class="queue-empty">No requests yet. Pick a song below and hit Request!</div>`;
    return;
  }
  els.queueList.innerHTML = entries
    .map((e, i) => {
      const nowPlaying = i === 0 ? '<span class="queue-now">NOW</span>' : `<span class="queue-pos">${i + 1}</span>`;
      return `
        <div class="queue-item${i === 0 ? " queue-item-now" : ""}">
          ${nowPlaying}
          <div class="queue-item-song">
            <div class="queue-item-title">${escapeHtml(e.name)}</div>
            <div class="queue-item-artist">${escapeHtml(e.artist)}</div>
          </div>
          <div class="queue-item-meta">
            <div class="queue-item-who">${escapeHtml(e.requested_by)}</div>
            <div class="queue-item-time">${queueTimeAgo(e.requested_at)}</div>
          </div>
        </div>
      `;
    })
    .join("");
}

async function requestSong(songKey) {
  const name = (els.requesterName.value || "").trim();
  if (!name) {
    els.requesterName.focus();
    els.requesterName.classList.add("needs-name");
    setTimeout(() => els.requesterName.classList.remove("needs-name"), 1200);
    return;
  }
  localStorage.setItem("rockdb-requester", name);
  try {
    const res = await fetch("/api/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ song_key: songKey, requested_by: name }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      els.notice.textContent = `Request failed: ${err.error || "unknown"}`;
      return;
    }
    const data = await res.json();
    state.queue = data.queue;
    renderQueue();
  } catch (err) {
    els.notice.textContent = "Request failed (network).";
  }
}

function scrollToResultsOnMobile() {
  if (window.innerWidth >= 768) return;
  // Defer past the mobile browser's native "keep focused select in view" scroll,
  // then use an absolute window.scrollTo — instant, no behavior quirks.
  requestAnimationFrame(() => {
    const target = els.count;
    if (!target) return;
    const absoluteTop = target.getBoundingClientRect().top + window.scrollY - 8;
    window.scrollTo({ top: absoluteTop });
  });
}

els.search.addEventListener("input", debounce(() => {
  filterState.search = els.search.value;
  filterSongs();
}, 200));

els.chipBar.addEventListener("click", (e) => {
  const btn = e.target.closest(".filter-chip-btn");
  if (!btn) return;
  const key = btn.dataset.filter;
  if (btn.classList.contains("active") && key !== "eurovision") {
    filterState[key] = "";
    filterSongs();
    return;
  }
  openPopover(key, btn);
});

els.chipPopoverOptions.addEventListener("click", (e) => {
  const opt = e.target.closest(".chip-popover-option");
  if (!opt) return;
  selectOption(opt.dataset.value);
});

els.chipPopoverSearch.addEventListener("input", () => {
  if (activePopoverFilter) {
    renderPopoverOptions(activePopoverFilter, els.chipPopoverSearch.value);
  }
});

els.chipPopoverClose.addEventListener("click", closePopover);
els.chipBackdrop.addEventListener("click", closePopover);

els.reset.addEventListener("click", resetFilters);

// Settings modal listeners
els.settingsBtn.addEventListener("click", openSettings);
els.settingsClose.addEventListener("click", closeSettings);
els.validatePath.addEventListener("click", validatePath);
els.saveSettings.addEventListener("click", saveSettings);

// Request buttons (delegated)
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".request-btn");
  if (!btn) return;
  requestSong(btn.dataset.songKey);
});

// Persist requester name
els.requesterName.addEventListener("input", () => {
  localStorage.setItem("rockdb-requester", els.requesterName.value);
});

// Close modal when clicking outside
els.settingsModal.addEventListener("click", (e) => {
  if (e.target === els.settingsModal) {
    closeSettings();
  }
});

// Close modal with Escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (els.settingsModal.classList.contains("active")) {
      closeSettings();
    }
    if (els.chipPopover.classList.contains("active")) {
      closePopover();
    }
  }
});

// Refresh "X ago" display every minute
setInterval(updateLastBuilt, 60_000);

// Debug helper — run `window.debugRockDB()` in DevTools to diagnose filter issues.
window.debugRockDB = function () {
  return {
    totalSongs: state.songs.length,
    filteredCount: state.filtered.length,
    filterState: { ...filterState },
    viewport: {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    },
  };
};

// Refresh queue every 15s and re-render relative times every minute
setInterval(loadQueue, 15_000);
setInterval(renderQueue, 60_000);

// Initialize
els.search.value = "";
els.requesterName.value = localStorage.getItem("rockdb-requester") || "";
updateStickyOffsets();
window.addEventListener("resize", debounce(updateStickyOffsets, 100));
checkFirstRun();
loadCatalog();
loadQueue();
