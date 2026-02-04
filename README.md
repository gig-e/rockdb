# Rock Band Song Database

A web app for browsing and searching Rock Band 3 songs from your RPCS3 library.

## Quick Start

```bash
python server.py
# Open http://127.0.0.1:8000 in your browser
```

On first run, the app will guide you through configuration:
1. Settings dialog opens automatically
2. Suggests the default dev_hdd0 location
3. Validates the path and counts song files
4. Builds the catalog after confirmation

## Features

- **Settings interface** - Configure dev_hdd0 directory with real-time validation
- **Portable** - Move the app anywhere and configure via web UI or config.json
- Search by artist, title, album, or pack name
- Filter by artist, title, type, pack, genre, and decade
- Eurovision song highlighting
- Mobile-friendly card layout (breakpoint: 768px)
- Dark mode support (follows system preference)
- Live catalog rebuilding from the web UI

## Files

| File | Description |
|------|-------------|
| `server.py` | HTTP/HTTPS server with API endpoints |
| `build_catalog.py` | Parses `songs.dta` files and builds catalog |
| `index.html` | Main web interface |
| `app.js` | Frontend filtering and rendering |
| `styles.css` | Styling with mobile and dark mode support |
| `config.json` | Configuration (dev_hdd0 path) |
| `catalog.json` | Generated song database |
| `catalog_meta.json` | Build metadata |

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

### Web Interface

Click the ⚙️ Settings button to configure the dev_hdd0 directory path. The interface validates paths in real-time and shows song file counts.

### Manual Configuration

Edit `config.json`:

```json
{
  "dev_hdd0_path": "/path/to/your/rpcs3/dev_hdd0"
}
```

Then rebuild:

```bash
python build_catalog.py
```

Or click "Update DB" in the web interface.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Web interface |
| `/api/status` | GET | Catalog metadata |
| `/api/catalog` | GET | Full song catalog |
| `/api/config` | GET | Current configuration with validation status |
| `/api/config` | POST | Save configuration (JSON: `{"dev_hdd0_path": "..."}`) |
| `/api/validate` | POST | Validate path without saving (JSON: `{"path": "..."}`) |
| `/api/build` | POST | Rebuild catalog from songs.dta files |

## Song Classification

Songs are categorized by directory location within dev_hdd0:

- **disc** - BASE pack (songs.dta directly under USRDIR)
- **dlc** - Official DLC packs (contains "dlc", "pack", or "rb4-to-rb2")
- **export** - Exported songs from other games (contains "export")
- **custom** - Custom songs (contains "custom")
- **other** - Everything else
