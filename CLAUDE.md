# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Rock Band Song Database is a web application for browsing and searching Rock Band 3 songs from RPCS3 libraries. The application parses `songs.dta` files from the RPCS3 dev_hdd0 directory structure and builds a searchable catalog.

## Development Commands

### Start the Server

```bash
# HTTP (development)
python server.py

# HTTPS with Let's Encrypt (production)
sudo python server.py --https --domain example.com
```

### Build the Catalog

```bash
# Manual catalog build
python build_catalog.py

# Or use the "Update DB" button in the web UI
```

### Test Changes

Open http://127.0.0.1:8000 in a browser to test the web interface. The application has no automated test suite.

## Architecture

### Three-Layer System

1. **Data Layer** (`build_catalog.py`)
   - Parses RPCS3 `songs.dta` files using a custom Lisp-like parser (tokenize → parse → extract)
   - Scans dev_hdd0 directory tree to find all `songs.dta` files
   - Classifies songs by pack type (disc/dlc/export/custom) based on directory structure
   - Outputs `catalog.json` (song data) and `catalog_meta.json` (build metadata)

2. **API Layer** (`server.py`)
   - Serves static files and provides REST API endpoints
   - Handles configuration persistence (`config.json`)
   - Validates dev_hdd0 paths and triggers catalog rebuilds
   - Supports both HTTP and HTTPS with Let's Encrypt certificate auto-detection

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

The README recommends Caddy as a reverse proxy for production deployments (automatic HTTPS, simpler config than nginx). The Python server runs on port 8000, Caddy handles HTTPS and serves static files directly.

See README.md for complete systemd service setup and Caddy/nginx configuration examples.
