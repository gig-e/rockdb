# Rock Band Song Database

A web app for browsing and searching Rock Band 3 songs from your RPCS3 library.

## Quick Start

```bash
# Start the server
python server.py

# Open http://127.0.0.1:8000 in your browser
```

On first run, the app will:
1. Open the settings dialog automatically
2. Suggest the default dev_hdd0 location
3. Validate the path and count song files
4. Build the catalog after you confirm

You can also build the catalog manually:

```bash
python build_catalog.py
```

## Features

- **Settings interface** - Configure dev_hdd0 directory location with validation
- **Portable** - Move the app anywhere and configure the song directory path
- **First-run setup** - Auto-detects and suggests default locations
- Search by artist, title, album, or pack name
- Filter by artist, title, type, pack, genre, and decade
- Eurovision song highlighting
- Mobile-friendly card layout
- Dark mode support (follows system preference)
- Live catalog rebuilding from the web UI

## Files

| File | Description |
|------|-------------|
| `server.py` | HTTP/HTTPS server with API endpoints |
| `build_catalog.py` | Parses `songs.dta` files and builds `catalog.json` |
| `index.html` | Main web interface |
| `app.js` | Frontend filtering and rendering |
| `styles.css` | Styling with mobile and dark mode support |
| `config.json` | Configuration file (dev_hdd0 path) |
| `catalog.json` | Generated song database |
| `catalog_meta.json` | Build metadata (timestamp, sources) |

## Server Usage

### HTTP (Development)

```bash
python server.py
# Serves on http://127.0.0.1:8000
```

### HTTPS with Let's Encrypt

```bash
# Auto-detect certificate from /etc/letsencrypt/live/
sudo python server.py --https

# Specify domain
sudo python server.py --https --domain example.com

# Custom certificate paths
sudo python server.py --https \
  --cert /etc/letsencrypt/live/example.com/fullchain.pem \
  --key /etc/letsencrypt/live/example.com/privkey.pem
```

### Command Line Options

| Option | Description |
|--------|-------------|
| `--https` | Enable HTTPS (default port 443) |
| `--host HOST` | Bind address (default: 127.0.0.1, or 0.0.0.0 with --https) |
| `--port PORT` | Port number (default: 8000, or 443 with --https) |
| `--cert PATH` | Path to SSL certificate (fullchain.pem) |
| `--key PATH` | Path to SSL private key (privkey.pem) |
| `--domain NAME` | Let's Encrypt domain for auto-detection |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `CATALOG_HOST` | Bind address |
| `CATALOG_PORT` | Port number |
| `SSL_CERT` | Path to certificate file |
| `SSL_KEY` | Path to private key file |
| `SSL_DOMAIN` | Domain name for Let's Encrypt lookup |

### Running as a Service

Create `/etc/systemd/system/rockdb.service`:

```ini
[Unit]
Description=Rock Band Song Database
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/path/to/rockdb
ExecStart=/usr/bin/python3 server.py --https --domain example.com
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Replace `/path/to/rockdb` with your actual directory path.

Then enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable rockdb
sudo systemctl start rockdb
```

## Production Setup with Caddy (Recommended)

Caddy is the simplest option - automatic HTTPS with zero certificate configuration.

### 1. Install Caddy

```bash
sudo pacman -S caddy
```

### 2. Create Caddyfile

Create `/etc/caddy/Caddyfile`:

```caddyfile
songdb.example.com {
    root * /path/to/rockdb
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

Replace `/path/to/rockdb` with your actual directory path.

That's it. Caddy automatically:
- Obtains Let's Encrypt certificates
- Renews certificates before expiry
- Redirects HTTP → HTTPS
- Enables HTTP/2 and HTTP/3

### 3. Start Caddy

```bash
sudo systemctl enable caddy
sudo systemctl start caddy
```

### 4. Run Python server (API only)

Create `/etc/systemd/system/rockdb.service`:

```ini
[Unit]
Description=Rock Band Song Database API
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/path/to/rockdb
ExecStart=/usr/bin/python3 server.py --host 127.0.0.1 --port 8000
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Replace `/path/to/rockdb` and `your-username` with your actual values.

```bash
sudo systemctl enable rockdb
sudo systemctl start rockdb
```

### Why Caddy over nginx?

| | nginx | Caddy |
|---|---|---|
| **Config** | 40+ lines | 10 lines |
| **HTTPS setup** | Install certbot, configure certs | Automatic |
| **Cert renewal** | Separate timer/cron | Built-in |
| **HTTP/3** | Requires extra modules | Built-in |

---

<details>
<summary>Alternative: nginx setup (click to expand)</summary>

### nginx + certbot

```bash
sudo pacman -S nginx certbot certbot-nginx
```

Create `/etc/nginx/sites-available/rockdb.conf`:

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
        root /path/to/rockdb;
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

```bash
sudo ln -s /etc/nginx/sites-available/rockdb.conf /etc/nginx/sites-enabled/
sudo certbot --nginx -d songdb.example.com
sudo systemctl restart nginx
```

</details>

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Web interface |
| `/api/status` | GET | Catalog metadata |
| `/api/catalog` | GET | Full song catalog |
| `/api/config` | GET | Current configuration and validation status |
| `/api/config` | POST | Save configuration (requires `dev_hdd0_path` in JSON body) |
| `/api/validate` | POST | Validate a path without saving (requires `path` in JSON body) |
| `/api/build` | POST | Rebuild catalog from songs.dta files |

## Configuration

### Settings Interface

Click the ⚙️ Settings button in the web interface to:
- Configure the dev_hdd0 directory path
- Validate that the path contains songs.dta files
- See how many song files were found
- Save and rebuild the catalog

### Manual Configuration

Edit `config.json`:

```json
{
  "dev_hdd0_path": "/path/to/your/rpcs3/dev_hdd0"
}
```

Then rebuild the catalog:

```bash
python build_catalog.py
```

### Moving the App

The app is fully portable. You can move the `rockdb` directory anywhere:

1. Move the directory to your desired location
2. Update `config.json` with the absolute path to your dev_hdd0 directory
3. Start the server from the new location

The default dev_hdd0 path is `../dev_hdd0` relative to the script location.

## Building the Catalog

The catalog is built by scanning all `songs.dta` files in your configured dev_hdd0 directory:

```bash
python build_catalog.py
```

Or click "Update DB" in the web interface.

### Song Sources

Songs are categorized by type:
- **disc** - Base game songs
- **dlc** - Official DLC packs
- **export** - Exported songs from other games
- **custom** - Custom songs

## Mobile Support

On screens under 768px, the table view switches to a card-based layout with larger touch targets. The interface adapts to both light and dark system themes.
