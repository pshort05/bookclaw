# Developer documentation

Start at the top-level **[DEVELOPER.md](../../DEVELOPER.md)** — development direction, feature set, engineering standards, and the full index. The files here are the technical references it links.

Technical references for developers working on BookClaw and for training Claude on other systems.

- [BOOK-CONTAINER-ARCHITECTURE.md](BOOK-CONTAINER-ARCHITECTURE.md) — the book-as-container data model, the `book.json` manifest fields, and the phased roadmap.
- [CANON-DRIVEN-PIPELINE.md](CANON-DRIVEN-PIPELINE.md) — canon-driven pipeline design mapped onto BookClaw (source PDF alongside).
- [GOD-CLASS-REFACTOR.md](GOD-CLASS-REFACTOR.md) — decomposition of the former `index.ts` / `routes.ts` god classes.
- [AUTHOR-PROFILES-REFERENCE.md](AUTHOR-PROFILES-REFERENCE.md) — reusable author/voice profile catalog.
- [GENRE-GUIDE-TEMPLATE.md](GENRE-GUIDE-TEMPLATE.md) — genre-guide schema/template.
- [PREMISE-TEMPLATE.md](PREMISE-TEMPLATE.md) — parse-friendly premise-document template.

Per-feature **design specs** and **implementation plans** live in [`../superpowers/`](../superpowers/) (`specs/` + `plans/`) — the brainstorming → writing-plans records for every feature, kept at the skills' canonical write path.

See also the public system overview in [../ARCHITECTURE.md](../ARCHITECTURE.md).
