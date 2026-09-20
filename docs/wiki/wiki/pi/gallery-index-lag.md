---
title: Gallery page is live before browsable catalog
type: gotcha
topic: pi
summary: "A package's pi.dev gallery page appears immediately after npm publish, but the browsable catalog can lag by hours because it is built from npm's search index."
tags: [npm, gallery, publishing, pi-package]
updated: 2026-09-20
sources: [raw/pi/2026-09-20-session-2026-09-20-2021.md]
claims:
  - id: c1
    text: "A package's pi.dev gallery page is live as soon as the package exists on npm, while the browsable catalog lags new publications because it is built from npm search indexing."
    status: verified
    support: 0.97
    evidence: [raw/pi/2026-09-20-session-2026-09-20-2021.md, docs/RELEASING.md]
    corroborations: 2
    last_confirmed: 2026-09-20
files: []
---


# Gallery page is live before browsable catalog

**Symptom.** Immediately after publishing a new pi-package to npm, the direct per-package URL on pi.dev works, but the package does not show up in the searchable gallery catalog.

**Cause.** The per-package page is generated live from the npm registry, while the browsable catalog is built from npm's search index, which can lag a new publication by hours.

**Avoidance.** Do not rely on the browsable catalog for immediate verification after publish. Use the direct per-package URL or wait for npm search indexing to catch up.

**Detection.** Check the direct pi.dev package URL right after publish; if it renders but the catalog search does not find it, you are experiencing normal npm search lag.

**Related.**
- Gallery listing via `pi-package` tag and preview media (`pi.image`/`pi.video`) was proposed but rejected from the wiki for insufficient evidence.
