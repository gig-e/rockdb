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

### Catalog & Configuration
- `GET /api/catalog` - Returns full song catalog
- `GET /api/status` - Returns catalog metadata
- `GET /api/config` - Returns current configuration with validation status
- `POST /api/config` - Saves configuration (requires `dev_hdd0_path` in JSON body)
- `POST /api/validate` - Validates a path without saving (requires `path` in JSON body)
- `POST /api/build` - Triggers catalog rebuild

### Song Deletion
- `POST /api/delete` - Deletes songs (requires `song_keys` array in JSON body)
  - Removes entries from songs.dta files
  - Deletes/renames song folders with timestamp backups
  - Automatically rebuilds catalog
  - Returns deletion results with space freed

### Backup Management
- `GET /api/backups` - Lists all backup files (DTA backups and deleted folders)
- `POST /api/restore` - Restores from backup (requires `backup_type` and `backup_path`)
- `POST /api/cleanup` - Removes old backups (optional `days_old` parameter, default: 30)

### Duplicate Detection
- `GET /api/duplicates` - Detects duplicate songs across packs
  - Groups songs by (artist, name, album) combination
  - Recommends which duplicate to keep based on pack priority (disc > export > dlc > custom)
  - Calculates space savings for removing duplicates
  - Returns duplicate groups with recommended actions

### Pack Merging
- `POST /api/merge/validate` - Validates merge request before execution
  - Requires `pack_names` array and `merged_pack_name` in JSON body
  - Returns validation result with total songs, size, errors, and warnings
- `POST /api/merge` - Merges multiple packs into a single pack
  - Requires `pack_names` array, `merged_pack_name`, and optional `delete_source_packs` boolean
  - Creates new consolidated pack with all songs
  - Optionally deletes source packs after successful merge
  - Automatically rebuilds catalog
  - Returns merge results with total songs and any errors

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

## Song Deletion Feature

The application includes comprehensive song deletion functionality with backup and restore capabilities.

### Implementation Architecture

The deletion feature is based on research of the [Nautilus Quick Pack Editor](https://github.com/trojannemo/Nautilus), which implements a two-phase deletion approach:

1. **DTA Entry Removal**: Removes song definitions from songs.dta files
2. **Physical File Deletion**: Deletes song folders containing audio, charts, and assets

### Key Components

**Backend ([dta_writer.py](dta_writer.py)):**
- `find_song_entry_bounds()` - Locates song entries in DTA files using regex + parenthesis counting
- `remove_songs_from_dta()` - Removes songs and creates timestamped backups (songs.dta.backup.YYYYMMDD_HHMMSS)
- `delete_song_folders()` - Renames folders to .deleted_YYYYMMDD_HHMMSS for recovery
- `scan_backups()` - Lists all backup files and folders with sizes/timestamps
- `restore_from_backup()` - Restores DTA files or folders from backups
- `cleanup_old_backups()` - Removes backups older than specified days
- `calculate_deletion_size()` - Estimates disk space to be freed

**API ([server.py](server.py:217-324)):**
- `/api/delete` endpoint with validation, execution, and catalog rebuild
- `/api/backups` endpoint listing available backups
- `/api/restore` endpoint for backup restoration
- `/api/cleanup` endpoint for old backup removal

**Frontend ([index.html](index.html), [app.js](app.js), [styles.css](styles.css)):**
- Multi-select UI with checkboxes in table rows
- Bulk selection by pack
- Deletion confirmation modal with space calculation
- Backup management interface with one-click restore
- Cleanup tool for managing old backups

### Song Structure & Deletion

**Physical Layout:**
```
dev_hdd0/game/BLUS30050/USRDIR/PackName/songs/
├── songs.dta          # Lisp-like manifest listing all songs
├── chump/             # Song folder (name = song_key)
│   ├── chump.mid.edat # MIDI chart
│   ├── chump.mogg     # Audio stems
│   ├── chump.pan      # Pan data
│   ├── chump.voc      # Vocals
│   └── gen/
│       ├── chump_keep.png_ps3  # Album art
│       ├── chump.milo_ps3      # 3D venue
│       └── chump_weights.bin   # Animations
└── [other song folders...]
```

**DTA Entry Format:**
```lisp
(
   'chump'                    # song_key (first element)
   ('name' "Chump")
   ('artist' "Green Day")
   ('song' ('name' 'songs/chump/chump'))
   ...
)
```

**Key Finding:** The `song_key` field in catalog.json matches both:
- The first element in the DTA entry (`'chump'`)
- The folder name (`chump/`)

Some songs may have numeric prefixes in the DTA file (e.g., `'o943471535_lycanthrope_44'`) but the catalog strips these, storing only `lycanthrope_44` as the song_key.

### Safety Mechanisms

1. **Backups Created:**
   - DTA files: `songs.dta.backup.YYYYMMDD_HHMMSS` (copy before modification)
   - Song folders: `songname.deleted_YYYYMMDD_HHMMSS` (atomic rename operation)

2. **Validation:**
   - Verifies all song_keys exist in catalog
   - Checks DTA files are writable
   - Validates dev_hdd0_path configuration
   - Groups songs by DTA file for efficient batch processing

3. **User Confirmation:**
   - Preview all songs before deletion
   - Display estimated disk space to be freed
   - Explicit warning about permanence
   - Clear explanation of what gets deleted and backed up

4. **Error Resilience:**
   - Partial success acceptable (some songs deleted, others failed)
   - Detailed error reporting per song and per DTA file
   - Catalog rebuilds even if some deletions fail
   - Safety backups created before any modifications

### Recovery Process

**To restore a deleted song:**
1. Use the web UI "Backup Management" section
2. Find the deleted folder or DTA backup
3. Click "Restore" button
4. Catalog automatically rebuilds

**Manual recovery (if needed):**
```bash
# Restore DTA file
mv songs.dta.backup.20260206_193045 songs.dta

# Restore song folder
mv chump.deleted_20260206_193045 chump

# Rebuild catalog via web UI or:
python build_catalog.py
```

## Duplicate Detection Feature

The application includes automatic duplicate detection to identify songs that appear in multiple packs, wasting disk space.

### How It Works

**Detection Algorithm:**
1. Groups all songs by normalized (artist, name, album) tuple
2. Normalizes text by lowercasing and stripping whitespace
3. Identifies groups with 2+ songs as duplicates
4. Ranks duplicates by pack priority: disc > export > dlc > custom > other

**Priority System:**
- **disc** (highest priority): Original disc songs - always keep these
- **export**: Game exports (Rock Band 1, 2, Green Day, etc.)
- **dlc**: Official downloadable content
- **custom**: Community-created customs
- **other** (lowest priority): Uncategorized packs

**Recommendation Engine:**
For each duplicate group, the system automatically:
- Identifies the highest-priority version to keep
- Marks all other versions for deletion
- Calculates disk space that will be freed

### User Interface

**Find Duplicates Button:**
Scans the entire catalog and displays results in grouped format:

```
Artist - Song Title (Album)
3 versions • 45.2 MB to free

[KEEP] Pack: RB3-Disc, Type: disc, Year: 2010
[DELETE] Pack: RB4-DLC-Pack-01, Type: dlc, Year: 2015
[DELETE] Pack: CustomSongs, Type: custom, Year: 2020

[Select 2 Duplicates] [Delete Duplicates]
```

**Actions Available:**
- **Select Duplicates**: Adds marked songs to selection (integrates with existing deletion UI)
- **Delete Duplicates**: Immediately deletes marked versions with confirmation

### Implementation Details

**Backend ([dta_writer.py](dta_writer.py:561-632)):**
```python
def find_duplicates(catalog: list[dict]) -> dict:
    # Groups songs by (artist, name, album)
    # Sorts by priority (disc > export > dlc > custom > other)
    # Returns duplicate groups with recommendations
```

**API Endpoint ([server.py](server.py:140-167)):**
- `GET /api/duplicates`
- Calls `find_duplicates()` with full catalog
- Calculates size savings using existing deletion infrastructure
- Returns structured duplicate groups

**Frontend ([app.js](app.js:703-863), [index.html](index.html:120-135)):**
- Duplicate Detection panel with scan button
- Results display with keep/delete badges
- Integration with existing selection and deletion features

### Edge Cases

**Handled:**
- Empty album fields (treated as valid grouping key)
- Missing artist/name (skipped during grouping)
- Case variations (normalized to lowercase)
- Whitespace differences (stripped)

**Limitations:**
- Different spellings (e.g., "feat." vs "featuring") require manual review
- Live vs studio versions with identical titles may be flagged
- Different album editions (e.g., "Deluxe Edition") treated as different albums

## Pack Merging Feature

The application provides pack consolidation to reduce RPCS3 loading times by combining multiple song packs into fewer, larger packs.

### Why Merge Packs?

**RPCS3 Performance:**
RPCS3 loads each pack separately at startup. Having many individual packs significantly increases loading time:
- 100 individual packs: ~2-3 minutes loading time
- 10 merged packs: ~30-45 seconds loading time

**Recommended Usage:**
Show warning when user has >50 packs, suggesting consolidation.

### How It Works

**Merge Process:**
1. **Validation**: Checks pack names, merged pack name, ensures no conflicts
2. **Directory Creation**: Creates `dev_hdd0/game/{title_id}/USRDIR/{merged_pack_name}/songs/`
3. **DTA Entry Collection**: Parses source songs.dta files, extracts all song entries
4. **Song Folder Copying**: Uses `shutil.copytree()` to copy all song folders (preserves .mogg, .mid.edat, gen/*)
5. **DTA Generation**: Creates merged songs.dta using `format_dta_entries()`
6. **Source Cleanup** (optional): Deletes original packs using existing deletion infrastructure
7. **Catalog Rebuild**: Automatically rebuilds catalog to recognize new pack

**DTA Format Preservation:**
The `format_dta_entries()` function maintains proper Lisp-like syntax:
```lisp
(
   'song_key'
   ('name' "Song Title")
   ('artist' "Artist Name")
   ('album' "Album Name")
   ...
)
```

### User Interface

**Pack Selector:**
- Multi-select dropdown showing all packs with song counts
- Requires Ctrl/Cmd+Click for multiple selection

**Validation:**
Before merging, displays:
- Total songs to be merged
- Total size (disk space required)
- Warnings (mixed title_ids, large merges >500 songs)
- Confirmation of pack name validity

**Options:**
- **Merged pack name**: User-provided name (no spaces allowed)
- **Delete source packs**: Checkbox to remove originals after successful merge

**Workflow:**
1. Select 2+ packs from dropdown
2. Enter merged pack name (e.g., "MergedPack01")
3. Click "Validate" to check configuration
4. Review validation results (songs, size, warnings)
5. Click "Merge Packs" to execute
6. Confirmation dialog with summary
7. Progress indication during merge
8. Catalog automatically rebuilds

### Implementation Details

**Backend ([dta_writer.py](dta_writer.py:635-889)):**

```python
def validate_merge_request(catalog, pack_names, merged_pack_name, dev_hdd0_path):
    # Validates 2+ packs, valid name (no spaces), no conflicts
    # Groups songs by pack, collects pack_info
    # Checks title_id consistency, calculates total size
    # Returns validation result

def format_dta_entries(entries: list) -> str:
    # Converts parsed DTA entries back to Lisp-like text
    # Maintains proper syntax for Rock Band parser

def create_merged_pack(dev_hdd0_path, pack_info_list, merged_pack_name, title_id):
    # Creates directory structure
    # Parses source DTAs, extracts song entries
    # Copies song folders
    # Generates merged songs.dta
    # Returns merge results
```

**API Endpoints ([server.py](server.py:361-454)):**
- `POST /api/merge/validate` - Pre-flight validation
- `POST /api/merge` - Execute merge operation

**Frontend ([app.js](app.js:866-1042), [index.html](index.html:137-186)):**
- Pack Merging panel with info button
- Pack count display with >50 warning
- Multi-select pack selector
- Validation display with color-coded results
- Merge execution with progress feedback

### Safety Mechanisms

**Validation Checks:**
- At least 2 packs required
- Merged pack name must be valid (no spaces)
- Merged pack cannot already exist
- All source packs must exist in catalog

**Space Requirements:**
- Temporarily requires ~2x disk space (source + merged)
- User must delete source packs to reclaim space
- Size calculation shown before merge

**Error Resilience:**
- Missing song folders logged but merge continues
- DTA parsing errors skip problematic pack
- Cleanup on DTA write failure (removes incomplete merged pack)
- Detailed error reporting per pack

### Edge Cases

**Handled:**
- Mixed title_ids: Warns user, uses first pack's title_id
- Large merges (>500 songs): Warning about duration
- Invalid pack names: Rejects names with spaces
- Duplicate pack names: Rejects if merged pack exists

**Limitations:**
- Duplicate song_keys across source packs: Copy fails (logged as error)
- Very large merges (1000+ songs): May be slow, recommend batching
- Cross-title-id merging: May work but not recommended

### Integration with Existing Features

**Deletion Infrastructure Reuse:**
- `validate_deletion_request()` validates source pack cleanup
- `remove_songs_from_dta()` removes entries from source DTAs
- `delete_song_folders()` removes source song folders
- Timestamped backups created for safety

**Catalog Rebuild:**
- Calls `build_catalog()` after merge completes
- New merged pack automatically discovered
- Pack type classification applied (custom, dlc, other)

## Research: Nautilus & Onyx Tools

### Nautilus Quick Pack Editor

**Source:** https://github.com/trojannemo/Nautilus

Nautilus is a C# Windows application for editing Rock Band packs. The Quick Pack Editor module ([QuickPackEditor.cs](https://github.com/trojannemo/Nautilus/blob/master/Nautilus/QuickPackEditor.cs)) provided the foundation for our deletion implementation.

**Key Learnings:**

1. **Two-Phase Deletion:**
   - Remove DTA entries (rewrite songs.dta without removed songs)
   - Delete physical files (song folders identified by InternalName)

2. **DTA Handling:**
   - Preserves original DTA lines exactly (no re-parsing)
   - Uses index-based tracking (0-based indices of songs to remove)
   - Allows restoration before saving (in-memory operation)

3. **File Operations:**
   - **PS3 Mode:** Deletes folders directly (or to Recycle Bin via Windows API)
   - **Xbox Mode:** Extract CON/LIVE package → modify → rebuild → sign
   - Our implementation: Renames folders (atomic, reversible, no Windows API needed)

4. **Data Structure:**
   Each song has:
   - `InternalName` - Folder name (e.g., "americanidiot")
   - `DTALines` - Original entry lines from songs.dta
   - 60+ metadata fields (name, artist, album, year, genre, etc.)

5. **Safety:**
   - Optional backup before modifications
   - Two-step confirmation (select → confirm)
   - Validation before execution

**Differences from RockDB:**
- Nautilus: Pack editor (modifies source files directly)
- RockDB: Database viewer (read-only catalog) + deletion module (write operations)
- Nautilus: Single pack at a time
- RockDB: Scans entire RPCS3 directory tree, supports cross-pack deletion
- Nautilus: Windows Forms GUI
- RockDB: Web-based UI (cross-platform)

### Onyx Music Game Toolkit

**Source:** https://github.com/mtolly/onyx

Onyx is a Haskell-based toolkit for converting and building songs for Rock Band, Guitar Hero, Clone Hero, and similar rhythm games.

**Key Learnings:**

1. **Purpose:**
   - Song conversion between game formats (RB ↔ GH ↔ CH)
   - Pack creation (combine multiple songs into single package)
   - Audio processing (stems, mixing, encryption)
   - NOT designed for song deletion from existing packs

2. **Song Formats Supported:**
   - Rock Band (PS3/Xbox 360): CON/LIVE packages, loose DTA files
   - Guitar Hero: .chart files, .mid files
   - Clone Hero: .chart, .mid, folders
   - MAGMA projects (Rock Band authoring tool)

3. **Command-Line Usage:**
   - Windows version requires Wine on Linux
   - Input: Source song files (various formats)
   - Output: Converted songs or complete packs
   - Configuration via YAML files

4. **Relevance to RockDB:**
   - Could be used for future features (format conversion, pack creation)
   - Not applicable to deletion workflow (Nautilus approach was correct)
   - Windows .exe requires Wine (complicates deployment)

5. **Latest Release:** 20251011 (October 2025)
   - Download: https://github.com/mtolly/onyx/releases
   - Asset pattern: `onyx-command-line-YYYYMMDD-windows-x64.zip`

**Decision:** Used Nautilus approach (direct DTA manipulation) instead of Onyx (conversion tool) for song deletion feature.

### Implementation Notes

The final implementation combines insights from both tools:
- **From Nautilus:** Two-phase deletion, DTA entry removal, backup strategy
- **From Onyx:** Understanding of Rock Band file formats and structure
- **RockDB Innovation:**
  - Web-based UI instead of desktop GUI
  - Atomic rename operations instead of permanent deletion
  - Cross-pack batch processing
  - Integrated backup management with one-click restore
  - Disk space calculation and cleanup tools

All research and implementation details are documented in `/home/gig-e/.claude/plans/iridescent-questing-sky.md`.
