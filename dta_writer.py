"""
DTA File Writer - Module for modifying songs.dta files

This module extends the read-only parser in build_catalog.py to support
deletion operations on Rock Band songs.dta files.
"""

from pathlib import Path
from datetime import datetime
import re
import os


def find_song_entry_bounds(text: str, song_key: str) -> tuple[int, int] | None:
    """
    Locate a song entry in DTA text and return its boundaries.

    Args:
        text: The complete songs.dta file content
        song_key: The song_key to find (e.g., "chump", "americanidiot")

    Returns:
        (start_pos, end_pos) tuple of character positions, or None if not found

    Strategy:
        - Search for pattern: newline + '(' + optional whitespace + "'" + song_key + "'"
        - Count parentheses to find the matching closing paren
        - Return positions of the entire entry including outer parens
    """
    # Pattern: newline, opening paren, optional whitespace, quoted song_key
    # The song_key might appear with or without whitespace after opening paren
    pattern = r'\n\(\s*\'?' + re.escape(song_key) + r'\'?'

    match = re.search(pattern, text, re.IGNORECASE)
    if not match:
        return None

    # Start position is the newline before the opening paren
    start_pos = match.start()

    # Find the matching closing paren by counting depth
    paren_depth = 0
    in_string = False
    escape_next = False

    # Start from the opening paren position
    search_start = match.start() + 1  # Skip the newline

    for i in range(search_start, len(text)):
        char = text[i]

        if escape_next:
            escape_next = False
            continue

        if char == '\\':
            escape_next = True
            continue

        if char == '"':
            in_string = not in_string
            continue

        if not in_string:
            if char == '(':
                paren_depth += 1
            elif char == ')':
                paren_depth -= 1
                if paren_depth == 0:
                    # Found matching closing paren
                    # Include the closing paren and any trailing whitespace up to newline
                    end_pos = i + 1
                    # Look ahead for whitespace/newlines to include them
                    while end_pos < len(text) and text[end_pos] in ' \t':
                        end_pos += 1
                    return (start_pos, end_pos)

    # If we got here, no matching paren was found
    return None


def remove_songs_from_dta(dta_path: Path, song_keys: list[str]) -> dict:
    """
    Remove multiple songs from a songs.dta file.

    Args:
        dta_path: Absolute path to the songs.dta file
        song_keys: List of song_key values to remove

    Returns:
        {
            'removed': list[str],      # Successfully removed song_keys
            'not_found': list[str],    # Song keys not found in file
            'backup_path': str         # Path to backup file
        }

    Process:
        1. Read entire DTA file
        2. Create timestamped backup
        3. For each song_key, find and remove its entry
        4. Write modified content back to songs.dta
    """
    if not dta_path.exists():
        raise FileNotFoundError(f"DTA file not found: {dta_path}")

    # Read original content
    try:
        text = dta_path.read_text(encoding='utf-8', errors='ignore')
    except Exception as e:
        raise IOError(f"Failed to read DTA file: {e}")

    # Create backup
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = dta_path.parent / f"{dta_path.name}.backup.{timestamp}"
    try:
        backup_path.write_text(text, encoding='utf-8')
    except Exception as e:
        raise IOError(f"Failed to create backup: {e}")

    # Track results
    removed = []
    not_found = []

    # Remove songs in reverse order of their position to avoid offset issues
    entries_to_remove = []
    for song_key in song_keys:
        bounds = find_song_entry_bounds(text, song_key)
        if bounds:
            entries_to_remove.append((bounds, song_key))
        else:
            not_found.append(song_key)

    # Sort by position (descending) to remove from end to start
    entries_to_remove.sort(key=lambda x: x[0][0], reverse=True)

    # Remove entries
    for (start, end), song_key in entries_to_remove:
        text = text[:start] + text[end:]
        removed.append(song_key)

    # Write modified content
    try:
        dta_path.write_text(text, encoding='utf-8')
    except Exception as e:
        # Try to restore from backup
        try:
            backup_text = backup_path.read_text(encoding='utf-8')
            dta_path.write_text(backup_text, encoding='utf-8')
        except:
            pass
        raise IOError(f"Failed to write modified DTA file: {e}")

    return {
        'removed': removed,
        'not_found': not_found,
        'backup_path': str(backup_path.name)
    }


def delete_song_folders(dev_hdd0_path: Path, songs_by_dta: dict) -> dict:
    """
    Delete physical song folders by renaming them.

    Args:
        dev_hdd0_path: Absolute path to dev_hdd0 directory
        songs_by_dta: Dictionary mapping source_file to list of song dicts
                      {source_file: [{'song_key': str, 'source_file': str}, ...]}

    Returns:
        {
            'deleted': list[str],      # Successfully deleted song_keys
            'not_found': list[str],    # Folders that didn't exist
            'errors': [{'song_key': str, 'error': str}, ...]
        }

    Process:
        For each song, derive folder path from source_file + song_key
        Rename folder: chump/ → chump.deleted_[timestamp]/
    """
    deleted = []
    not_found = []
    errors = []
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    for source_file, songs in songs_by_dta.items():
        # Get the directory containing songs.dta
        # source_file is like "game/BLUS30050/USRDIR/PackName/songs/songs.dta"
        source_path = Path(source_file)
        songs_dir = dev_hdd0_path / source_path.parent

        for song in songs:
            song_key = song['song_key']
            folder_path = songs_dir / song_key

            if not folder_path.exists():
                not_found.append(song_key)
                continue

            if not folder_path.is_dir():
                errors.append({
                    'song_key': song_key,
                    'error': f'Path exists but is not a directory: {folder_path}'
                })
                continue

            # Rename folder
            new_name = f"{song_key}.deleted_{timestamp}"
            new_path = songs_dir / new_name

            try:
                folder_path.rename(new_path)
                deleted.append(song_key)
            except Exception as e:
                errors.append({
                    'song_key': song_key,
                    'error': str(e)
                })

    return {
        'deleted': deleted,
        'not_found': not_found,
        'errors': errors
    }


def validate_deletion_request(catalog: list[dict], song_keys: list[str],
                               dev_hdd0_path: Path) -> dict:
    """
    Validate deletion request before execution.

    Args:
        catalog: List of song dictionaries from catalog.json
        song_keys: List of song_key values to delete
        dev_hdd0_path: Absolute path to dev_hdd0

    Returns:
        {
            'valid': bool,
            'songs_by_dta': {source_file: [song_dict, ...]},
            'errors': list[str]
        }

    Validation checks:
        - All song_keys exist in catalog
        - All DTA files exist and are writable
        - dev_hdd0_path is valid
    """
    errors = []
    songs_by_dta = {}

    # Check dev_hdd0_path
    if not dev_hdd0_path or not dev_hdd0_path.exists():
        errors.append(f"dev_hdd0_path not configured or doesn't exist: {dev_hdd0_path}")
        return {'valid': False, 'songs_by_dta': {}, 'errors': errors}

    # Build catalog lookup by song_key
    catalog_by_key = {song['song_key']: song for song in catalog}

    # Validate each song_key and group by DTA file
    for song_key in song_keys:
        if song_key not in catalog_by_key:
            errors.append(f"Song key '{song_key}' not found in catalog")
            continue

        song = catalog_by_key[song_key]
        source_file = song.get('source_file')

        if not source_file:
            errors.append(f"Song '{song_key}' has no source_file in catalog")
            continue

        # Group songs by their source DTA file
        if source_file not in songs_by_dta:
            songs_by_dta[source_file] = []
        songs_by_dta[source_file].append(song)

    # Validate each DTA file
    for source_file in list(songs_by_dta.keys()):
        dta_path = dev_hdd0_path / source_file

        if not dta_path.exists():
            errors.append(f"DTA file not found: {source_file}")
            del songs_by_dta[source_file]
            continue

        if not dta_path.is_file():
            errors.append(f"DTA path is not a file: {source_file}")
            del songs_by_dta[source_file]
            continue

        # Check if writable
        if not os.access(dta_path, os.W_OK):
            errors.append(f"DTA file is not writable: {source_file}")
            del songs_by_dta[source_file]
            continue

    return {
        'valid': len(errors) == 0,
        'songs_by_dta': songs_by_dta,
        'errors': errors
    }


def scan_backups(dev_hdd0_path: Path) -> dict:
    """
    Scan for all backup files (DTA and folders) in the dev_hdd0 directory.

    Returns:
        {
            'dta_backups': [
                {
                    'path': str,
                    'original': str,
                    'timestamp': str,
                    'size': int,
                    'mtime': float
                },
                ...
            ],
            'folder_backups': [
                {
                    'path': str,
                    'original': str,
                    'timestamp': str,
                    'size': int  # Total size in bytes
                },
                ...
            ]
        }
    """
    dta_backups = []
    folder_backups = []

    # Find DTA backups (songs.dta.backup.YYYYMMDD_HHMMSS)
    for backup_file in dev_hdd0_path.rglob("songs.dta.backup.*"):
        if backup_file.is_file():
            original = backup_file.parent / "songs.dta"
            timestamp = backup_file.name.replace("songs.dta.backup.", "")
            stat = backup_file.stat()
            dta_backups.append({
                'path': str(backup_file.relative_to(dev_hdd0_path)),
                'original': str(original.relative_to(dev_hdd0_path)),
                'timestamp': timestamp,
                'size': stat.st_size,
                'mtime': stat.st_mtime
            })

    # Find deleted folders (songname.deleted_YYYYMMDD_HHMMSS)
    for deleted_folder in dev_hdd0_path.rglob("*.deleted_*"):
        if deleted_folder.is_dir():
            # Extract original name and timestamp
            name_parts = deleted_folder.name.rsplit('.deleted_', 1)
            if len(name_parts) == 2:
                original_name, timestamp = name_parts
                original = deleted_folder.parent / original_name

                # Calculate folder size
                total_size = sum(f.stat().st_size for f in deleted_folder.rglob('*') if f.is_file())

                folder_backups.append({
                    'path': str(deleted_folder.relative_to(dev_hdd0_path)),
                    'original': str(original.relative_to(dev_hdd0_path)),
                    'timestamp': timestamp,
                    'size': total_size
                })

    # Sort by timestamp (newest first)
    dta_backups.sort(key=lambda x: x['timestamp'], reverse=True)
    folder_backups.sort(key=lambda x: x['timestamp'], reverse=True)

    return {
        'dta_backups': dta_backups,
        'folder_backups': folder_backups
    }


def restore_from_backup(dev_hdd0_path: Path, backup_type: str, backup_path: str) -> dict:
    """
    Restore a file or folder from backup.

    Args:
        dev_hdd0_path: Absolute path to dev_hdd0
        backup_type: "dta" or "folder"
        backup_path: Relative path to the backup (from scan_backups result)

    Returns:
        {
            'success': bool,
            'restored': str,  # Path that was restored
            'error': str | None
        }
    """
    backup_full_path = dev_hdd0_path / backup_path

    if not backup_full_path.exists():
        return {
            'success': False,
            'restored': None,
            'error': f'Backup not found: {backup_path}'
        }

    try:
        if backup_type == "dta":
            # Restore DTA file
            original_path = backup_full_path.parent / "songs.dta"

            # Backup current version if it exists
            if original_path.exists():
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                safety_backup = original_path.parent / f"songs.dta.before_restore.{timestamp}"
                original_path.rename(safety_backup)

            # Copy backup to original location
            import shutil
            shutil.copy2(backup_full_path, original_path)

            return {
                'success': True,
                'restored': str(original_path.relative_to(dev_hdd0_path)),
                'error': None
            }

        elif backup_type == "folder":
            # Restore deleted folder
            # Extract original name from backup path
            backup_name = Path(backup_path).name
            name_parts = backup_name.rsplit('.deleted_', 1)
            if len(name_parts) != 2:
                return {
                    'success': False,
                    'restored': None,
                    'error': f'Invalid backup folder name: {backup_name}'
                }

            original_name = name_parts[0]
            original_path = backup_full_path.parent / original_name

            # Check if original already exists
            if original_path.exists():
                return {
                    'success': False,
                    'restored': None,
                    'error': f'Target already exists: {original_path.relative_to(dev_hdd0_path)}'
                }

            # Rename backup to original
            backup_full_path.rename(original_path)

            return {
                'success': True,
                'restored': str(original_path.relative_to(dev_hdd0_path)),
                'error': None
            }

        else:
            return {
                'success': False,
                'restored': None,
                'error': f'Invalid backup type: {backup_type}'
            }

    except Exception as e:
        return {
            'success': False,
            'restored': None,
            'error': str(e)
        }


def cleanup_old_backups(dev_hdd0_path: Path, days_old: int = 30) -> dict:
    """
    Remove backup files older than specified days.

    Args:
        dev_hdd0_path: Absolute path to dev_hdd0
        days_old: Remove backups older than this many days (default: 30)

    Returns:
        {
            'removed_dta': int,
            'removed_folders': int,
            'freed_space': int,  # Bytes
            'errors': list[str]
        }
    """
    import time

    cutoff_time = time.time() - (days_old * 24 * 60 * 60)
    removed_dta = 0
    removed_folders = 0
    freed_space = 0
    errors = []

    # Remove old DTA backups
    for backup_file in dev_hdd0_path.rglob("songs.dta.backup.*"):
        if backup_file.is_file():
            try:
                stat = backup_file.stat()
                if stat.st_mtime < cutoff_time:
                    freed_space += stat.st_size
                    backup_file.unlink()
                    removed_dta += 1
            except Exception as e:
                errors.append(f"Failed to remove {backup_file.name}: {e}")

    # Remove old deleted folders
    for deleted_folder in dev_hdd0_path.rglob("*.deleted_*"):
        if deleted_folder.is_dir():
            try:
                stat = deleted_folder.stat()
                if stat.st_mtime < cutoff_time:
                    # Calculate size before deletion
                    folder_size = sum(f.stat().st_size for f in deleted_folder.rglob('*') if f.is_file())
                    freed_space += folder_size

                    # Remove folder
                    import shutil
                    shutil.rmtree(deleted_folder)
                    removed_folders += 1
            except Exception as e:
                errors.append(f"Failed to remove {deleted_folder.name}: {e}")

    return {
        'removed_dta': removed_dta,
        'removed_folders': removed_folders,
        'freed_space': freed_space,
        'errors': errors
    }


def calculate_deletion_size(dev_hdd0_path: Path, songs_by_dta: dict) -> int:
    """
    Calculate total size of files that will be deleted.

    Args:
        dev_hdd0_path: Absolute path to dev_hdd0
        songs_by_dta: Dictionary from validate_deletion_request

    Returns:
        Total size in bytes
    """
    total_size = 0

    for source_file, songs in songs_by_dta.items():
        source_path = Path(source_file)
        songs_dir = dev_hdd0_path / source_path.parent

        for song in songs:
            song_key = song['song_key']
            folder_path = songs_dir / song_key

            if folder_path.exists() and folder_path.is_dir():
                try:
                    folder_size = sum(f.stat().st_size for f in folder_path.rglob('*') if f.is_file())
                    total_size += folder_size
                except Exception:
                    pass  # Skip if we can't calculate size

    return total_size


def patch_song_metadata(dta_path: Path, song_key: str, fields: dict) -> dict:
    """
    Update or add metadata fields in a songs.dta entry.

    Args:
        dta_path: Path to songs.dta file
        song_key: Song key to locate in the file
        fields: dict of {dta_field_name: new_value}
                e.g., {'album_name': 'Abbey Road', 'year_released': 1969}

    Returns:
        {
            'patched': list[str],   # Fields that were replaced
            'added': list[str],     # Fields that were inserted (didn't exist)
            'backup_path': str|None,
            'error': str|None
        }
    """
    if not dta_path.exists():
        return {'patched': [], 'added': [], 'backup_path': None,
                'error': f'File not found: {dta_path}'}

    try:
        text = dta_path.read_text(encoding='utf-8', errors='ignore')
    except Exception as e:
        return {'patched': [], 'added': [], 'backup_path': None, 'error': str(e)}

    bounds = find_song_entry_bounds(text, song_key)
    if not bounds:
        return {'patched': [], 'added': [], 'backup_path': None,
                'error': f'Song entry not found in DTA: {song_key}'}

    start, end = bounds
    entry_text = text[start:end]

    # Create backup before any writes
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = dta_path.parent / f"{dta_path.name}.backup.{timestamp}"
    try:
        backup_path.write_text(text, encoding='utf-8')
    except Exception as e:
        return {'patched': [], 'added': [], 'backup_path': None,
                'error': f'Failed to create backup: {e}'}

    patched = []
    added = []

    for field_name, new_value in fields.items():
        if new_value is None or new_value == '':
            continue

        # Format the replacement value
        if isinstance(new_value, int):
            formatted_value = str(new_value)
        else:
            escaped = str(new_value).replace('\\', '\\\\').replace('"', '\\"')
            formatted_value = f'"{escaped}"'

        new_field_text = f"('{field_name}' {formatted_value})"

        # Match existing field: handles quoted strings, single-quoted symbols, bare tokens
        # ('fieldname' "quoted value") | ('fieldname' 'symbol') | ('fieldname' token)
        pattern = re.compile(
            r"\(\s*'?" + re.escape(field_name) + r"'?\s+(?:\"[^\"]*\"|'[^']*'|\S+)\)",
            re.IGNORECASE
        )

        new_entry_text, count = pattern.subn(new_field_text, entry_text, count=1)
        if count > 0:
            entry_text = new_entry_text
            patched.append(field_name)
        else:
            # Field doesn't exist — insert before the entry's closing paren
            last_paren = entry_text.rfind(')')
            if last_paren >= 0:
                entry_text = (entry_text[:last_paren]
                              + f"\n   {new_field_text}"
                              + entry_text[last_paren:])
                added.append(field_name)

    new_text = text[:start] + entry_text + text[end:]

    try:
        dta_path.write_text(new_text, encoding='utf-8')
    except Exception as e:
        try:
            backup_path.read_text(encoding='utf-8')
            dta_path.write_text(text, encoding='utf-8')
        except Exception:
            pass
        return {'patched': [], 'added': [], 'backup_path': str(backup_path.name),
                'error': f'Failed to write DTA: {e}'}

    return {
        'patched': patched,
        'added': added,
        'backup_path': str(backup_path.name),
        'error': None
    }


def find_duplicates(catalog: list[dict]) -> dict:
    """
    Group songs by (artist, name, album) to find duplicates.

    Args:
        catalog: List of song dictionaries from catalog.json

    Returns:
        {
            'duplicate_groups': [
                {
                    'artist': str, 'name': str, 'album': str,
                    'songs': [song_dict, ...],  # Sorted by priority
                    'recommended_keep': song_key,
                    'recommended_delete': [song_key, ...],
                },
                ...
            ],
            'total_duplicates': int,
            'total_groups': int,
        }
    """
    from collections import defaultdict

    # Priority mapping (lower number = higher priority)
    PRIORITY = {'disc': 1, 'export': 2, 'dlc': 3, 'custom': 4, 'other': 5}

    # Normalize and group songs by (artist, name, album)
    groups = defaultdict(list)
    for song in catalog:
        artist = (song.get('artist') or '').strip().lower()
        name = (song.get('name') or '').strip().lower()
        album = (song.get('album') or '').strip().lower()

        # Skip songs missing critical fields
        if not artist or not name:
            continue

        key = (artist, name, album)
        groups[key].append(song)

    # Filter to duplicates only (2+ songs per group)
    duplicate_groups = []
    total_duplicates = 0

    for key, songs in groups.items():
        if len(songs) < 2:
            continue

        # Sort by priority (disc first, custom last)
        songs_sorted = sorted(
            songs,
            key=lambda s: (PRIORITY.get(s.get('pack_type'), 99), s.get('song_key', ''))
        )

        duplicate_groups.append({
            'artist': songs_sorted[0].get('artist', ''),
            'name': songs_sorted[0].get('name', ''),
            'album': songs_sorted[0].get('album', ''),
            'songs': songs_sorted,
            'recommended_keep': songs_sorted[0]['song_key'],
            'recommended_delete': [s['song_key'] for s in songs_sorted[1:]],
        })

        total_duplicates += len(songs) - 1  # Don't count the one we keep

    return {
        'duplicate_groups': duplicate_groups,
        'total_duplicates': total_duplicates,
        'total_groups': len(duplicate_groups),
    }


def validate_merge_request(catalog: list[dict], pack_names: list[str],
                           merged_pack_name: str, dev_hdd0_path: Path) -> dict:
    """
    Validate pack merging request.

    Args:
        catalog: List of song dictionaries from catalog.json
        pack_names: List of pack names to merge
        merged_pack_name: Name for new merged pack
        dev_hdd0_path: Absolute path to dev_hdd0

    Returns:
        {
            'valid': bool,
            'pack_info_list': [{'title_id': str, 'pack_name': str, 'source_file': str, 'song_keys': [...]}, ...],
            'total_songs': int,
            'total_size': int,
            'errors': list[str],
            'warnings': list[str]
        }
    """
    errors = []
    warnings = []

    # Validate pack names
    if len(pack_names) < 2:
        errors.append("Must select at least 2 packs to merge")
        return {
            'valid': False,
            'pack_info_list': [],
            'total_songs': 0,
            'total_size': 0,
            'errors': errors,
            'warnings': warnings
        }

    # Validate merged pack name
    if not merged_pack_name or not merged_pack_name.strip():
        errors.append("Merged pack name required")

    if ' ' in merged_pack_name:
        errors.append("Merged pack name cannot contain spaces")

    # Collect pack info
    pack_info_map = {}
    for song in catalog:
        if song['pack_name'] in pack_names:
            pack_name = song['pack_name']
            if pack_name not in pack_info_map:
                pack_info_map[pack_name] = {
                    'title_id': song['title_id'],
                    'pack_name': pack_name,
                    'source_file': song['source_file'],
                    'song_keys': []
                }
            pack_info_map[pack_name]['song_keys'].append(song['song_key'])

    pack_info_list = list(pack_info_map.values())

    # Validate all packs found
    missing_packs = set(pack_names) - set(pack_info_map.keys())
    if missing_packs:
        errors.append(f"Packs not found in catalog: {', '.join(missing_packs)}")

    # Check title_id consistency
    title_ids = set(p['title_id'] for p in pack_info_list)
    if len(title_ids) > 1:
        warnings.append(f"Mixing packs from different title IDs: {', '.join(title_ids)}. Will use {pack_info_list[0]['title_id']}")

    # Check if merged pack already exists
    if pack_info_list:
        title_id = pack_info_list[0]['title_id']
        merged_pack_path = dev_hdd0_path / "game" / title_id / "USRDIR" / merged_pack_name / "songs"
        if merged_pack_path.exists():
            errors.append(f"Merged pack already exists: {merged_pack_name}")

    # Calculate total size
    total_songs = sum(len(p['song_keys']) for p in pack_info_list)
    total_size = 0

    for pack_info in pack_info_list:
        source_file = Path(pack_info['source_file'])
        songs_dir = dev_hdd0_path / source_file.parent

        for song_key in pack_info['song_keys']:
            folder_path = songs_dir / song_key
            if folder_path.exists() and folder_path.is_dir():
                try:
                    folder_size = sum(f.stat().st_size for f in folder_path.rglob('*') if f.is_file())
                    total_size += folder_size
                except:
                    pass

    # Warn about large merges
    if total_songs > 500:
        warnings.append(f"Merging {total_songs} songs - this may take several minutes")

    return {
        'valid': len(errors) == 0,
        'pack_info_list': pack_info_list,
        'total_songs': total_songs,
        'total_size': total_size,
        'errors': errors,
        'warnings': warnings
    }


def format_dta_entries(entries: list) -> str:
    """
    Convert parsed DTA entries (nested lists) back to text format.

    Args:
        entries: List of parsed entries (nested lists/strings/ints)

    Returns:
        Formatted DTA text string maintaining Lisp-like syntax
    """
    def format_value(val, indent=0):
        if isinstance(val, list):
            if not val:
                return "()"

            # Check if it's a song entry (first element is typically a string song_key)
            is_top_level = indent == 0

            if is_top_level:
                # Format top-level song entries with proper indentation
                lines = []
                lines.append("(")

                for i, item in enumerate(val):
                    if i == 0:
                        # Song key on first line after opening paren
                        formatted_item = format_value(item, indent + 3)
                        # Remove quotes if it's a quoted string
                        if formatted_item.startswith("'"):
                            lines[0] = f"(   {formatted_item}"
                        else:
                            lines[0] = f"(   '{formatted_item}'"
                    else:
                        # Other fields indented
                        formatted_item = format_value(item, indent + 3)
                        lines.append("   " + formatted_item)

                lines.append(")")
                return "\n".join(lines)
            else:
                # Format nested lists inline
                formatted_items = [format_value(x, indent) for x in val]
                return "(" + " ".join(formatted_items) + ")"

        elif isinstance(val, str):
            # Quote strings with spaces or special chars
            if ' ' in val or any(c in val for c in ['(', ')', '"', '\\']):
                escaped = val.replace('\\', '\\\\').replace('"', '\\"')
                return f'"{escaped}"'
            # Return symbols as-is if they already have quotes
            if val.startswith("'"):
                return val
            return val

        elif isinstance(val, int):
            return str(val)

        return str(val)

    return "\n".join(format_value(entry) for entry in entries) + "\n"


def create_merged_pack(dev_hdd0_path: Path, pack_info_list: list[dict],
                      merged_pack_name: str, title_id: str = None) -> dict:
    """
    Create merged pack by combining source packs.

    Args:
        dev_hdd0_path: Absolute path to dev_hdd0
        pack_info_list: List of pack info dicts with:
            {
                'title_id': str,
                'pack_name': str,
                'source_file': str,  # Relative path to songs.dta
                'song_keys': list[str]  # Songs to include from this pack
            }
        merged_pack_name: Name for the new merged pack (e.g., "MergedPack01")
        title_id: Target title_id (default: use first pack's title_id)

    Returns:
        {
            'success': bool,
            'merged_pack_path': str,  # Relative path
            'total_songs': int,
            'packs_merged': int,
            'errors': list[str]
        }
    """
    import shutil
    from build_catalog import parse_top_level

    errors = []

    # Use first pack's title_id if not specified
    if not title_id:
        title_id = pack_info_list[0]['title_id']

    # Create merged pack directory
    merged_pack_path = Path("game") / title_id / "USRDIR" / merged_pack_name / "songs"
    full_merged_path = dev_hdd0_path / merged_pack_path

    if full_merged_path.exists():
        return {
            'success': False,
            'merged_pack_path': None,
            'total_songs': 0,
            'packs_merged': 0,
            'errors': [f'Merged pack already exists: {merged_pack_name}']
        }

    # Create directory structure
    try:
        full_merged_path.mkdir(parents=True, exist_ok=False)
    except Exception as e:
        return {
            'success': False,
            'merged_pack_path': None,
            'total_songs': 0,
            'packs_merged': 0,
            'errors': [f'Failed to create pack directory: {e}']
        }

    # Collect all DTA entries and copy song folders
    all_dta_entries = []
    total_songs = 0

    for pack_info in pack_info_list:
        source_file = dev_hdd0_path / pack_info['source_file']
        if not source_file.exists():
            errors.append(f"Source DTA not found: {pack_info['source_file']}")
            continue

        # Read and parse source DTA
        try:
            text = source_file.read_text(encoding='utf-8', errors='ignore')
            entries = parse_top_level(text)
        except Exception as e:
            errors.append(f"Failed to parse {pack_info['source_file']}: {e}")
            continue

        # Extract requested songs
        source_songs_dir = source_file.parent
        song_keys_set = set(pack_info.get('song_keys', []))

        for entry in entries:
            if not isinstance(entry, list) or not entry:
                continue

            song_key = entry[0]
            if not isinstance(song_key, str):
                continue

            # Skip if not in requested list (if specified)
            if song_keys_set and song_key not in song_keys_set:
                continue

            # Add DTA entry
            all_dta_entries.append(entry)

            # Copy song folder
            source_folder = source_songs_dir / song_key
            dest_folder = full_merged_path / song_key

            if source_folder.exists() and source_folder.is_dir():
                try:
                    shutil.copytree(source_folder, dest_folder)
                    total_songs += 1
                except Exception as e:
                    errors.append(f"Failed to copy {song_key}: {e}")
            else:
                errors.append(f"Song folder not found: {song_key} in {pack_info['pack_name']}")

    # Write merged songs.dta
    try:
        merged_dta_text = format_dta_entries(all_dta_entries)
        merged_dta_path = full_merged_path / "songs.dta"
        merged_dta_path.write_text(merged_dta_text, encoding='utf-8')
    except Exception as e:
        # Cleanup on failure
        try:
            shutil.rmtree(full_merged_path)
        except:
            pass
        return {
            'success': False,
            'merged_pack_path': None,
            'total_songs': 0,
            'packs_merged': 0,
            'errors': [f'Failed to write merged DTA: {e}'] + errors
        }

    return {
        'success': True,
        'merged_pack_path': str(merged_pack_path / "songs.dta"),
        'total_songs': total_songs,
        'packs_merged': len(pack_info_list),
        'errors': errors
    }