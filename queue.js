const els = {
  queueCount: document.getElementById("queue-count"),
  lastRefresh: document.getElementById("last-refresh"),
  now: document.getElementById("queue-now"),
  upnext: document.getElementById("queue-upnext"),
};

let entries = [];

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function timeAgo(ts) {
  const seconds = Math.floor(Date.now() / 1000 - ts);
  if (seconds < 30) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function render() {
  els.queueCount.textContent = `${entries.length} in queue`;

  if (entries.length === 0) {
    els.now.innerHTML = `<div class="queue-display-empty">No requests yet</div>`;
    els.upnext.innerHTML = "";
    return;
  }

  const [now, ...rest] = entries;
  els.now.innerHTML = `
    <div class="queue-display-label">Now playing</div>
    <div class="queue-display-title">${escapeHtml(now.name)}</div>
    <div class="queue-display-artist">${escapeHtml(now.artist)}</div>
    <div class="queue-display-meta">
      Requested by <strong>${escapeHtml(now.requested_by)}</strong>
      <span class="queue-display-time">${timeAgo(now.requested_at)}</span>
    </div>
  `;

  els.upnext.innerHTML = rest
    .map((e, i) => `
      <div class="queue-upnext-item">
        <div class="queue-upnext-pos">${i + 2}</div>
        <div class="queue-upnext-song">
          <div class="queue-upnext-title">${escapeHtml(e.name)}</div>
          <div class="queue-upnext-artist">${escapeHtml(e.artist)}</div>
        </div>
        <div class="queue-upnext-who">
          <div>${escapeHtml(e.requested_by)}</div>
          <div class="queue-upnext-time">${timeAgo(e.requested_at)}</div>
        </div>
      </div>
    `)
    .join("");
}

async function load() {
  try {
    const res = await fetch("/api/queue", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    entries = data.entries || [];
    render();
    els.lastRefresh.textContent = `Updated ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    els.lastRefresh.textContent = "Disconnected";
  }
}

load();
setInterval(load, 10_000);
setInterval(render, 30_000);
