const state = {
  songs: [],
  filtered: [],
  sources: [],
  lastUpdated: null,
};

const els = {
  status: document.getElementById("status"),
  count: document.getElementById("count"),
  lastUpdated: document.getElementById("last-updated"),
  search: document.getElementById("search"),
  artist: document.getElementById("artist"),
  title: document.getElementById("title"),
  type: document.getElementById("type"),
  pack: document.getElementById("pack"),
  year: document.getElementById("year"),
  eurovision: document.getElementById("eurovision"),
  genre: document.getElementById("genre"),
  table: document.getElementById("songs-body"),
  sources: document.getElementById("sources"),
  update: document.getElementById("update"),
  reset: document.getElementById("reset"),
  notice: document.getElementById("notice"),
  settingsBtn: document.getElementById("settings-btn"),
  settingsModal: document.getElementById("settings-modal"),
  settingsClose: document.getElementById("settings-close"),
  devHdd0Path: document.getElementById("dev-hdd0-path"),
  pathStatus: document.getElementById("path-status"),
  saveSettings: document.getElementById("save-settings"),
  validatePath: document.getElementById("validate-path"),
};

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

function optionize(select, values) {
  const current = select.value;
  select.innerHTML = '<option value="">All</option>';
  values.forEach((value) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = value;
    select.appendChild(opt);
  });
  select.value = current;
}

function renderSources() {
  els.sources.innerHTML = "";
  if (!state.sources.length) {
    els.sources.textContent = "No sources loaded.";
    return;
  }
  const frag = document.createDocumentFragment();
  state.sources.forEach((src) => {
    const div = document.createElement("div");
    div.textContent = `${src.path} (songs: ${src.song_count})`;
    frag.appendChild(div);
  });
  els.sources.appendChild(frag);
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function renderTable() {
  els.table.innerHTML = "";
  const frag = document.createDocumentFragment();
  state.filtered.forEach((song) => {
    const tr = document.createElement("tr");
    if (isEurovisionSong(song)) tr.classList.add("row-highlight");
    tr.innerHTML = `
      <td>${escapeHtml(song.artist)}</td>
      <td>${escapeHtml(song.name)}</td>
      <td>${escapeHtml(song.album)}</td>
      <td>${escapeHtml(song.year)}</td>
      <td>${escapeHtml(song.pack_type)}</td>
      <td>${escapeHtml(song.pack_name)}</td>
      <td>${escapeHtml(song.source_file)}</td>
    `;
    frag.appendChild(tr);
  });
  els.table.appendChild(frag);

  // Render mobile cards
  renderMobileCards();

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
  const hay = Object.values(song).join(" ").toLowerCase();
  return hay.includes("eurovision");
}

function filterSongs() {
  const q = els.search.value.trim().toLowerCase();
  const artist = els.artist.value;
  const title = els.title.value;
  const type = els.type.value;
  const pack = els.pack.value;
  const decade = els.year.value;
  const genre = els.genre.value;
  const eurovisionOnly = els.eurovision.checked;

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
    const hay = `${song.artist} ${song.name} ${song.album} ${song.pack_name} ${song.pack_type} ${song.genre}`.toLowerCase();
    return hay.includes(q);
  });
  renderTable();
}

function hydrateFilters() {
  const artists = [...new Set(state.songs.map((s) => s.artist).filter(Boolean))].sort();
  const titles = [...new Set(state.songs.map((s) => s.name).filter(Boolean))].sort();
  const types = [...new Set(state.songs.map((s) => s.pack_type).filter(Boolean))].sort();
  const packs = [...new Set(state.songs.map((s) => s.pack_name).filter(Boolean))].sort();
  const decadeTags = state.songs.map((s) => (s.decade || "").toString().replace(/'/g, "")).filter(Boolean);
  const yearDecades = state.songs
    .map((s) => Number(s.year))
    .filter((y) => Number.isFinite(y))
    .map((y) => `${Math.floor(y / 10) * 10}s`);
  const normalizedTags = decadeTags
    .map((tag) => normalizeDecade(tag))
    .filter((tag) => !/^the\d{2}s$/i.test(tag));
  const decades = [...new Set([...normalizedTags, ...yearDecades])].sort();
  optionize(els.artist, artists);
  optionize(els.title, titles);
  optionize(els.type, types);
  optionize(els.pack, packs);
  const genres = [...new Set(state.songs.map((s) => s.genre).filter(Boolean))].sort();
  optionize(els.year, decades);
  optionize(els.genre, genres);
}

function resetFilters() {
  els.search.value = "";
  els.artist.value = "";
  els.title.value = "";
  els.type.value = "";
  els.pack.value = "";
  els.year.value = "";
  els.genre.value = "";
  els.eurovision.checked = false;
  filterSongs();
}

// Settings management
function openSettings() {
  els.settingsModal.classList.add("active");
  loadCurrentConfig();
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

    // Trigger rebuild
    await updateFromServer();

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
    if (res.ok) {
      const config = await res.json();

      // Check if config exists and is valid
      if (!config.dev_hdd0_path || !config.path_valid) {
        // Show settings modal on first run or invalid config
        openSettings();

        if (config.suggested_path) {
          els.devHdd0Path.value = config.suggested_path;
          showPathStatus(
            `Suggested default location. Please verify or update.`,
            "warning"
          );
        } else {
          showPathStatus(
            "Please configure the dev_hdd0 directory location",
            "warning"
          );
        }
      }
    }
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
      state.sources = meta.sources || [];
      state.lastUpdated = meta.generated_at;
      if (meta.generated_at) {
        els.lastUpdated.textContent = `Last built: ${meta.generated_at}`;
      }
    }
    hydrateFilters();
    state.filtered = [...state.songs];
    renderSources();
    filterSongs();
    setStatus("Loaded catalog.json");
  } catch (err) {
    setStatus("Unable to load catalog.json. Run the catalog server or build_catalog.py.");
    els.notice.textContent = "Tip: run `python3 rockdb/server.py` and reopen the page.";
  }
}

async function updateFromServer() {
  try {
    setStatus("Building catalog...");
    const res = await fetch("/api/build", { method: "POST" });
    if (!res.ok) throw new Error("build failed");
    const payload = await res.json();
    await loadCatalog();
    const summary = payload.summary || "Catalog updated.";
    els.notice.textContent = summary;
    setStatus("Update complete");
  } catch (err) {
    els.notice.textContent = "Update failed. Is the catalog server running?";
  }
}

// Debounced search, immediate filter for dropdowns
els.search.addEventListener("input", debounce(filterSongs, 200));
["artist", "title", "type", "pack", "year", "genre", "eurovision"].forEach((id) => {
  els[id].addEventListener("change", filterSongs);
});
els.reset.addEventListener("click", resetFilters);
els.update.addEventListener("click", updateFromServer);

// Settings modal listeners
els.settingsBtn.addEventListener("click", openSettings);
els.settingsClose.addEventListener("click", closeSettings);
els.validatePath.addEventListener("click", validatePath);
els.saveSettings.addEventListener("click", saveSettings);

// Close modal when clicking outside
els.settingsModal.addEventListener("click", (e) => {
  if (e.target === els.settingsModal) {
    closeSettings();
  }
});

// Close modal with Escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && els.settingsModal.classList.contains("active")) {
    closeSettings();
  }
});

// Initialize
checkFirstRun();
loadCatalog();
