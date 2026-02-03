#!/usr/bin/env python3
"""
RPCS3 Rock Band Song Catalog Server

Serves the song database web app with optional HTTPS support.

Usage:
  python server.py                     # HTTP on 127.0.0.1:8000
  python server.py --https             # HTTPS on 0.0.0.0:443 with Let's Encrypt
  python server.py --https --port 8443 # HTTPS on custom port

Environment variables:
  CATALOG_HOST      Bind address (default: 127.0.0.1, or 0.0.0.0 with --https)
  CATALOG_PORT      Port number (default: 8000, or 443 with --https)
  SSL_CERT          Path to certificate file (default: /etc/letsencrypt/live/*/fullchain.pem)
  SSL_KEY           Path to private key file (default: /etc/letsencrypt/live/*/privkey.pem)
  SSL_DOMAIN        Domain name for Let's Encrypt cert lookup
"""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse
import json
import os
import ssl
import sys

from build_catalog import build_catalog

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

        self._send_json({"error": "Not found"}, status=404)


def find_letsencrypt_cert(domain: str | None = None) -> tuple[Path, Path] | None:
    """Find Let's Encrypt certificate files for the given domain."""
    le_base = Path("/etc/letsencrypt/live")
    if not le_base.exists():
        return None

    if domain:
        cert_dir = le_base / domain
        if cert_dir.exists():
            cert = cert_dir / "fullchain.pem"
            key = cert_dir / "privkey.pem"
            if cert.exists() and key.exists():
                return cert, key
        return None

    # Auto-detect: use first available domain
    for cert_dir in le_base.iterdir():
        if cert_dir.is_dir() and not cert_dir.name.startswith("."):
            cert = cert_dir / "fullchain.pem"
            key = cert_dir / "privkey.pem"
            if cert.exists() and key.exists():
                return cert, key
    return None


def create_ssl_context(cert_path: str, key_path: str) -> ssl.SSLContext:
    """Create SSL context with the given certificate and key."""
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(cert_path, key_path)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    return context


def main():
    parser = argparse.ArgumentParser(description="Rock Band Song Catalog Server")
    parser.add_argument("--https", action="store_true", help="Enable HTTPS")
    parser.add_argument("--host", help="Bind address")
    parser.add_argument("--port", type=int, help="Port number")
    parser.add_argument("--cert", help="Path to SSL certificate (fullchain.pem)")
    parser.add_argument("--key", help="Path to SSL private key (privkey.pem)")
    parser.add_argument("--domain", help="Let's Encrypt domain name")
    args = parser.parse_args()

    use_https = args.https or os.environ.get("SSL_CERT")

    # Determine host and port
    if args.host:
        host = args.host
    elif os.environ.get("CATALOG_HOST"):
        host = os.environ["CATALOG_HOST"]
    else:
        host = "0.0.0.0" if use_https else "127.0.0.1"

    if args.port:
        port = args.port
    elif os.environ.get("CATALOG_PORT"):
        port = int(os.environ["CATALOG_PORT"])
    else:
        port = 443 if use_https else 8000

    server = ThreadingHTTPServer((host, port), Handler)

    if use_https:
        # Get certificate paths
        cert_path = args.cert or os.environ.get("SSL_CERT")
        key_path = args.key or os.environ.get("SSL_KEY")
        domain = args.domain or os.environ.get("SSL_DOMAIN")

        if not cert_path or not key_path:
            # Try to find Let's Encrypt certs
            le_certs = find_letsencrypt_cert(domain)
            if le_certs:
                cert_path, key_path = str(le_certs[0]), str(le_certs[1])
                print(f"Using Let's Encrypt certificate: {cert_path}")
            else:
                print("Error: HTTPS enabled but no certificates found.", file=sys.stderr)
                print("Provide --cert and --key, or set SSL_CERT/SSL_KEY env vars,", file=sys.stderr)
                print("or ensure Let's Encrypt certs exist in /etc/letsencrypt/live/", file=sys.stderr)
                sys.exit(1)

        try:
            context = create_ssl_context(cert_path, key_path)
            server.socket = context.wrap_socket(server.socket, server_side=True)
            proto = "https"
        except Exception as e:
            print(f"Error loading SSL certificate: {e}", file=sys.stderr)
            sys.exit(1)
    else:
        proto = "http"

    print(f"Catalog server running on {proto}://{host}:{port}")
    if port == 443 and host == "0.0.0.0":
        print("Note: Port 443 may require root privileges")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.shutdown()


if __name__ == "__main__":
    main()
