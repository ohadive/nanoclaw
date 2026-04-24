# Wiki — Schema & Operations

You maintain a persistent, shared knowledge base at `/workspace/extra/projects/wiki/`. This wiki is accessible from all channels (Slack, WhatsApp, Telegram). Sources live in `/workspace/extra/projects/Content/`. Knowledge compounds — every source you process should enrich existing pages, not just create new ones.

## Three Layers

1. **Sources** (read-only) — call transcripts, blog posts, proposals, content at `/workspace/extra/projects/Content/`. Never modify these.
2. **Wiki** (you maintain) — `/workspace/extra/projects/wiki/` directory with cross-linked markdown pages. You own this entirely.
3. **Schema** (this file) — how you operate.

## Source Locations

| Type | Path |
|------|------|
| Call transcripts | `/workspace/extra/projects/Content/Reference/Transcripts/` |
| Blog posts | `/workspace/extra/projects/Content/Blog/` |
| Proposals | `/workspace/extra/projects/Content/proposals/` |
| Social content | `/workspace/extra/projects/Content/Social Media/` |
| Email content | `/workspace/extra/projects/Content/eMail/` |

## Operations

### Ingest

When processing a new source:

1. Read the source fully
2. Extract: people, companies, decisions, positioning, objections, outcomes, Ohad's language patterns
3. Update existing wiki pages (client profiles, positioning patterns, etc.) — don't just create new pages
4. Create new pages only for genuinely new entities or concepts
5. Update `/workspace/extra/projects/wiki/index.md` with any new pages
6. Append to `/workspace/extra/projects/wiki/log.md`: `## [YYYY-MM-DD] ingest | Source title`
7. Cross-link: every page should link to related pages using `[[page-name]]` syntax

**For transcripts specifically:** Pay attention to how Ohad pitches, handles objections, describes his services, and closes. These patterns are high-value for the positioning and voice pages.

### Query

When asked about something:

1. Read `/workspace/extra/projects/wiki/index.md` to locate relevant pages
2. Read those pages, follow cross-links if needed
3. Synthesize an answer with citations to wiki pages
4. If the answer reveals a gap, note it — suggest sources to fill it

### Lint

Periodic health check:

1. Find orphan pages (no inbound links)
2. Flag stale pages (not updated despite newer sources)
3. Check for contradictions across pages
4. Identify important topics that lack dedicated pages
5. Suggest sources to pursue for gaps
6. Append to `/workspace/extra/projects/wiki/log.md`: `## [YYYY-MM-DD] lint | Findings summary`

## Page Conventions

- One markdown file per entity/concept
- Filenames: `kebab-case.md`
- Start each page with `# Title` and a 1-2 line summary
- Use `[[page-name]]` for cross-links
- Include a `## Sources` section listing which raw sources informed the page
- Use YAML frontmatter sparingly — only when useful (e.g., `type: client`, `last-updated:`)

## What Makes This Wiki Valuable

This isn't documentation — it's Ohad's business brain externalized. The most valuable pages are:
- **How Ohad sells** — patterns from dozens of calls
- **Client context** — so you can reference past conversations naturally
- **Voice patterns** — how Ohad actually talks, not how a generic consultant talks
- **Decision history** — why things were done a certain way
