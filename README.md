# Rock Band Song Database

A web app for browsing and searching Rock Band 3 songs from your RPCS3 library.

## Quick Start

```bash
python server.py
# Open http://127.0.0.1:8000 in your browser
```

On first run, a setup dialog opens automatically, suggests the default `dev_hdd0` location, validates it, and builds the catalog once you confirm.

## Features

- Search by artist, title, album, or pack name
- Filter chips for artist, title, type, pack, genre, decade, and Eurovision — popover on desktop, bottom sheet on mobile
- Karaoke-style request queue — anyone can add songs, the next one up shows as **NOW**
- Admin page (`/admin.html`) for managing the queue, deleting songs, merging packs, and finding duplicates
- Automatic backups on delete (DTA files are copied, song folders are renamed with a timestamp) and one-click restore
- Duplicate detection across packs with priority-based recommendations (disc > export > dlc > custom)
- Mobile card layout (breakpoint: 768px) and dark mode following system preference
- Portable — move the folder anywhere, point `config.json` at your `dev_hdd0`, done

## Files

| File | Description |
|------|-------------|
| `server.py` | HTTP server and API endpoints |
| `build_catalog.py` | Parses `songs.dta` files and builds the catalog |
| `dta_writer.py` | Deletion, backup/restore, duplicate detection, and pack merging |
| `index.html` / `app.js` | Main browser UI (read-only for guests) |
| `admin.html` / `admin.js` | Admin panel — queue management, deletes, merges, backups |
| `styles.css` | Styling, mobile layout, dark mode |
| `config.json` | Your `dev_hdd0` path |
| `catalog.json` | Generated song database |
| `catalog_meta.json` | Build metadata |
| `queue.json` | Persisted request queue |

## Development

### HTTP Server

```bash
python server.py
# Serves on http://0.0.0.0:8000
```

The server binds to all network interfaces by default. For production deployments with HTTPS, use a reverse proxy (see below).

### Command Line Options

| Option | Description |
|--------|-------------|
| `--host HOST` | Bind address (default: 0.0.0.0) |
| `--port PORT` | Port number (default: 8000) |

Environment variables (`CATALOG_HOST`, `CATALOG_PORT`) can override defaults.

**Examples:**

```bash
# Bind to localhost only
python server.py --host 127.0.0.1

# Custom port
python server.py --port 8080

# Both
python server.py --host 127.0.0.1 --port 8080
```

## Production Deployment

**⚠️ IMPORTANT:** Always use a reverse proxy (Caddy or nginx) for production deployments. The Python server only provides HTTP - the reverse proxy handles HTTPS, security hardening, rate limiting, and efficient static file serving.

### Quick Setup (Interactive)

Run the interactive setup script:

```bash
./setup.sh
```

The script will prompt you to choose:
1. **Standalone** - Python server only (no HTTPS)
2. **Own proxy** - Setup Python service, you configure your reverse proxy
3. **Full Caddy + Let's Encrypt** - Complete setup with Caddy and Namecheap DNS validation

The script automatically handles all configuration including the systemd ProtectHome override when needed.

### Manual Setup

For manual configuration or other reverse proxies, see the sections below.

### Installation Location

**For production deployments, choose your installation location carefully:**

- **`/opt/rockdb`** or **`/var/www/rockdb`** (Recommended)
  - No additional systemd configuration required
  - Caddy's default security settings work out of the box
  - Better security posture with systemd sandboxing intact

- **`/home/username/rockdb`** (Requires extra configuration)
  - Caddy's `ProtectHome=true` security feature blocks access by default
  - Requires systemd override to disable `ProtectHome` (see below)
  - Less secure - removes systemd's home directory protection

**If using a home directory location**, you must create a systemd override:

```bash
sudo mkdir -p /etc/systemd/system/caddy.service.d/
echo -e '[Service]\nProtectHome=false' | sudo tee /etc/systemd/system/caddy.service.d/override.conf
sudo systemctl daemon-reload
sudo systemctl restart caddy
```

And ensure the parent directory is readable:

```bash
chmod 755 /home/username  # Replace with your actual home directory
```

### Option 1: Caddy Reverse Proxy (Recommended)

Caddy provides automatic HTTPS with zero certificate configuration, plus security hardening, rate limiting, efficient static file serving, and built-in protection against common exploits.

#### Standard Setup (HTTP-01 Challenge)

**1. Install Caddy**

```bash
sudo pacman -S caddy
```

**2. Create `/etc/caddy/Caddyfile`**

```caddyfile
songdb.example.com {
    root * /opt/rockdb
    file_server

    # Proxy API requests to Python server
    reverse_proxy /api/* 127.0.0.1:8000

    # Cache static assets
    @static path *.css *.js *.json
    header @static Cache-Control "public, max-age=3600"

    # Gzip compression
    encode gzip
}
```

> **Note:** Using `/opt/rockdb` avoids needing to modify Caddy's systemd security settings. If you must use a path in `/home`, see the "Installation Location" section above.

Caddy automatically obtains and renews Let's Encrypt certificates, redirects HTTP → HTTPS, and enables HTTP/2 and HTTP/3.

**3. Create `/etc/systemd/system/rockdb.service`**

```ini
[Unit]
Description=Rock Band Song Database API
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/opt/rockdb
ExecStart=/usr/bin/python3 server.py --host 127.0.0.1 --port 8000
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Replace `your-username` with your actual username. If using a different path, update `WorkingDirectory` accordingly.

**4. Start Services**

```bash
sudo systemctl enable --now caddy
sudo systemctl enable --now rockdb
```

#### DNS Challenge Setup (Advanced)

<details>
<summary>Use DNS validation when port 80/443 are blocked or for wildcard certificates</summary>

DNS validation (DNS-01 challenge) allows Let's Encrypt to verify domain ownership via DNS records instead of HTTP. This is useful when:
- Firewall blocks ports 80/443
- Server is behind NAT without port forwarding
- You need wildcard certificates (*.example.com)

**Automated Setup**

Run the interactive setup script:

```bash
./setup.sh
# Select option 3: Full setup with Caddy + Let's Encrypt DNS (Namecheap)
```

The script will prompt for all necessary values including:
- Domain name
- Let's Encrypt email
- Namecheap API credentials

It automatically detects if rockdb is in `/home` and applies the necessary systemd override.

**For other DNS providers:** The setup script uses Namecheap. For other providers (Cloudflare, Route53, GoDaddy, etc.), you can fork the script and replace `github.com/caddy-dns/namecheap` with your provider's module. Find available modules at [caddy-dns](https://github.com/caddy-dns).

**Prerequisites:**
- Whitelist your server's IP in your DNS provider's API settings
- Ensure DNS A record points to this server

</details>

### Option 2: nginx Reverse Proxy

<details>
<summary>Click to expand nginx setup</summary>

**Install nginx and certbot**

```bash
sudo pacman -S nginx certbot certbot-nginx
```

**Create `/etc/nginx/sites-available/rockdb.conf`**

```nginx
server {
    listen 80;
    server_name songdb.example.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name songdb.example.com;

    ssl_certificate /etc/letsencrypt/live/songdb.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/songdb.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    add_header Strict-Transport-Security "max-age=63072000" always;

    location / {
        root /opt/rockdb;
        index index.html;
        try_files $uri $uri/ =404;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

**Enable and configure**

```bash
sudo ln -s /etc/nginx/sites-available/rockdb.conf /etc/nginx/sites-enabled/
sudo certbot --nginx -d songdb.example.com
sudo systemctl restart nginx
```

Use the same systemd service as shown in the Caddy section.

</details>

### Why Caddy?

| | nginx | Caddy |
|---|---|---|
| **Config** | 40+ lines | 10 lines |
| **HTTPS setup** | Install certbot, configure certs | Automatic |
| **Cert renewal** | Separate timer/cron | Built-in |
| **HTTP/3** | Requires extra modules | Built-in |

## Configuration

On first run, the app prompts for your `dev_hdd0` path, validates it, and builds the catalog. After that, rebuild any time from the admin page, or manually:

```bash
python build_catalog.py
```

Or edit `config.json` directly:

```json
{
  "dev_hdd0_path": "/path/to/your/rpcs3/dev_hdd0"
}
```

## API Endpoints

**Catalog and configuration**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | Catalog metadata |
| `/api/catalog` | GET | Full song catalog |
| `/api/config` | GET / POST | Read or save the `dev_hdd0` path |
| `/api/validate` | POST | Check a path without saving it |
| `/api/build` | POST | Rebuild catalog from `songs.dta` files |

**Request queue**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/queue` | GET | Current queue |
| `/api/queue` | POST | Add a song (`song_key`, `requested_by`) |
| `/api/queue/remove` | POST | Remove one entry by id |
| `/api/queue/clear` | POST | Empty the queue |

**Admin operations**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/delete` | POST | Delete songs by `song_keys` — DTA rewrite + folder rename backup |
| `/api/delete-dropped` | POST | Clean up files for songs dropped during build-time dedup |
| `/api/backups` | GET | List DTA backups and renamed folders |
| `/api/restore` | POST | Restore a backup |
| `/api/cleanup` | POST | Remove backups older than N days (default 30) |
| `/api/duplicates` | GET | Find duplicates across packs with keep/delete recommendations |
| `/api/merge/validate` | POST | Pre-flight check for a pack merge |
| `/api/merge` | POST | Merge multiple packs into one |

## Song Classification

Songs are categorized by directory location within dev_hdd0:

- **disc** - BASE pack (songs.dta directly under USRDIR)
- **dlc** - Official DLC packs (contains "dlc", "pack", or "rb4-to-rb2")
- **export** - Exported songs from other games (contains "export")
- **custom** - Custom songs (contains "custom")
- **other** - Everything else
