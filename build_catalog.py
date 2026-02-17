#!/usr/bin/env python3
import json
import re
from pathlib import Path
from datetime import datetime
import sys

SCRIPT_DIR = Path(__file__).resolve().parent
CONFIG_PATH = SCRIPT_DIR / "config.json"
CATALOG_PATH = SCRIPT_DIR / "catalog.json"
META_PATH = SCRIPT_DIR / "catalog_meta.json"


def load_config():
    """Load configuration file or return defaults."""
    if CONFIG_PATH.exists():
        try:
            with CONFIG_PATH.open("r", encoding="utf-8") as f:
                config = json.load(f)
                dev_hdd0 = config.get("dev_hdd0_path")
                if dev_hdd0:
                    return Path(dev_hdd0)
        except (json.JSONDecodeError, KeyError) as e:
            print(f"Warning: Error reading config.json: {e}", file=sys.stderr)

    # Fallback to old behavior (parent.parent/dev_hdd0)
    return SCRIPT_DIR.parent / "dev_hdd0"


DEV_HDD0_PATH = load_config()

EUROVISION_KEYWORDS = ["eurovision"]

# Pack priority for deduplication (lower = higher priority)
PACK_PRIORITY = {'disc': 1, 'export': 2, 'dlc': 3, 'custom': 4, 'other': 5}


def _dedup_priority(song):
    """Lower tuple = preferred. Tie-break: prefer human names over content-ID names."""
    type_pri = PACK_PRIORITY.get(song.get('pack_type'), 99)
    # Content-ID pattern (e.g. O799159THEBEATLESROCKBAND3) gets lower preference
    is_content_id = bool(re.match(r'^[A-Z]{1,2}\d{5,}', song.get('pack_name', '')))
    return (type_pri, int(is_content_id))


def tokenize(text: str):
    tokens = []
    i = 0
    while i < len(text):
        ch = text[i]
        if ch.isspace():
            i += 1
            continue
        if ch in "()":
            tokens.append(ch)
            i += 1
            continue
        if ch == '"':
            i += 1
            out = []
            while i < len(text):
                ch = text[i]
                if ch == "\\" and i + 1 < len(text):
                    out.append(text[i + 1])
                    i += 2
                    continue
                if ch == '"':
                    i += 1
                    break
                out.append(ch)
                i += 1
            tokens.append("".join(out))
            continue
        start = i
        while i < len(text) and not text[i].isspace() and text[i] not in "()":
            i += 1
        tok = text[start:i]
        if len(tok) > 1 and tok.startswith("'") and tok.endswith("'"):
            tok = tok[1:-1]
        tokens.append(tok)
    return tokens


def parse_tokens(tokens):
    i = 0

    def parse():
        nonlocal i
        tok = tokens[i]
        i += 1
        if tok == '(':
            items = []
            while i < len(tokens) and tokens[i] != ')':
                items.append(parse())
            i += 1
            return items
        if tok.isdigit():
            return int(tok)
        return tok

    exprs = []
    while i < len(tokens):
        if tokens[i] == '(':
            exprs.append(parse())
        else:
            i += 1
    return exprs


def parse_top_level(text: str):
    # strip comments starting with ';'
    lines = []
    for line in text.splitlines():
        if ';' in line:
            line = line.split(';', 1)[0]
        lines.append(line)
    clean = "\n".join(lines)

    tokens = tokenize(clean)
    return parse_tokens(tokens)


def get_field(entries, key):
    for ent in entries:
        if isinstance(ent, list) and ent:
            if ent[0] == key and len(ent) > 1:
                return ent[1]
    return ""


def get_field_int(entries, key):
    val = get_field(entries, key)
    return val if isinstance(val, int) else ""


def to_str(val):
    if isinstance(val, str):
        return val
    if val is None or val == "":
        return ""
    return str(val)


def classify_pack(pack_name: str):
    low = pack_name.lower()
    if pack_name == "BASE":
        return "disc"
    if "custom" in low:
        return "custom"
    if "export" in low:
        return "export"
    if "dlc" in low or "pack" in low or "rb4-to-rb2" in low:
        return "dlc"
    # PSN/RPCS3 content IDs: 1-2 uppercase letters followed by 5+ digits
    # e.g. O799159THEBEATLESROCKBAND3 — auto-generated DLC folder names
    if re.match(r'^[A-Z]{1,2}\d{5,}', pack_name):
        return "dlc"
    return "other"


def derive_pack(path: Path):
    rel = path.relative_to(DEV_HDD0_PATH)
    parts = list(rel.parts)
    title_id = ""
    if "game" in parts:
        idx = parts.index("game")
        if idx + 1 < len(parts):
            title_id = parts[idx + 1]
    pack_name = "BASE"
    if "USRDIR" in parts:
        uidx = parts.index("USRDIR")
        if uidx + 1 < len(parts):
            # songs.dta directly under USRDIR -> BASE
            next_part = parts[uidx + 1]
            if next_part != "songs.dta":
                pack_name = next_part
    return title_id, pack_name, classify_pack(pack_name)


def is_eurovision(song):
    hay = " ".join(str(v) for v in song.values()).lower()
    return any(k in hay for k in EUROVISION_KEYWORDS)


def build_catalog():
    sources = sorted(DEV_HDD0_PATH.glob("**/songs.dta"))
    all_songs = []
    meta_sources = []

    for path in sources:
        text = path.read_text(errors="ignore")
        entries = parse_top_level(text)
        title_id, pack_name, pack_type = derive_pack(path)
        song_count = 0

        for entry in entries:
            if not isinstance(entry, list) or not entry:
                continue
            song_key = entry[0]
            if not isinstance(song_key, str):
                continue
            if song_key in {"songs", "meta", "song", "version"}:
                continue
            name = to_str(get_field(entry, "name"))
            artist = to_str(get_field(entry, "artist"))
            album = to_str(get_field(entry, "album_name") or get_field(entry, "album"))
            year = get_field_int(entry, "year") or get_field_int(entry, "year_released")
            genre = to_str(get_field(entry, "genre"))
            sub_genre = to_str(get_field(entry, "sub_genre") or get_field(entry, "subgenre"))
            decade = to_str(get_field(entry, "decade"))
            song_id = get_field_int(entry, "song_id")
            if not (name or artist):
                continue

            song = {
                "song_key": song_key,
                "song_id": song_id,
                "name": name,
                "artist": artist,
                "album": album,
                "year": year,
                "decade": decade,
                "genre": genre,
                "sub_genre": sub_genre,
                "title_id": title_id,
                "pack_name": pack_name,
                "pack_type": pack_type,
                "source_file": str(path.relative_to(DEV_HDD0_PATH)),
            }
            song["is_eurovision"] = is_eurovision(song)
            all_songs.append(song)
            song_count += 1

        st = path.stat()
        meta_sources.append({
            "path": str(path.relative_to(DEV_HDD0_PATH)),
            "mtime": int(st.st_mtime),
            "size": st.st_size,
            "song_count": song_count,
        })

    all_songs.sort(key=lambda s: (to_str(s.get("artist", "")), to_str(s.get("name", ""))))

    # --- Deduplicate by song_id ---
    # Songs sharing a non-zero song_id are the same track stored in multiple packs.
    # Keep the highest-priority version; record dropped copies for admin cleanup.
    best_by_id = {}
    for song in all_songs:
        sid = song.get('song_id')
        if not (sid and isinstance(sid, int) and sid > 0):
            continue
        existing = best_by_id.get(sid)
        if existing is None or _dedup_priority(song) < _dedup_priority(existing):
            best_by_id[sid] = song

    kept = []
    dropped = []
    for song in all_songs:
        sid = song.get('song_id')
        if not (sid and isinstance(sid, int) and sid > 0):
            kept.append(song)
        elif best_by_id[sid] is song:
            kept.append(song)
        else:
            dropped.append({
                'song_key':   song['song_key'],
                'name':       song['name'],
                'artist':     song['artist'],
                'source_file': song['source_file'],
                'pack_name':  song['pack_name'],
                'kept_pack':  best_by_id[sid]['pack_name'],
            })

    all_songs = kept

    SCRIPT_DIR.mkdir(exist_ok=True)
    with CATALOG_PATH.open("w", encoding="utf-8") as f:
        json.dump(all_songs, f, ensure_ascii=False, indent=2)

    meta = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "total_songs": len(all_songs),
        "sources": meta_sources,
        "deduplicated": {
            "total_dropped": len(dropped),
            "dropped_songs": dropped,
        },
    }
    with META_PATH.open("w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    if dropped:
        print(f"Deduplicated {len(dropped)} songs (same song_id in multiple packs)")
    print(f"Wrote {len(all_songs)} songs to {CATALOG_PATH}")


if __name__ == "__main__":
    build_catalog()
