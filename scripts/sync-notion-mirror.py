#!/usr/bin/env python3
"""
sync-notion-mirror.py — push Quill's _notion-mirror.md manifests to Notion.

What it does:
  - Reads one or more manifest files (markdown with YAML-ish frontmatter blocks).
  - For each block, upserts a Notion page in the matching data source, keyed by
    the `External ID` property.
  - Idempotent: re-running on the same manifest updates pages in place.

Why Python (not bash): macOS ships bash 3.2 — no associative arrays. The logic
(manifest parsing, JSON payloads, upsert) outgrew shell. Stdlib only; auth is
delegated to the `ntn` CLI so no Notion token is handled here.

Usage:
  scripts/sync-notion-mirror.py <manifest-path> [<manifest-path> ...]
  scripts/sync-notion-mirror.py --sprint 2026-W21      # all manifests for a sprint
  scripts/sync-notion-mirror.py --all                  # every *-mirror.md / _notion-mirror.md under the group folder
  scripts/sync-notion-mirror.py --dry-run <path>       # parse + print payloads, no API calls
  WIPE_BODY=1 scripts/sync-notion-mirror.py <path>     # replace page body instead of appending

Requires:
  - ntn CLI (~/.local/bin/ntn) authenticated via `ntn login`
  - python3 (stdlib only)

Exit codes:
  0 — all blocks synced (or dry-run / no-op)
  1 — partial failure (specific blocks logged to stderr)
  2 — fatal config issue (ntn missing/unauthenticated, manifest unreadable)

Notion data model note (API version 2025-09-03+):
  A "database" is a container with one or more "data sources". Page queries and
  page creation target the DATA SOURCE id, not the database id. The ids below
  are data source ids.
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

# ──────────────────────────────────────────────────────────────────────────────
# Configuration — Notion data source ids.
#
# Parent page "Quill — X Content System":
#   https://www.notion.so/Quill-X-Content-System-3687c3ae3ec281ab80ede9808aff7c88
#
#   Database          database_id                           data_source_id
#   Content Backlog   33b5c59b-05e6-44cb-b979-0479b3509ea6  5b6ff7a0-9ee2-42b8-8cc8-09d01d08bfd5
#   Lead Magnets      4e09961b-47d6-429e-acea-7d8936eb22e1  3d59b58f-97d2-418a-b71d-da16618d7a56
#   Trend Tracker     9c8bb24d-abbd-49aa-bb21-33fdd99475b4  84521916-2f8b-40aa-a206-357a0b5370d3
#   Weekly Sprints    d64c9d8d-62c4-47e0-95ef-f88dfd5ca912  3709842b-30f5-499e-83e8-116a71aa8c1b
# ──────────────────────────────────────────────────────────────────────────────
DS_BY_TYPE = {
    "content-asset": os.environ.get("DS_ID_CONTENT_BACKLOG", "5b6ff7a0-9ee2-42b8-8cc8-09d01d08bfd5"),
    "lead-magnet": os.environ.get("DS_ID_LEAD_MAGNETS", "3d59b58f-97d2-418a-b71d-da16618d7a56"),
    "trend-opportunity": os.environ.get("DS_ID_TREND_TRACKER", "84521916-2f8b-40aa-a206-357a0b5370d3"),
    "sprint-summary": os.environ.get("DS_ID_WEEKLY_SPRINTS", "3709842b-30f5-499e-83e8-116a71aa8c1b"),
}

NTN = os.environ.get("NTN", os.path.expanduser("~/.local/bin/ntn"))
GROUP_DIR = Path(os.environ.get(
    "GROUP_DIR",
    Path(__file__).resolve().parent.parent / "groups" / "x-content-creator",
))
WIPE_BODY = os.environ.get("WIPE_BODY", "0") == "1"
LOG = "[sync-notion-mirror]"

# Meta keys that are not Notion properties.
META_KEYS = {"mirror-type", "database", "operation", "external-id"}


# ──────────────────────────────────────────────────────────────────────────────
# ntn CLI wrapper
# ──────────────────────────────────────────────────────────────────────────────
def ntn_api(path, method="GET", body=None):
    """Call the Notion API via the ntn CLI. Returns parsed JSON (dict)."""
    cmd = [NTN, "api", path, "-X", method]
    if body is not None:
        cmd += ["-d", json.dumps(body)]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    out = proc.stdout.strip()
    if proc.returncode != 0:
        raise RuntimeError(f"ntn api {method} {path} failed: {proc.stderr.strip() or out}")
    try:
        return json.loads(out) if out else {}
    except json.JSONDecodeError:
        raise RuntimeError(f"ntn api {method} {path} returned non-JSON: {out[:200]}")


def preflight():
    if not os.path.isfile(NTN) or not os.access(NTN, os.X_OK):
        sys.exit(f"{LOG} ntn CLI not found/executable at {NTN}")
    doctor = subprocess.run([NTN, "doctor"], capture_output=True, text=True)
    # `ntn doctor` writes its report to stderr.
    report = doctor.stdout + doctor.stderr
    if "Default workspace" not in report or "✔" not in report.split("Default workspace")[1][:40]:
        sys.exit(f"{LOG} ntn not authenticated (no default workspace) — run 'ntn login' first")
    missing = [t for t, ds in DS_BY_TYPE.items() if not ds or ds.startswith("__")]
    if missing:
        sys.exit(f"{LOG} missing data source id for: {', '.join(missing)}")


# ──────────────────────────────────────────────────────────────────────────────
# Manifest parsing (stdlib-only — the manifest YAML is a restricted subset:
# flat key:value pairs plus one nested `properties:` mapping).
# ──────────────────────────────────────────────────────────────────────────────
_QUOTED = re.compile(r'''^(?P<q>["'])(?P<v>.*)(?P=q)$''')


def _parse_value(raw):
    raw = raw.strip()
    if not raw:
        return ""
    m = _QUOTED.match(raw)
    if m:
        return m.group("v").replace('\\"', '"').replace("\\'", "'")
    try:
        return float(raw) if "." in raw else int(raw)
    except ValueError:
        return raw


def _parse_frontmatter(text):
    fm = {}
    nested_key = None
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if not line.startswith((" ", "\t")):
            key, _, value = line.partition(":")
            key, value = key.strip(), value.strip()
            if value == "":
                fm[key] = {}
                nested_key = key
            else:
                fm[key] = _parse_value(value)
                nested_key = None
        else:
            if nested_key is None:
                continue
            key, _, value = line.strip().partition(":")
            fm[nested_key][key.strip()] = _parse_value(value.strip())
    return fm


def parse_manifest(path):
    """Yield {'frontmatter': {...flat...}, 'body': str} per record block."""
    text = Path(path).read_text(encoding="utf-8")
    chunks = re.split(r"(?m)^---\s*$", text)
    while chunks and chunks[0].strip() == "":
        chunks.pop(0)
    i = 0
    blocks = []
    while i < len(chunks):
        fm_raw = chunks[i].strip()
        body = chunks[i + 1].strip() if i + 1 < len(chunks) else ""
        i += 2
        if not fm_raw:
            continue
        fm = _parse_frontmatter(fm_raw)
        if "mirror-type" not in fm:
            continue
        properties = fm.pop("properties", {}) or {}
        meta = {k: fm[k] for k in META_KEYS if k in fm}
        blocks.append({"frontmatter": {**meta, **properties}, "body": body})
    return blocks


# ──────────────────────────────────────────────────────────────────────────────
# Notion payload builders
# ──────────────────────────────────────────────────────────────────────────────
_SCHEMA_CACHE = {}


def get_schema(ds_id):
    """Return {property_name: notion_type} for a data source. Cached per run."""
    if ds_id not in _SCHEMA_CACHE:
        ds = ntn_api(f"/v1/data_sources/{ds_id}", "GET")
        _SCHEMA_CACHE[ds_id] = {
            name: prop.get("type") for name, prop in ds.get("properties", {}).items()
        }
    return _SCHEMA_CACHE[ds_id]


def _prop_payload(notion_type, value):
    """Build a single Notion property value payload for the given schema type."""
    s = "" if value is None else str(value)
    if notion_type == "title":
        return {"title": [{"text": {"content": s}}]}
    if notion_type == "rich_text":
        return {"rich_text": [{"text": {"content": s}}]}
    if notion_type == "select":
        return {"select": {"name": s}} if s else {"select": None}
    if notion_type == "multi_select":
        names = [v.strip() for v in s.split(",") if v.strip()]
        return {"multi_select": [{"name": n} for n in names]}
    if notion_type == "number":
        try:
            return {"number": float(value) if value not in (None, "") else None}
        except (TypeError, ValueError):
            return {"number": None}
    if notion_type == "url":
        return {"url": s or None}
    if notion_type == "date":
        return {"date": {"start": s}} if s else {"date": None}
    if notion_type == "checkbox":
        return {"checkbox": str(value).lower() in ("1", "true", "yes")}
    # Unknown / unsupported type — fall back to rich_text so the sync doesn't 400.
    return {"rich_text": [{"text": {"content": s}}]}


def build_properties(frontmatter, external_id, schema):
    """Map flat frontmatter → Notion property payload, typed against the live schema."""
    props = {}
    for key, value in frontmatter.items():
        if key in META_KEYS:
            continue
        notion_type = schema.get(key)
        if notion_type is None:
            print(f"{LOG}   warn: property '{key}' not in data source schema — skipped", file=sys.stderr)
            continue
        props[key] = _prop_payload(notion_type, value)
    # External ID is always set (rich_text in every database).
    props["External ID"] = _prop_payload(schema.get("External ID", "rich_text"), external_id)
    return props


def build_children(body):
    """Body text → list of Notion paragraph blocks (one per blank-line group)."""
    blocks = []
    for chunk in body.split("\n\n"):
        chunk = chunk.strip()
        if not chunk:
            continue
        for i in range(0, len(chunk), 1900):  # Notion's per-block limit is 2000.
            blocks.append({
                "object": "block",
                "type": "paragraph",
                "paragraph": {"rich_text": [{"type": "text", "text": {"content": chunk[i:i + 1900]}}]},
            })
    return blocks


# ──────────────────────────────────────────────────────────────────────────────
# Upsert
# ──────────────────────────────────────────────────────────────────────────────
def upsert_block(block, dry_run=False):
    fm = block["frontmatter"]
    mirror_type = fm.get("mirror-type")
    external_id = fm.get("external-id")
    ds_id = DS_BY_TYPE.get(mirror_type)

    if not ds_id:
        print(f"{LOG} unknown mirror-type '{mirror_type}' — skipped", file=sys.stderr)
        return False
    if not external_id:
        print(f"{LOG} block missing external-id — skipped", file=sys.stderr)
        return False

    if dry_run:
        # Dry run still needs the schema to build a faithful payload preview;
        # skip the network call and infer loosely instead.
        schema = {k: ("title" if k == "Name" else "rich_text") for k in fm}
    else:
        schema = get_schema(ds_id)

    properties = build_properties(fm, str(external_id), schema)
    children = build_children(block["body"])

    if dry_run:
        print(f"{LOG} [dry-run] {mirror_type} external-id={external_id}")
        print(json.dumps({"properties": properties, "children_count": len(children)}, indent=2))
        return True

    # Find an existing page by External ID.
    query = ntn_api(
        f"/v1/data_sources/{ds_id}/query",
        "POST",
        {"filter": {"property": "External ID", "rich_text": {"equals": str(external_id)}}, "page_size": 1},
    )
    results = query.get("results", [])
    existing_id = results[0]["id"] if results else None

    if existing_id:
        print(f"{LOG} UPDATE {mirror_type} external-id={external_id} -> {existing_id}")
        ntn_api(f"/v1/pages/{existing_id}", "PATCH", {"properties": properties})
        if WIPE_BODY:
            kids = ntn_api(f"/v1/blocks/{existing_id}/children?page_size=100", "GET")
            for k in kids.get("results", []):
                try:
                    ntn_api(f"/v1/blocks/{k['id']}", "DELETE")
                except RuntimeError:
                    pass
        if children:
            ntn_api(f"/v1/blocks/{existing_id}/children", "PATCH", {"children": children})
    else:
        print(f"{LOG} CREATE {mirror_type} external-id={external_id}")
        ntn_api("/v1/pages", "POST", {
            "parent": {"type": "data_source_id", "data_source_id": ds_id},
            "properties": properties,
            "children": children,
        })
    return True


# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────
def collect_files(argv):
    if not argv:
        sys.exit("Usage: sync-notion-mirror.py <manifest> [...] | --sprint YYYY-Www | --all [--dry-run]")
    if argv[0] == "--all":
        return sorted(
            list(GROUP_DIR.rglob("_notion-mirror.md")) + list(GROUP_DIR.rglob("*-mirror.md"))
        )
    if argv[0] == "--sprint":
        if len(argv) < 2:
            sys.exit("--sprint needs a sprint id, e.g. 2026-W21")
        return [GROUP_DIR / "sprints" / argv[1] / "_notion-mirror.md"]
    return [Path(a) for a in argv]


def main():
    argv = sys.argv[1:]
    dry_run = "--dry-run" in argv
    argv = [a for a in argv if a != "--dry-run"]

    if not dry_run:
        preflight()

    files = collect_files(argv)
    failed = False
    for f in files:
        if not f.is_file():
            print(f"{LOG} manifest not found: {f}", file=sys.stderr)
            failed = True
            continue
        print(f"{LOG} -> {f}")
        blocks = parse_manifest(f)
        if not blocks:
            print(f"{LOG} (no records in {f})")
            continue
        for block in blocks:
            try:
                if not upsert_block(block, dry_run=dry_run):
                    failed = True
            except RuntimeError as e:
                print(f"{LOG} ERROR: {e}", file=sys.stderr)
                failed = True

    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
