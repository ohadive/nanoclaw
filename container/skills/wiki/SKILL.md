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

## Page Types

Three kinds of pages, listed by how much they compound:

1. **Entity pages** (most pages today) — one person or company. Filename: `<company>-<person>.md` or `<person>.md`. Frontmatter: `type: client | prospect | network`, `last-updated: YYYY-MM-DD`. Content: who they are, the deal/relationship, decisions, outcomes, transcripts referenced.

2. **Concept pages** — a recurring theme or pattern that shows up across many entities. Examples for this wiki: `pricing-patterns.md`, `objection-handlers.md`, `deal-flow-patterns.md`, `app-category-notes/{cro,fulfillment,marketplace,…}.md`. These are where the *real* leverage lives — they distill what works across N calls into one place. Aggressively create these the first time you notice a pattern repeating; refine them on every subsequent ingest.

3. **Synthesis pages** — answers Ohad asked you that turned out to be useful enough to keep. Filename includes a date: `synthesis/2026-04-25-pricing-vs-conversion.md`. Distinct from concept pages (which evolve continuously) — synthesis pages are point-in-time answers preserved for reuse.

When ingesting, always ask: *"does this source touch any concept page, or reveal a pattern that warrants creating one?"* Answer is usually yes.

## Operations

### Ingest

When processing a new source:

1. Read the source fully
2. Extract: people, companies, decisions, positioning, objections, outcomes, Ohad's language patterns
3. **Update existing entity pages** for everyone mentioned — don't just create new ones
4. **Update or create concept pages** for any pattern that recurs. If you saw a similar objection in 2+ prior sources, that belongs in `objection-handlers.md` with citations to the entity pages where it appeared
5. Create new entity pages only for genuinely new people/companies
6. Update `/workspace/extra/projects/wiki/index.md` with any new pages, in the right category
7. Append to `/workspace/extra/projects/wiki/log.md`: `## [YYYY-MM-DD] ingest | Source title` (and list every page you touched)
8. Cross-link: every page should link to related pages using `[[page-name]]` syntax. Entity pages link to relevant concept pages; concept pages cite entity pages as evidence

**For transcripts specifically:** Pay attention to how Ohad pitches, handles objections, describes his services, and closes. These are concept-page material — extract the pattern, not just the instance.

### Query

When asked about something:

1. Read `/workspace/extra/projects/wiki/index.md` to locate relevant pages
2. Read those pages, follow cross-links if needed
3. Synthesize an answer with citations to wiki pages
4. If the answer reveals a gap, note it — suggest sources to fill it
5. **File good answers back as wiki pages.** When your answer is a synthesis across multiple pages and the user signals it was useful (says thanks, asks a follow-up that reuses it, indicates they'll act on it), offer: *"want me to save this as a synthesis page?"* If yes, write it to `synthesis/YYYY-MM-DD-<slug>.md`, link from `index.md`, and append a `## [YYYY-MM-DD] synthesis | <topic>` entry to `log.md`. Don't ask for trivial lookups — only when real synthesis happened that would be expensive to redo.

### Lint

Periodic health check (in addition to the generic checks, run these domain-specific ones):

1. **Generic:** orphan pages (no inbound links), contradictions across pages, missing cross-references
2. **Implicit entities:** grep across all wiki pages for person/company names mentioned 3+ times. If any mentioned name has no dedicated entity page, flag it as a missing page candidate
3. **Stale clients:** for every page with `type: client`, check if the most recent transcript filename in `/workspace/extra/projects/Content/Reference/Transcripts/` matching that client is reflected in the page. If a transcript exists but isn't cited, the page is stale
4. **Concept coverage:** check whether recurring themes (you can see them in `log.md` ingest entries — same words showing up across sources) have a concept page. Surface gaps
5. **Frontmatter consistency:** `last-updated:` should match the most recent log entry that touched the page. Mismatches mean someone (you) forgot to update
6. Append findings to `/workspace/extra/projects/wiki/log.md`: `## [YYYY-MM-DD] lint | <one-line summary>` with details inline

## Page Conventions

- One markdown file per entity, concept, or synthesis (for synthesis pages, dated under `synthesis/`)
- Filenames: `kebab-case.md`
- Start each page with `# Title` and a 1-2 line summary
- Use `[[page-name]]` for cross-links
- Include a `## Sources` section listing which raw sources informed the page
- YAML frontmatter: required for entity pages (`type:`, `last-updated:`); optional for concept/synthesis pages

## What Makes This Wiki Valuable

This isn't documentation — it's Ohad's business brain externalized. The most valuable pages are:
- **How Ohad sells** — patterns from dozens of calls
- **Client context** — so you can reference past conversations naturally
- **Voice patterns** — how Ohad actually talks, not how a generic consultant talks
- **Decision history** — why things were done a certain way
