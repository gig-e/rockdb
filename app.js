const state = {
  songs: [],
  filtered: [],
  sources: [],
  lastUpdated: null,
  selectedSongs: new Set(),
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
  selectAll: document.getElementById("select-all"),
  selectionInfo: document.getElementById("selection-info"),
  deleteSelected: document.getElementById("delete-selected"),
  deleteModal: document.getElementById("delete-modal"),
  deleteClose: document.getElementById("delete-close"),
  deleteCount: document.getElementById("delete-count"),
  deletePreview: document.getElementById("delete-preview"),
  deleteSize: document.getElementById("delete-size"),
  confirmDelete: document.getElementById("confirm-delete"),
  cancelDelete: document.getElementById("cancel-delete"),
  selectPack: document.getElementById("select-pack"),
  packSelectModal: document.getElementById("pack-select-modal"),
  packSelector: document.getElementById("pack-selector"),
  confirmPackSelect: document.getElementById("confirm-pack-select"),
  cancelPackSelect: document.getElementById("cancel-pack-select"),
  packSelectClose: document.getElementById("pack-select-close"),
  packWarning: document.getElementById("pack-warning"),
  packWarningCount: document.getElementById("pack-warning-count"),
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

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function renderTable() {
  els.table.innerHTML = "";
  const frag = document.createDocumentFragment();
  state.filtered.forEach((song) => {
    const tr = document.createElement("tr");
    tr.dataset.songKey = song.song_key;
    if (isEurovisionSong(song)) tr.classList.add("row-highlight");
    if (state.selectedSongs.has(song.song_key)) tr.classList.add("selected");

    // Checkbox cell
    const checkboxTd = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.selectedSongs.has(song.song_key);
    checkbox.addEventListener("change", (e) => {
      toggleSongSelection(song.song_key, e.target.checked);
    });
    checkboxTd.appendChild(checkbox);
    tr.appendChild(checkboxTd);

    // Other cells
    tr.innerHTML += `
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

  // Only render the layout that's actually visible
  if (window.innerWidth < 768) renderMobileCards();

  els.count.textContent = `${state.filtered.length} songs`;
  updateSelectionUI();
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
  // Single pass over all songs to collect all filter values
  const artists = new Set(), titles = new Set(), types = new Set(),
        packs = new Set(), genres = new Set(), decades = new Set();

  for (const s of state.songs) {
    if (s.artist) artists.add(s.artist);
    if (s.name) titles.add(s.name);
    if (s.pack_type) types.add(s.pack_type);
    if (s.pack_name) packs.add(s.pack_name);
    if (s.genre) genres.add(s.genre);

    // Decade: prefer tagged decade, fall back to deriving from year
    if (s.decade) {
      const norm = normalizeDecade(s.decade.toString().replace(/'/g, ""));
      if (norm) decades.add(norm);
    } else if (s.year) {
      const y = Number(s.year);
      if (Number.isFinite(y)) decades.add(`${Math.floor(y / 10) * 10}s`);
    }
  }

  optionize(els.artist, [...artists].sort());
  optionize(els.title,  [...titles].sort());
  optionize(els.type,   [...types].sort());
  optionize(els.pack,   [...packs].sort());
  optionize(els.genre,  [...genres].sort());
  optionize(els.year,   [...decades].sort());

  // Cache pack count for showPackWarning (avoids a second full pass)
  state._packCount = packs.size;
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

// Show pack warning banner if >50 packs (uses count cached by hydrateFilters)
function showPackWarning() {
  const packCount = state._packCount || 0;
  els.packWarning.style.display = packCount > 50 ? "block" : "none";
  if (packCount > 50) els.packWarningCount.textContent = packCount;
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
    showPackWarning();
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

// Selection management functions
function toggleSongSelection(songKey, checked) {
  if (checked) {
    state.selectedSongs.add(songKey);
  } else {
    state.selectedSongs.delete(songKey);
  }
  // Update only the affected row rather than rebuilding the entire table
  const row = els.table.querySelector(`tr[data-song-key="${CSS.escape(songKey)}"]`);
  if (row) {
    row.classList.toggle("selected", checked);
    const cb = row.querySelector('input[type="checkbox"]');
    if (cb) cb.checked = checked;
  }
  updateSelectionUI();
}

function toggleSelectAll(checked) {
  state.selectedSongs.clear();
  if (checked) {
    state.filtered.forEach((s) => state.selectedSongs.add(s.song_key));
  }
  updateSelectionUI();
  renderTable();
}

function updateSelectionUI() {
  const count = state.selectedSongs.size;
  els.selectionInfo.textContent = `${count} song${count !== 1 ? "s" : ""} selected`;
  els.deleteSelected.disabled = count === 0;

  // Update select-all checkbox
  const allSelected =
    state.filtered.length > 0 &&
    state.filtered.every((s) => state.selectedSongs.has(s.song_key));
  els.selectAll.checked = allSelected;
  els.selectAll.indeterminate = !allSelected && count > 0;
}

function clearSelection() {
  state.selectedSongs.clear();
  updateSelectionUI();
  renderTable();
}

// Deletion flow functions
function closeDeleteModal() {
  els.deleteModal.classList.remove("active");
}

async function executeDeletion() {
  const songKeys = Array.from(state.selectedSongs);

  try {
    els.confirmDelete.disabled = true;
    els.confirmDelete.textContent = "Deleting...";

    const res = await fetch("/api/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ song_keys: songKeys }),
    });

    const result = await res.json();

    if (!res.ok) {
      throw new Error(result.error || "Deletion failed");
    }

    // Success
    closeDeleteModal();
    clearSelection();
    await loadCatalog(); // Reload catalog

    // Show summary
    els.notice.textContent = result.summary;
    els.notice.className = "notice";
    setStatus("Deletion complete");

    if (result.results.total_deleted < songKeys.length) {
      console.warn("Partial deletion:", result.results);
      els.notice.textContent += " (Some songs could not be deleted - check console)";
    }
  } catch (err) {
    els.notice.textContent = `Deletion failed: ${err.message}`;
    els.notice.className = "notice";
    console.error("Deletion error:", err);
  } finally {
    els.confirmDelete.disabled = false;
    els.confirmDelete.textContent = "Delete Songs";
  }
}

// Backup management functions

// Pack selection functions
function openPackSelectModal() {
  // Single pass: count songs per pack
  const counts = {};
  for (const s of state.filtered) {
    counts[s.pack_name] = (counts[s.pack_name] || 0) + 1;
  }
  const packs = Object.keys(counts).sort();

  els.packSelector.innerHTML = packs
    .map((pack) => `<option value="${escapeHtml(pack)}">${escapeHtml(pack)} (${counts[pack]} songs)</option>`)
    .join("");

  els.packSelectModal.classList.add("active");
}

function closePackSelectModal() {
  els.packSelectModal.classList.remove("active");
}

function selectAllInPack() {
  const selectedPack = els.packSelector.value;
  if (!selectedPack) return;

  state.filtered.forEach((song) => {
    if (song.pack_name === selectedPack) {
      state.selectedSongs.add(song.song_key);
    }
  });

  updateSelectionUI();
  renderTable();
  closePackSelectModal();
}

async function openDeleteModal() {
  if (state.selectedSongs.size === 0) return;

  const count = state.selectedSongs.size;
  els.deleteCount.textContent = count;
  els.deleteSize.textContent = "calculating...";

  // Build preview
  const selected = state.songs.filter((s) => state.selectedSongs.has(s.song_key));
  const html = selected
    .map((s) => `<div>${escapeHtml(s.artist)} - ${escapeHtml(s.name)}</div>`)
    .join("");
  els.deletePreview.innerHTML = html;

  els.deleteModal.classList.add("active");

  // Fetch real size from server
  try {
    const res = await fetch("/api/size", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ song_keys: Array.from(state.selectedSongs) }),
    });
    if (res.ok) {
      const data = await res.json();
      els.deleteSize.textContent = formatBytes(data.total_bytes);
    } else {
      els.deleteSize.textContent = "unknown";
    }
  } catch (err) {
    els.deleteSize.textContent = "unknown";
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

// Deletion UI listeners
els.selectAll.addEventListener("change", (e) => toggleSelectAll(e.target.checked));
els.deleteSelected.addEventListener("click", openDeleteModal);
els.selectPack.addEventListener("click", openPackSelectModal);
els.confirmDelete.addEventListener("click", executeDeletion);
els.cancelDelete.addEventListener("click", closeDeleteModal);
els.deleteClose.addEventListener("click", closeDeleteModal);

// Pack selection listeners
els.confirmPackSelect.addEventListener("click", selectAllInPack);
els.cancelPackSelect.addEventListener("click", closePackSelectModal);
els.packSelectClose.addEventListener("click", closePackSelectModal);

// Close modal when clicking outside
els.settingsModal.addEventListener("click", (e) => {
  if (e.target === els.settingsModal) {
    closeSettings();
  }
});

els.deleteModal.addEventListener("click", (e) => {
  if (e.target === els.deleteModal) {
    closeDeleteModal();
  }
});

els.packSelectModal.addEventListener("click", (e) => {
  if (e.target === els.packSelectModal) {
    closePackSelectModal();
  }
});

// Close modal with Escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (els.settingsModal.classList.contains("active")) {
      closeSettings();
    }
    if (els.deleteModal.classList.contains("active")) {
      closeDeleteModal();
    }
    if (els.packSelectModal.classList.contains("active")) {
      closePackSelectModal();
    }
  }
});

// Initialize
checkFirstRun();
loadCatalog();
