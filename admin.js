// Admin page state
const state = {
  songs: [],
  sources: [],
  lastUpdated: null,
  duplicates: { groups: [], totalDuplicates: 0, totalGroups: 0, loaded: false },
  packMerge: { packList: [], validation: null },
};

// Element references
const els = {
  status: document.getElementById("status"),
  lastUpdated: document.getElementById("last-updated"),
  refreshBackups: document.getElementById("refresh-backups"),
  cleanupBackups: document.getElementById("cleanup-backups"),
  backupStats: document.getElementById("backup-stats"),
  dtaBackups: document.getElementById("dta-backups"),
  folderBackups: document.getElementById("folder-backups"),
  cleanupModal: document.getElementById("cleanup-modal"),
  cleanupDays: document.getElementById("cleanup-days"),
  confirmCleanup: document.getElementById("confirm-cleanup"),
  cancelCleanup: document.getElementById("cancel-cleanup"),
  cleanupClose: document.getElementById("cleanup-close"),
  findDuplicates: document.getElementById("find-duplicates"),
  duplicatesStats: document.getElementById("duplicates-stats"),
  duplicatesResults: document.getElementById("duplicates-results"),
  toggleMergeInfo: document.getElementById("toggle-merge-info"),
  mergeInfo: document.getElementById("merge-info"),
  mergeStats: document.getElementById("merge-stats"),
  packCount: document.getElementById("pack-count"),
  mergePackSelector: document.getElementById("merge-pack-selector"),
  mergedPackName: document.getElementById("merged-pack-name"),
  deleteSourcePacks: document.getElementById("delete-source-packs"),
  validateMerge: document.getElementById("validate-merge"),
  executeMerge: document.getElementById("execute-merge"),
  mergeValidationResult: document.getElementById("merge-validation-result"),
};

// Utility functions
function setStatus(message) {
  els.status.textContent = message;
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

// Load catalog (needed for duplicates and pack merging)
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

    updatePackList();
    setStatus("Catalog loaded");
  } catch (err) {
    setStatus("Unable to load catalog.json");
    console.error("Failed to load catalog:", err);
  }
}

// Backup management functions
async function loadBackups() {
  try {
    const res = await fetch("/api/backups");
    if (!res.ok) throw new Error("Failed to load backups");
    const backups = await res.json();

    // Update stats
    const totalDta = backups.dta_backups.length;
    const totalFolders = backups.folder_backups.length;
    const totalSize = backups.folder_backups.reduce((sum, b) => sum + b.size, 0);
    const sizeStr = formatBytes(totalSize);

    els.backupStats.textContent = `${totalDta} DTA backups, ${totalFolders} deleted folders (${sizeStr})`;

    // Render DTA backups
    if (backups.dta_backups.length === 0) {
      els.dtaBackups.innerHTML = '<div class="backup-list-empty">No DTA backups found</div>';
    } else {
      els.dtaBackups.innerHTML = backups.dta_backups
        .map((b) => `
          <div class="backup-item">
            <div class="backup-info">
              <div class="backup-path">${escapeHtml(b.path)}</div>
              <div class="backup-meta">${b.timestamp} • ${formatBytes(b.size)}</div>
            </div>
            <button class="backup-restore" onclick="restoreBackup('dta', '${escapeHtml(b.path)}')">Restore</button>
          </div>
        `)
        .join("");
    }

    // Render folder backups
    if (backups.folder_backups.length === 0) {
      els.folderBackups.innerHTML = '<div class="backup-list-empty">No deleted folders found</div>';
    } else {
      els.folderBackups.innerHTML = backups.folder_backups
        .map((b) => `
          <div class="backup-item">
            <div class="backup-info">
              <div class="backup-path">${escapeHtml(b.path)}</div>
              <div class="backup-meta">${b.timestamp} • ${formatBytes(b.size)}</div>
            </div>
            <button class="backup-restore" onclick="restoreBackup('folder', '${escapeHtml(b.path)}')">Restore</button>
          </div>
        `)
        .join("");
    }
  } catch (err) {
    els.backupStats.textContent = `Error loading backups: ${err.message}`;
    console.error("Failed to load backups:", err);
  }
}

async function restoreBackup(type, path) {
  if (!confirm(`Restore ${type === 'dta' ? 'DTA file' : 'folder'} from backup?\n\n${path}`)) {
    return;
  }

  try {
    setStatus(`Restoring ${type} backup...`);
    const res = await fetch("/api/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backup_type: type, backup_path: path }),
    });

    const result = await res.json();

    if (result.ok) {
      alert(result.summary);
      setStatus("Restore complete");
      await loadBackups();
      await loadCatalog();
    } else {
      throw new Error(result.error || "Restore failed");
    }
  } catch (err) {
    alert(`Restore failed: ${err.message}`);
    console.error("Restore error:", err);
  }
}

function openCleanupModal() {
  els.cleanupModal.classList.add("active");
}

function closeCleanupModal() {
  els.cleanupModal.classList.remove("active");
}

async function executeCleanup() {
  const days = parseInt(els.cleanupDays.value);

  if (!confirm(`Remove backup files older than ${days} days?\n\nThis action cannot be undone.`)) {
    return;
  }

  try {
    els.confirmCleanup.disabled = true;
    els.confirmCleanup.textContent = "Cleaning...";

    const res = await fetch("/api/cleanup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days_old: days }),
    });

    const result = await res.json();

    if (result.ok) {
      closeCleanupModal();
      alert(result.summary);
      await loadBackups();
    } else {
      throw new Error(result.error || "Cleanup failed");
    }
  } catch (err) {
    alert(`Cleanup failed: ${err.message}`);
    console.error("Cleanup error:", err);
  } finally {
    els.confirmCleanup.disabled = false;
    els.confirmCleanup.textContent = "Cleanup";
  }
}

// Duplicate detection functions
async function findDuplicates() {
  try {
    els.findDuplicates.disabled = true;
    els.findDuplicates.textContent = "Scanning...";
    els.duplicatesStats.textContent = "Analyzing catalog...";

    const res = await fetch("/api/duplicates");
    if (!res.ok) throw new Error("Failed to find duplicates");

    const result = await res.json();
    state.duplicates = {
      groups: result.duplicate_groups,
      totalDuplicates: result.total_duplicates,
      totalGroups: result.total_groups,
      loaded: true
    };

    renderDuplicates();
  } catch (err) {
    els.duplicatesStats.textContent = `Error: ${err.message}`;
    console.error("Duplicate detection error:", err);
  } finally {
    els.findDuplicates.disabled = false;
    els.findDuplicates.textContent = "Find Duplicates";
  }
}

// Catalog fields to compare per version + which map to patchable DTA fields
const META_FIELDS = [
  { key: 'album',     label: 'Album',     dtaField: 'album_name' },
  { key: 'year',      label: 'Year',      dtaField: 'year_released' },
  { key: 'genre',     label: 'Genre',     dtaField: 'genre' },
  { key: 'sub_genre', label: 'Sub-genre', dtaField: 'sub_genre' },
  { key: 'decade',    label: 'Decade',    dtaField: 'decade' },
];

function renderDuplicates() {
  const { groups, totalDuplicates, totalGroups } = state.duplicates;

  if (totalGroups === 0) {
    els.duplicatesStats.textContent = "No duplicates found!";
    els.duplicatesResults.innerHTML = '<div class="duplicates-empty">Your catalog has no duplicate songs.</div>';
    return;
  }

  const totalToFree = groups.reduce((sum, g) => sum + (g.size_to_free || 0), 0);
  const totalDeleteKeys = groups.reduce((sum, g) => sum + g.recommended_delete.length, 0);

  els.duplicatesStats.innerHTML =
    `Found <strong>${totalDuplicates}</strong> duplicate song${totalDuplicates !== 1 ? 's' : ''} ` +
    `in <strong>${totalGroups}</strong> group${totalGroups !== 1 ? 's' : ''} ` +
    `(${formatBytes(totalToFree)} to free) &nbsp;` +
    `<button class="danger" onclick="deleteAllDuplicates()">Delete All ${totalDeleteKeys} Duplicates</button>`;

  const renderVersion = (song, isKeep, groupIdx, songIdx, keepSong) => {
    const badge = isKeep
      ? '<div class="version-badge keep-badge">KEEP</div>'
      : '<div class="version-badge delete-badge">DELETE</div>';

    const fieldHtml = META_FIELDS.map(({ key, label }) => {
      const val = song[key];
      const keepVal = keepSong[key];
      const isMissing = !isKeep && !val && !!keepVal;
      const isDifferent = !isKeep && !!val && !!keepVal && String(val) !== String(keepVal);
      let cls = 'field-item';
      if (isMissing) cls += ' field-missing';
      else if (isDifferent) cls += ' field-different';
      return `<span class="${cls}"><strong>${label}:</strong> ${val ? escapeHtml(String(val)) : '<em>—</em>'}</span>`;
    }).join('');

    const missingCount = !isKeep
      ? META_FIELDS.filter(({ key }) => !song[key] && !!keepSong[key]).length
      : 0;

    const fillBtn = missingCount > 0
      ? `<button class="ghost fill-missing-btn" onclick="fillMissingMetadata(${groupIdx}, ${songIdx})">
           Fill ${missingCount} missing field${missingCount !== 1 ? 's' : ''} from KEEP
         </button>`
      : '';

    return `
      <div class="duplicate-version ${isKeep ? 'keep-version' : 'delete-version'}">
        ${badge}
        <div class="version-info">
          <div class="version-primary">
            <span><strong>Pack:</strong> ${escapeHtml(song.pack_name)}</span>
            <span><strong>Type:</strong> ${escapeHtml(song.pack_type)}</span>
          </div>
          <div class="version-source">${escapeHtml(song.source_file)}</div>
          <div class="version-fields">${fieldHtml}</div>
          ${fillBtn}
        </div>
      </div>`;
  };

  const html = groups.map((group, groupIdx) => {
    const keepSong = group.songs[0];
    const deleteSongs = group.songs.slice(1);
    return `
      <div class="duplicate-group">
        <div class="duplicate-header">
          <div class="duplicate-title">
            <strong>${escapeHtml(group.artist)}</strong> — ${escapeHtml(group.name)}
            ${group.album ? `<span class="duplicate-album">(${escapeHtml(group.album)})</span>` : ''}
          </div>
          <div class="duplicate-meta">
            ${group.songs.length} version${group.songs.length !== 1 ? 's' : ''} •
            ${group.size_to_free ? formatBytes(group.size_to_free) + ' to free' : 'size unknown'}
          </div>
        </div>
        <div class="duplicate-versions">
          ${renderVersion(keepSong, true, groupIdx, 0, keepSong)}
          ${deleteSongs.map((song, i) => renderVersion(song, false, groupIdx, i + 1, keepSong)).join('')}
        </div>
        <div class="duplicate-actions">
          <button class="danger" onclick="deleteDuplicateGroup(${groupIdx})">
            Delete ${deleteSongs.length} Duplicate${deleteSongs.length !== 1 ? 's' : ''}
          </button>
        </div>
      </div>`;
  }).join('');

  els.duplicatesResults.innerHTML = html;
}

async function deleteDuplicateGroup(groupIdx) {
  const group = state.duplicates.groups[groupIdx];
  if (!group) return;

  const keepSong = group.songs[0];
  const keepType = keepSong?.pack_type ?? 'unknown';

  if (!confirm(
    `Delete ${group.recommended_delete.length} duplicate(s) of "${group.artist} - ${group.name}"?\n\n` +
    `This will keep the ${keepType} version and delete the others.`
  )) {
    return;
  }

  try {
    setStatus("Deleting duplicates...");

    const res = await fetch("/api/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ song_keys: group.recommended_delete }),
    });

    const result = await res.json();

    if (!res.ok) {
      throw new Error(result.error || "Deletion failed");
    }

    // Show feedback and reload
    els.duplicatesStats.textContent = "Refreshing duplicate list...";
    setStatus("Reloading catalog and rescanning...");

    // Reload catalog and re-scan duplicates
    await loadCatalog();
    await findDuplicates();

    // Scroll to top of results
    document.querySelector('#duplicates-panel').scrollIntoView({ behavior: 'smooth' });

    alert(result.summary);
    setStatus("Deletion complete");
  } catch (err) {
    alert(`Deletion failed: ${err.message}`);
    console.error("Deletion error:", err);
  }
}

async function fillMissingMetadata(groupIdx, songIdx) {
  const group = state.duplicates.groups[groupIdx];
  if (!group) return;

  const keepSong = group.songs[0];
  const targetSong = group.songs[songIdx];
  if (!targetSong) return;

  // Build the DTA fields dict for missing values
  const fields = {};
  for (const { key, dtaField } of META_FIELDS) {
    if (!targetSong[key] && keepSong[key]) {
      fields[dtaField] = keepSong[key];
    }
  }

  if (Object.keys(fields).length === 0) {
    alert('No missing fields to fill from the KEEP version.');
    return;
  }

  const fieldNames = Object.keys(fields).join(', ');
  if (!confirm(
    `Copy ${Object.keys(fields).length} field(s) to "${targetSong.pack_name}"?\n\n` +
    `Fields: ${fieldNames}`
  )) return;

  try {
    const res = await fetch('/api/patch-metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        song_key: targetSong.song_key,
        source_file: targetSong.source_file,
        fields,
      }),
    });

    const result = await res.json();
    if (!result.ok) throw new Error(result.error);

    const updated = result.patched.length + result.added.length;
    await findDuplicates();
    alert(`Updated ${updated} field(s) successfully.`);
  } catch (err) {
    alert(`Failed to patch metadata: ${err.message}`);
    console.error('Patch error:', err);
  }
}

async function deleteAllDuplicates() {
  if (!state.duplicates.loaded || state.duplicates.groups.length === 0) return;

  const allDeleteKeys = state.duplicates.groups.flatMap(g => g.recommended_delete);
  const totalToFree = state.duplicates.groups.reduce((sum, g) => sum + (g.size_to_free || 0), 0);

  if (!confirm(
    `Delete all ${allDeleteKeys.length} duplicate song(s) across ${state.duplicates.groups.length} group(s)?\n\n` +
    `${formatBytes(totalToFree)} will be freed.\n\n` +
    `The recommended version will be kept for each group.`
  )) return;

  try {
    setStatus('Deleting all duplicates...');
    const res = await fetch('/api/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ song_keys: allDeleteKeys }),
    });

    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Deletion failed');

    await loadCatalog();
    await findDuplicates();
    alert(result.summary);
    setStatus('Deletion complete');
  } catch (err) {
    alert(`Deletion failed: ${err.message}`);
    console.error('Delete all error:', err);
    setStatus('Error');
  }
}

// Pack merging functions
function updatePackList() {
  const packs = [...new Set(state.songs.map(s => s.pack_name))].sort();
  state.packMerge.packList = packs;

  els.packCount.textContent = packs.length;

  // Show warning if >50 packs
  if (packs.length > 50) {
    els.mergeStats.innerHTML =
      `You have <strong>${packs.length}</strong> packs in your catalog. ` +
      `<span style="color: var(--sun);">⚠️ Consider merging to improve loading times!</span>`;
  } else {
    els.mergeStats.innerHTML = `You have <span id="pack-count">${packs.length}</span> packs in your catalog`;
  }

  // Populate selector
  const counts = {};
  state.songs.forEach(s => {
    counts[s.pack_name] = (counts[s.pack_name] || 0) + 1;
  });

  els.mergePackSelector.innerHTML = packs
    .map(pack => `<option value="${escapeHtml(pack)}">${escapeHtml(pack)} (${counts[pack]} songs)</option>`)
    .join('');
}

async function validateMerge() {
  const selectedOptions = Array.from(els.mergePackSelector.selectedOptions);
  const packNames = selectedOptions.map(opt => opt.value);
  const mergedPackName = els.mergedPackName.value.trim();

  if (packNames.length < 2) {
    els.mergeValidationResult.innerHTML =
      '<div class="validation-error">Select at least 2 packs to merge</div>';
    els.executeMerge.disabled = true;
    return;
  }

  if (!mergedPackName) {
    els.mergeValidationResult.innerHTML =
      '<div class="validation-error">Enter a name for the merged pack</div>';
    els.executeMerge.disabled = true;
    return;
  }

  try {
    els.validateMerge.disabled = true;
    els.validateMerge.textContent = "Validating...";

    const res = await fetch("/api/merge/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pack_names: packNames, merged_pack_name: mergedPackName }),
    });

    const validation = await res.json();
    state.packMerge.validation = validation;

    if (validation.valid) {
      const sizeStr = formatBytes(validation.total_size);
      const warnings = validation.warnings.length > 0
        ? `<div class="validation-warnings">${validation.warnings.map(w => `⚠️ ${escapeHtml(w)}`).join('<br>')}</div>`
        : '';

      els.mergeValidationResult.innerHTML = `
        <div class="validation-success">
          ✓ Validation passed
          <div class="validation-details">
            <div>• <strong>${validation.total_songs}</strong> songs from <strong>${packNames.length}</strong> packs</div>
            <div>• Total size: <strong>${sizeStr}</strong></div>
            <div>• Will create: <strong>${escapeHtml(mergedPackName)}</strong></div>
            ${validation.warnings.length > 0 ? '<div>' + warnings + '</div>' : ''}
          </div>
          ${els.deleteSourcePacks.checked
            ? '<div class="validation-warning">⚠️ Source packs will be deleted after merge</div>'
            : '<div class="validation-info">ℹ️ Source packs will be kept</div>'}
        </div>
      `;
      els.executeMerge.disabled = false;
    } else {
      els.mergeValidationResult.innerHTML = `
        <div class="validation-error">
          ✗ Validation failed
          <div class="validation-errors">
            ${validation.errors.map(e => `• ${escapeHtml(e)}`).join('<br>')}
          </div>
        </div>
      `;
      els.executeMerge.disabled = true;
    }
  } catch (err) {
    els.mergeValidationResult.innerHTML =
      `<div class="validation-error">✗ Validation failed: ${escapeHtml(err.message)}</div>`;
    els.executeMerge.disabled = true;
    console.error("Validation error:", err);
  } finally {
    els.validateMerge.disabled = false;
    els.validateMerge.textContent = "Validate";
  }
}

async function executeMerge() {
  const selectedOptions = Array.from(els.mergePackSelector.selectedOptions);
  const packNames = selectedOptions.map(opt => opt.value);
  const mergedPackName = els.mergedPackName.value.trim();
  const deleteSource = els.deleteSourcePacks.checked;

  const confirmMsg = deleteSource
    ? `Merge ${packNames.length} packs into "${mergedPackName}" and DELETE source packs?\n\nThis will:\n• Create merged pack\n• Delete original packs\n• Rebuild catalog\n\nBackups will be created.`
    : `Merge ${packNames.length} packs into "${mergedPackName}"?\n\nOriginal packs will be kept.`;

  if (!confirm(confirmMsg)) {
    return;
  }

  try {
    els.executeMerge.disabled = true;
    els.executeMerge.textContent = "Merging...";
    setStatus("Merging packs...");

    const res = await fetch("/api/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pack_names: packNames,
        merged_pack_name: mergedPackName,
        delete_source_packs: deleteSource
      }),
    });

    const result = await res.json();

    if (!res.ok) {
      throw new Error(result.error || "Merge failed");
    }

    // Reset form and reload catalog
    els.mergedPackName.value = "";
    els.mergeValidationResult.innerHTML = "";
    state.packMerge.validation = null;

    await loadCatalog();
    updatePackList();

    alert(result.summary);
    setStatus("Merge complete");

    // Show details if there were errors
    if (result.merge_result.errors.length > 0) {
      console.warn("Merge had some errors:", result.merge_result.errors);
    }
  } catch (err) {
    alert(`Merge failed: ${err.message}`);
    console.error("Merge error:", err);
  } finally {
    els.executeMerge.disabled = false;
    els.executeMerge.textContent = "Merge Packs";
  }
}

function toggleMergeInfo() {
  const isHidden = els.mergeInfo.style.display === "none";
  els.mergeInfo.style.display = isHidden ? "block" : "none";
  els.toggleMergeInfo.textContent = isHidden ? "ℹ️ Hide Info" : "ℹ️ Info";
}

function resetValidation() {
  state.packMerge.validation = null;
  els.executeMerge.disabled = true;
  els.mergeValidationResult.innerHTML = "";
}

// Event listeners
els.refreshBackups.addEventListener("click", loadBackups);
els.cleanupBackups.addEventListener("click", openCleanupModal);
els.confirmCleanup.addEventListener("click", executeCleanup);
els.cancelCleanup.addEventListener("click", closeCleanupModal);
els.cleanupClose.addEventListener("click", closeCleanupModal);

els.findDuplicates.addEventListener("click", findDuplicates);

els.toggleMergeInfo.addEventListener("click", toggleMergeInfo);
els.validateMerge.addEventListener("click", validateMerge);
els.executeMerge.addEventListener("click", executeMerge);
els.mergedPackName.addEventListener("input", resetValidation);
els.mergePackSelector.addEventListener("change", resetValidation);

// Close cleanup modal when clicking outside
els.cleanupModal.addEventListener("click", (e) => {
  if (e.target === els.cleanupModal) {
    closeCleanupModal();
  }
});

// Close modal with Escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (els.cleanupModal.classList.contains("active")) {
      closeCleanupModal();
    }
  }
});

// Initialize
loadCatalog();
loadBackups();
