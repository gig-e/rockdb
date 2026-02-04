# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Important Guidelines

**CRITICAL:** Always verify commands, configurations, and syntax against official documentation before suggesting them. Do not hallucinate features, directives, or capabilities that don't exist. When uncertain about:
- Command syntax or flags
- Configuration file directives
- Tool capabilities or features
- API endpoints or parameters

You MUST either:
1. Verify against known documentation
2. Explicitly state the uncertainty and recommend the user verify
3. Use available tools to check validity (e.g., `--help`, `man` pages, test runs)

Never assume a feature exists without verification. It's better to take extra time to validate than to provide incorrect information.

## Overview

Rock Band Song Database is a web application for browsing and searching Rock Band 3 songs from RPCS3 libraries. The application parses `songs.dta` files from the RPCS3 dev_hdd0 directory structure and builds a searchable catalog.

## Development Commands

### Start the Server

```bash
python server.py
# Serves HTTP on 0.0.0.0:8000

# Custom host/port
python server.py --host 127.0.0.1 --port 8080
```

### Quick Production Setup

For production deployment, use the interactive setup script:

```bash
./setup.sh
```

This script offers three deployment modes:
1. Standalone (Python server only)
2. Own proxy (sets up Python service, user configures reverse proxy)
3. Full Caddy + Let's Encrypt DNS with Namecheap

The script automatically handles the ProtectHome override when deploying to /home directories.

### Build the Catalog

```bash
# Manual catalog build
python build_catalog.py

# Or use the "Update DB" button in the web UI
```

### Test Changes

Open http://0.0.0.0:8000 (or http://127.0.0.1:8000) in a browser to test the web interface. The application has no automated test suite.

## Architecture

### Three-Layer System

1. **Data Layer** (`build_catalog.py`)
   - Parses RPCS3 `songs.dta` files using a custom Lisp-like parser (tokenize → parse → extract)
   - Scans dev_hdd0 directory tree to find all `songs.dta` files
   - Classifies songs by pack type (disc/dlc/export/custom) based on directory structure
   - Outputs `catalog.json` (song data) and `catalog_meta.json` (build metadata)

2. **API Layer** (`server.py`)
   - Serves static files and provides REST API endpoints (HTTP only)
   - Handles configuration persistence (`config.json`)
   - Validates dev_hdd0 paths and triggers catalog rebuilds
   - Production deployments use a reverse proxy (Caddy/nginx) for HTTPS

3. **Frontend Layer** (`index.html`, `app.js`, `styles.css`)
   - Client-side filtering with no server-side pagination
   - Dual view: table for desktop, card layout for mobile (breakpoint: 768px)
   - First-run setup flow with path validation UI

### Song Classification Logic

Songs are categorized based on their directory location within dev_hdd0:

- **Pack derivation** (server.py:146-162): Extracts title_id and pack_name from file path
  - Path structure: `dev_hdd0/game/{title_id}/USRDIR/{pack_name}/songs.dta`
  - BASE pack = songs.dta directly under USRDIR

- **Type classification** (server.py:133-143):
  - `disc`: BASE pack
  - `custom`: Contains "custom" in name
  - `export`: Contains "export" in name
  - `dlc`: Contains "dlc", "pack", or "rb4-to-rb2" in name
  - `other`: Everything else

### songs.dta Parser

The `build_catalog.py` file implements a custom parser for Rock Band's Lisp-like data format:

1. **Tokenization** (build_catalog.py:35-70): Handles parentheses, quoted strings, escape sequences, and single-quoted symbols
2. **Parsing** (build_catalog.py:73-96): Converts tokens to nested list structures
3. **Field extraction** (build_catalog.py:112-131): Retrieves values from parsed entries using helper functions

Songs must have either `name` or `artist` to be included in the catalog.

## Key Configuration Files

- **config.json**: Stores dev_hdd0_path (absolute path to RPCS3 directory)
- **catalog.json**: Generated song database (array of song objects)
- **catalog_meta.json**: Build metadata (timestamp, source files, song counts)

The application is portable - it can be moved anywhere as long as config.json points to a valid dev_hdd0 path.

## API Endpoints

- `GET /api/catalog` - Returns full song catalog
- `GET /api/status` - Returns catalog metadata
- `GET /api/config` - Returns current configuration with validation status
- `POST /api/config` - Saves configuration (requires `dev_hdd0_path` in JSON body)
- `POST /api/validate` - Validates a path without saving (requires `path` in JSON body)
- `POST /api/build` - Triggers catalog rebuild

## Production Deployment

The Python server only provides HTTP. Production deployments MUST use a reverse proxy (Caddy or nginx) for:
- HTTPS/TLS encryption
- Security hardening and rate limiting
- Efficient static file serving
- Attack mitigation

The recommended setup: Python server on localhost:8000 (HTTP), Caddy/nginx handles public HTTPS traffic and proxies API requests.

### Important: Installation Location and Caddy Permissions

**Caddy's systemd service includes `ProtectHome=true`** which prevents access to `/home` directories for security. This causes HTTP 403 errors when serving files from user home directories.

**Solutions:**
1. **Recommended:** Deploy to `/opt/rockdb` or `/var/www/rockdb` - no configuration changes needed
2. **If using `/home`:** Create systemd override to disable ProtectHome:
   ```bash
   sudo mkdir -p /etc/systemd/system/caddy.service.d/
   echo -e '[Service]\nProtectHome=false' | sudo tee /etc/systemd/system/caddy.service.d/override.conf
   sudo systemctl daemon-reload && sudo systemctl restart caddy
   chmod 755 /home/username  # Make parent directory readable
   ```

The setup.sh script automatically handles this based on installation path.

See README.md for complete systemd service setup and Caddy/nginx configuration examples.
