# Custom skills (copy verbatim)

Two entirely custom skills have no upstream equivalent and must be copied as whole directories from the pre-migration state. Neither depends on v1 internals; both should work on v2 without modification.

## fameclaw — YouTube creator prospecting

**Location:** `.claude/skills/fameclaw/`

**Files (25 total):**
- `SKILL.md`
- `references/category-mapping.md`
- `references/negotiation_notes.md`
- `references/negotiation_playbook.md`
- `scripts/enrich_socials.sh`
- `scripts/extract_channel_data.sh`
- `scripts/extract_email.sh`
- `scripts/extract_tiktok.sh`
- `scripts/extract_tiktokshop.sh`
- `scripts/extract_x.sh`
- `scripts/find_related_channels.sh`
- `scripts/get_videos.sh`
- `scripts/gmail.py`
- `scripts/gmail_auth.sh`
- `scripts/negotiate.py`
- `scripts/onboard.sh`
- `scripts/outreach.py`
- `scripts/outreach.sh`
- `scripts/prospect.sh`
- `scripts/prospect_tiktok.sh`
- `scripts/prospect_tiktok_worker.js`
- `scripts/prospect_tiktokshop.sh`
- `scripts/safety.py`
- `scripts/scan_site.py`
- `scripts/score_channels.py`

**How to apply:**

```bash
git checkout pre-update-5754dd8-20260423-160211 -- .claude/skills/fameclaw/
```

Or:
```bash
mkdir -p .claude/skills/fameclaw
cp -r /path/to/pre-migration/tree/.claude/skills/fameclaw/. .claude/skills/fameclaw/
```

No NanoClaw-specific wiring — this is a self-contained skill. It does depend on external tooling (`yt-dlp`, `gmail` CLI, Python 3 with various deps); ensure those are installed.

## add-karpathy-llm-wiki — LLM wiki knowledge base

**Installer location:** `.claude/skills/add-karpathy-llm-wiki/`
**Container-side location:** `container/skills/wiki/`

**Files:**
- `.claude/skills/add-karpathy-llm-wiki/SKILL.md`
- `.claude/skills/add-karpathy-llm-wiki/llm-wiki.md`
- `container/skills/wiki/SKILL.md`

**How to apply:**

```bash
git checkout pre-update-5754dd8-20260423-160211 -- .claude/skills/add-karpathy-llm-wiki/ container/skills/wiki/
```

The installer skill (`.claude/skills/add-karpathy-llm-wiki/`) walks the user through adding a persistent wiki to a NanoClaw group. The container-side skill (`container/skills/wiki/`) is mounted into agent containers at runtime.

**⚠️ v2 risk:** v2 may have reorganized the `container/skills/` directory structure (per CLAUDE.md it's listed as a "Container skill" category). Inspect v2's `container/skills/` layout and ensure `wiki/` fits the same loading convention. If the container skill loader now requires additional metadata (e.g. a manifest entry), add it.
