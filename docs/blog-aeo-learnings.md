# Blog AEO Learnings — Handoff from the Content workspace

Shared so NanoClaw's content agents can apply the same Answer Engine Optimization (AEO) structure we now use for blog posts on ohadmichaeli.com.

**Source of truth (Content workspace):**
- Full playbook: `Content/.claude/agents/blog-post-writer.md` (lines 66–211)
- Tightened version: `Content/ohadmichaeli/knowledge/blog-posts.md` ("Structure for AI-era search")
- Pipelines that enforce it: `blog-batch` skill (AEO is Layer 5 of the editor) and `site-blog` skill

## Core thesis

AI doesn't *rank* content, it *interprets* it. Structure every post so AI systems (AI Overviews, ChatGPT, etc.) can reliably extract and cite it across many queries — without us publishing new pages. Well-structured content gets cited; AI-sourced traffic also converts higher than non-brand search.

## Required structure

Header block, immediately after the title:

```markdown
## TL;DR
[2-3 sentences. The first 100-150 words answer the post's core question
completely and actionably. No warm-up, no "in this post we'll cover."
AI Overviews pull from this block — write it as a real answer, not a teaser.]

## Who This Is For
[One sentence: exact reader description.]

## The Core Problem
[One specific problem statement — concrete enough for AI query matching.]
```

Then the body, following these rules:

1. **Every H2 maps to a question people actually search.** Check the People Also Ask box for the target keyword. What/How/Why phrasings count. A clever label that isn't a question helps nobody find the section.
2. **Every section stands alone.** AI reads sections independently — no section should need the previous one to make sense.
3. **Bake in decision logic.** Explicit "If X, then Y because Z" statements.
4. **FAQ section (required).** 3-5 questions phrased exactly how users ask them, each answered in 2-4 sentences including the "why."
5. **Key Takeaways (required).** Each a standalone, quotable one-liner.

## Two quality gates

- **The edge:** name what this post has that the top 5 results don't (original experience, a named framework, a specific ICP, a deeper subtopic). Can't name it? The post isn't ready.
- **One real specific per section** (general client experience, a named platform mechanism, a concrete number you actually have). **NEVER invent a data point to satisfy this — fabrication rules outrank AEO.** No percentages in Shopify app content (gets listings audited).

## Don't lose the human reader

The human must still get something an AI summary wouldn't: a usable checklist, a worked example, or a sharp opinion. AEO structure is the skeleton, not the substance.
