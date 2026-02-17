#!/usr/bin/env python3
"""
RPCS3 Rock Band Song Catalog Server

Serves the song database web app. Use a reverse proxy (Caddy/nginx) for HTTPS.

Usage:
  python server.py                          # HTTP on 0.0.0.0:8000
  python server.py --host 127.0.0.1         # Bind to localhost only
  python server.py --port 8080              # Custom port

Environment variables:
  CATALOG_HOST      Bind address (default: 0.0.0.0)
  CATALOG_PORT      Port number (default: 8000)
"""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse
import json
import os
import sys

from build_catalog import build_catalog
from dta_writer import (
    validate_deletion_request, remove_songs_from_dta, delete_song_folders,
    scan_backups, restore_from_backup, cleanup_old_backups, calculate_deletion_size,
    find_duplicates,
    create_merged_pack, validate_merge_request
)

ROOT = Path(__file__).resolve().parent
CATALOG_PATH = ROOT / "catalog.json"
META_PATH = ROOT / "catalog_meta.json"
CONFIG_PATH = ROOT / "config.json"


def read_json(path: Path):
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def write_json(path: Path, data: dict):
    """Write JSON data to file."""
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def get_default_dev_hdd0_path():
    """Get the default dev_hdd0 path based on script location."""
    # Assume default is ../dev_hdd0 relative to script
    default_path = ROOT.parent / "dev_hdd0"
    return str(default_path)


def validate_dev_hdd0_path(path_str: str):
    """Validate that the given path contains songs.dta files."""
    try:
        path = Path(path_str).expanduser().resolve()
        if not path.exists():
            return False, "Path does not exist", 0
        if not path.is_dir():
            return False, "Path is not a directory", 0

        # Search for songs.dta files
        song_files = list(path.glob("**/songs.dta"))
        if not song_files:
            return False, "No songs.dta files found in directory", 0

        return True, None, len(song_files)
    except Exception as e:
        return False, str(e), 0


def load_config():
    """Load configuration with defaults and validation."""
    config = read_json(CONFIG_PATH)

    if not config or not config.get("dev_hdd0_path"):
        # First run or missing config
        suggested = get_default_dev_hdd0_path()
        valid, error, count = validate_dev_hdd0_path(suggested)

        return {
            "dev_hdd0_path": config.get("dev_hdd0_path", ""),
            "suggested_path": suggested,
            "path_valid": False,
        }

    # Validate configured path
    path = config["dev_hdd0_path"]
    valid, error, count = validate_dev_hdd0_path(path)

    return {
        "dev_hdd0_path": path,
        "path_valid": valid,
        "validation_error": error,
        "song_files": count if valid else 0,
    }


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format, *args):
        return

    def _send_json(self, payload, status=200):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/api/status":
            self._send_json(read_json(META_PATH))
            return
        if self.path == "/api/catalog":
            if not CATALOG_PATH.exists():
                self._send_json({"error": "catalog.json not found"}, status=404)
                return
            self._send_json(read_json(CATALOG_PATH))
            return
        if self.path == "/api/config":
            self._send_json(load_config())
            return
        if self.path == "/api/backups":
            try:
                config = read_json(CONFIG_PATH)
                dev_hdd0_path = Path(config.get("dev_hdd0_path", "")).expanduser().resolve()
                backups = scan_backups(dev_hdd0_path)
                self._send_json(backups)
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=500)
            return
        if self.path == "/api/duplicates":
            try:
                catalog = read_json(CATALOG_PATH)
                if not catalog:
                    self._send_json({"error": "Catalog not found"}, status=404)
                    return

                config = read_json(CONFIG_PATH)
                dev_hdd0_path = Path(config.get("dev_hdd0_path", "")).expanduser().resolve()

                result = find_duplicates(catalog)

                # Calculate size savings for each duplicate group
                for group in result['duplicate_groups']:
                    delete_keys = group['recommended_delete']
                    validation = validate_deletion_request(catalog, delete_keys, dev_hdd0_path)

                    if validation['valid']:
                        size = calculate_deletion_size(dev_hdd0_path, validation['songs_by_dta'])
                        group['size_to_free'] = size
                    else:
                        group['size_to_free'] = 0

                self._send_json(result)
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=500)
            return
        super().do_GET()

    def _read_body(self):
        """Read and parse JSON body from POST request."""
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            if content_length == 0:
                return {}
            body = self.rfile.read(content_length)
            return json.loads(body.decode("utf-8"))
        except (json.JSONDecodeError, ValueError):
            return {}

    def do_POST(self):
        if self.path == "/api/build":
            try:
                build_catalog()
                meta = read_json(META_PATH)
                total = meta.get("total_songs", 0)
                sources = meta.get("sources", [])
                summary = f"Rebuilt catalog: {total} songs from {len(sources)} sources."
                self._send_json({"ok": True, "summary": summary, "meta": meta})
            except Exception as exc:
                self._send_json({"ok": False, "error": str(exc)}, status=500)
            return

        if self.path == "/api/config":
            try:
                data = self._read_body()
                path = data.get("dev_hdd0_path", "").strip()

                if not path:
                    self._send_json({"error": "dev_hdd0_path is required"}, status=400)
                    return

                # Validate the path
                valid, error, count = validate_dev_hdd0_path(path)
                if not valid:
                    self._send_json({"error": error or "Invalid path"}, status=400)
                    return

                # Save config
                config = {"dev_hdd0_path": path}
                write_json(CONFIG_PATH, config)

                self._send_json({
                    "ok": True,
                    "dev_hdd0_path": path,
                    "song_files": count,
                })
            except Exception as exc:
                self._send_json({"ok": False, "error": str(exc)}, status=500)
            return

        if self.path == "/api/validate":
            try:
                data = self._read_body()
                path = data.get("path", "").strip()

                if not path:
                    self._send_json({"valid": False, "error": "Path is required"}, status=400)
                    return

                valid, error, count = validate_dev_hdd0_path(path)
                self._send_json({
                    "valid": valid,
                    "error": error,
                    "song_files": count,
                })
            except Exception as exc:
                self._send_json({"valid": False, "error": str(exc)}, status=500)
            return

        if self.path == "/api/delete":
            try:
                data = self._read_body()
                song_keys = data.get("song_keys", [])

                # Validate input
                if not song_keys or not isinstance(song_keys, list):
                    self._send_json({"error": "song_keys array required"}, status=400)
                    return

                # Load data
                catalog = read_json(CATALOG_PATH)
                config = read_json(CONFIG_PATH)
                dev_hdd0_path = Path(config.get("dev_hdd0_path", "")).expanduser().resolve()

                # Validate request
                validation = validate_deletion_request(catalog, song_keys, dev_hdd0_path)
                if not validation['valid']:
                    self._send_json({
                        "error": "Validation failed",
                        "details": validation['errors']
                    }, status=400)
                    return

                # Calculate size before deletion
                total_size = calculate_deletion_size(dev_hdd0_path, validation['songs_by_dta'])

                # Execute deletion
                results = {
                    'dta_results': {},
                    'folder_results': {},
                    'total_deleted': 0,
                    'freed_space': total_size
                }

                for source_file, songs in validation['songs_by_dta'].items():
                    dta_path = dev_hdd0_path / source_file
                    keys_in_dta = [s['song_key'] for s in songs]

                    # Remove from DTA
                    dta_result = remove_songs_from_dta(dta_path, keys_in_dta)
                    results['dta_results'][source_file] = dta_result
                    results['total_deleted'] += len(dta_result['removed'])

                # Delete folders (separate loop for clarity)
                folder_result = delete_song_folders(dev_hdd0_path, validation['songs_by_dta'])
                results['folder_results'] = folder_result

                # Rebuild catalog
                build_catalog()

                self._send_json({
                    "ok": True,
                    "results": results,
                    "summary": f"Deleted {results['total_deleted']} of {len(song_keys)} songs"
                })

            except Exception as exc:
                self._send_json({"ok": False, "error": str(exc)}, status=500)
            return

        if self.path == "/api/restore":
            try:
                data = self._read_body()
                backup_type = data.get("backup_type")  # "dta" or "folder"
                backup_path = data.get("backup_path")

                if not backup_type or not backup_path:
                    self._send_json({
                        "error": "backup_type and backup_path required"
                    }, status=400)
                    return

                config = read_json(CONFIG_PATH)
                dev_hdd0_path = Path(config.get("dev_hdd0_path", "")).expanduser().resolve()

                result = restore_from_backup(dev_hdd0_path, backup_type, backup_path)

                if result['success']:
                    # Rebuild catalog after restoring
                    build_catalog()
                    self._send_json({
                        "ok": True,
                        "restored": result['restored'],
                        "summary": f"Restored {result['restored']}"
                    })
                else:
                    self._send_json({
                        "ok": False,
                        "error": result['error']
                    }, status=400)

            except Exception as exc:
                self._send_json({"ok": False, "error": str(exc)}, status=500)
            return

        if self.path == "/api/cleanup":
            try:
                data = self._read_body()
                days_old = data.get("days_old", 30)

                config = read_json(CONFIG_PATH)
                dev_hdd0_path = Path(config.get("dev_hdd0_path", "")).expanduser().resolve()

                result = cleanup_old_backups(dev_hdd0_path, days_old)

                self._send_json({
                    "ok": True,
                    "removed_dta": result['removed_dta'],
                    "removed_folders": result['removed_folders'],
                    "freed_space": result['freed_space'],
                    "errors": result['errors'],
                    "summary": f"Removed {result['removed_dta']} DTA backups and {result['removed_folders']} folders, freed {result['freed_space'] / (1024*1024):.1f} MB"
                })

            except Exception as exc:
                self._send_json({"ok": False, "error": str(exc)}, status=500)
            return

        if self.path == "/api/merge/validate":
            try:
                data = self._read_body()
                pack_names = data.get("pack_names", [])
                merged_pack_name = data.get("merged_pack_name", "")

                catalog = read_json(CATALOG_PATH)
                config = read_json(CONFIG_PATH)
                dev_hdd0_path = Path(config.get("dev_hdd0_path", "")).expanduser().resolve()

                result = validate_merge_request(catalog, pack_names, merged_pack_name, dev_hdd0_path)
                self._send_json(result)
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=500)
            return

        if self.path == "/api/merge":
            try:
                data = self._read_body()
                pack_names = data.get("pack_names", [])
                merged_pack_name = data.get("merged_pack_name", "")
                delete_source_packs = data.get("delete_source_packs", False)

                catalog = read_json(CATALOG_PATH)
                config = read_json(CONFIG_PATH)
                dev_hdd0_path = Path(config.get("dev_hdd0_path", "")).expanduser().resolve()

                # Validate first
                validation = validate_merge_request(catalog, pack_names, merged_pack_name, dev_hdd0_path)
                if not validation['valid']:
                    self._send_json({
                        "error": "Validation failed",
                        "details": validation['errors']
                    }, status=400)
                    return

                # Execute merge
                merge_result = create_merged_pack(
                    dev_hdd0_path,
                    validation['pack_info_list'],
                    merged_pack_name
                )

                if not merge_result['success']:
                    self._send_json({
                        "ok": False,
                        "error": "Merge failed",
                        "details": merge_result['errors']
                    }, status=500)
                    return

                # Delete source packs if requested
                deletion_results = None
                if delete_source_packs:
                    # Get all song keys from source packs
                    all_song_keys = []
                    for pack_info in validation['pack_info_list']:
                        all_song_keys.extend(pack_info['song_keys'])

                    # Delete using existing infrastructure
                    del_validation = validate_deletion_request(catalog, all_song_keys, dev_hdd0_path)
                    if del_validation['valid']:
                        deletion_results = {
                            'dta_results': {},
                            'folder_results': {},
                            'total_deleted': 0
                        }

                        for source_file, songs in del_validation['songs_by_dta'].items():
                            dta_path = dev_hdd0_path / source_file
                            keys_in_dta = [s['song_key'] for s in songs]

                            dta_result = remove_songs_from_dta(dta_path, keys_in_dta)
                            deletion_results['dta_results'][source_file] = dta_result
                            deletion_results['total_deleted'] += len(dta_result['removed'])

                        folder_result = delete_song_folders(dev_hdd0_path, del_validation['songs_by_dta'])
                        deletion_results['folder_results'] = folder_result

                # Rebuild catalog
                build_catalog()

                self._send_json({
                    "ok": True,
                    "merge_result": merge_result,
                    "deletion_results": deletion_results,
                    "summary": f"Merged {merge_result['packs_merged']} packs into {merged_pack_name} ({merge_result['total_songs']} songs)" +
                               (f", deleted source packs" if delete_source_packs else "")
                })

            except Exception as exc:
                self._send_json({"ok": False, "error": str(exc)}, status=500)
            return

        self._send_json({"error": "Not found"}, status=404)




def main():
    parser = argparse.ArgumentParser(description="Rock Band Song Catalog Server")
    parser.add_argument("--host", help="Bind address (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, help="Port number (default: 8000)")
    args = parser.parse_args()

    # Determine host and port
    host = args.host or os.environ.get("CATALOG_HOST", "0.0.0.0")
    port = args.port or int(os.environ.get("CATALOG_PORT", "8000"))

    server = ThreadingHTTPServer((host, port), Handler)

    print(f"Catalog server running on http://{host}:{port}")
    print("For HTTPS, use a reverse proxy (Caddy or nginx)")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.shutdown()


if __name__ == "__main__":
    main()
