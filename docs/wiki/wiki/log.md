# Wiki Log

## [2026-09-19] ingest | jev-wiki architecture notes
- Raw: raw/jev-wiki-architecture-notes/2026-09-19-jev-wiki-architecture-notes.md
- Claims: 12 (filed 9, reinforced 0)

## [2026-09-19] finalize | Ingested docs/notes/jev-wiki-overview.md and created 9 wiki pages covering decisions, invariants, architecture module, and flow.
- Updated: decisions/scope-boundary.md
- Updated: architecture/module-pi-extension.md
- Updated: invariants/jev-typed-decisions.md
- Updated: invariants/raw-immutable.md
- Updated: invariants/generated-files.md
- Updated: invariants/claim-evidence.md
- Updated: decisions/guided-writing.md
- Updated: decisions/review-escalation.md
- Updated: architecture/flow-capture.md

## [2026-09-19] capture | 3 insights
- Raw: raw/sessions/2026-09-19-session-2026-09-19-1721.md
- Filed 0 · reinforced 0 · review 0 · rejected 3

## [2026-09-19] finalize | Session 2026-09-19: three insights submitted, all rejected by Jev (unsupported/derivable). No pages created or edited.

## [2026-09-19] capture | 3 insights
- Raw: raw/sessions/2026-09-19-session-2026-09-19-1722.md
- Filed 0 · reinforced 0 · review 0 · rejected 2

## [2026-09-19] finalize | Added decision page for wiki root defaulting to docs/wiki.
- Updated: decisions/wiki-root-location.md

## [2026-09-19] capture | 3 insights
- Raw: raw/sessions/2026-09-19-session-2026-09-19-1730.md
- Filed 0 · reinforced 0 · review 0 · rejected 3

## [2026-09-19] finalize | Captured three verified insights: (1) adjudication thresholds are code-computed, not model-driven; (2) all wiki paths derive from a single resolveLayout root; (3) provider switching is configuration-only thanks to a shared System One schema.
- Updated: architecture/adjudication-policy.md
- Updated: invariants/wiki-layout-atomic-root.md
- Updated: decisions/provider-agnostic-schema.md

## [2026-09-19] sync | 2 claim(s) checked
- Baseline: 7f05448 → a627568
- Changed files: 6
- Applied: invariants/wiki-layout-atomic-root.md#c1 → needs_recheck

## [2026-09-19] finalize | Updated wiki-layout-atomic-root invariant to reflect that raw/ and wiki/ derive from wikiRoot while runtime state is independently configurable via stateRoot, which may be absolute.
- Updated: invariants/wiki-layout-atomic-root.md

## [2026-09-19] capture | 3 insights
- Raw: raw/sessions/2026-09-19-session-2026-09-19-1734.md
- Filed 0 · reinforced 0 · review 0 · rejected 3

## [2026-09-19] finalize | Captured 3 session insights about sync performance, review resolution mechanics, and headless escalation behavior. Jev initially rejected all three; agent wrote them anyway after verifying evidence in src/sync.ts, src/review.ts, and src/extension.ts.
- Updated: architecture/layer-sync-invalidation.md
- Updated: decisions/review-resolution-by-code.md
- Updated: decisions/review-escalation.md

## [2026-09-19] capture | 3 insights
- Raw: raw/sessions/2026-09-19-session-2026-09-19-1737.md
- Filed 0 · reinforced 0 · review 0 · rejected 3

## [2026-09-19] finalize | Insights session: 3 submitted, 0 accepted, 3 rejected (all derivable from code). No pages written per guided-mode instruction to only write accepted claims.

## [2026-09-19] lint | 0 added, 0 broken links, 9 unbacked claims
- Pages: 15
- TOC updated: 0 · missing files: 0
- Orphans: 7 · raw backlog: 2
- Contradiction checks: 2

## [2026-09-19] lint | 0 added, 0 broken links, 5 unbacked claims
- Pages: 15
- TOC updated: 0 · missing files: 0
- Orphans: 7 · raw backlog: 0
- Contradiction checks: 2

## [2026-09-19] lint | 0 added, 0 broken links, 5 unbacked claims
- Pages: 15
- TOC updated: 0 · missing files: 0
- Orphans: 7 · raw backlog: 0
- Contradiction checks: 2

## [2026-09-19] remove | 2 page(s)
- Reason: derivable implementation detail; rejected by the adjudication gate
- Removed: architecture/layer-sync-invalidation.md
- Removed: decisions/review-resolution-by-code.md

## [2026-09-19] finalize | Removed derivable claim c2 from review-escalation.md during maintenance pass.
- Updated: decisions/review-escalation.md

## [2026-09-19] lint | 0 added, 0 broken links, 0 unbacked claims
- Pages: 13
- TOC updated: 0 · missing files: 0
- Orphans: 5 · raw backlog: 0
- Contradiction checks: 0

## [2026-09-19] capture | 3 insights
- Raw: raw/sessions/2026-09-19-session-2026-09-19-1741.md
- Filed 0 · reinforced 0 · review 0 · rejected 3

## [2026-09-19] finalize | Session 2026-09-19: three insights submitted via wiki_insights; all rejected by Jev as not grounded in evidence. No pages written.

## [2026-09-19] capture | 3 insights
- Raw: raw/sessions/2026-09-19-session-2026-09-19-1741.md
- Filed 0 · reinforced 2 · review 0 · rejected 1

## [2026-09-19] finalize | Reinforced two claims from session insights: (1) rejection policy in guided-writing, (2) lint backstop behavior in module-pi-extension. Duplicate insight on review escalation skipped.
- Updated: decisions/guided-writing.md
- Updated: architecture/module-pi-extension.md

## [2026-09-19] capture | 1 insights (settled)
- Raw: raw/sessions/2026-09-19-session-2026-09-19-1806.md
- Filed 1 · reinforced 0 · review 0 · rejected 0

## [2026-09-19] capture | 1 insights (settled)
- Raw: raw/sessions/2026-09-19-session-2026-09-19-1806.md
- Filed 0 · reinforced 0 · review 1 · rejected 0

## [2026-09-19] finalize | Accepted user-stated decision from raw session 2026-09-19-1806.
- Updated: decisions/retry-handling-in-client.md

## [2026-09-19] finalize | Documented lint unbacked-claims behavior as a formal decision, resolving review queue item mu8xtla9-3cf8f2.
- Updated: decisions/lint-queues-unbacked-claims.md

## [2026-09-19] lint | 0 added, 0 broken links, 2 unbacked claims
- Pages: 15
- TOC updated: 0 · missing files: 0
- Orphans: 7 · raw backlog: 0
- Contradiction checks: 1

## [2026-09-19] capture | 4 insights (settled)
- Raw: raw/sessions/2026-09-19-session-2026-09-19-1808.md
- Filed 1 · reinforced 0 · review 1 · rejected 2

## [2026-09-19] lint | 0 added, 0 broken links, 2 unbacked claims
- Pages: 15
- TOC updated: 0 · missing files: 0
- Orphans: 7 · raw backlog: 0
- Contradiction checks: 1

## [2026-09-19] lint | 0 added, 0 broken links, 0 unbacked claims
- Pages: 15
- TOC updated: 0 · missing files: 0
- Orphans: 7 · raw backlog: 0
- Contradiction checks: 1

## [2026-09-19] lint | 0 added, 0 broken links, 0 unbacked claims
- Pages: 15
- TOC updated: 0 · missing files: 0
- Orphans: 7 · raw backlog: 0
- Contradiction checks: 1

## [2026-09-19] capture | 4 insights (settled)
- Raw: raw/sessions/2026-09-19-session-2026-09-19-1810.md
- Filed 0 · reinforced 2 · review 0 · rejected 2

## [2026-09-19] capture | 1 insights (tool)
- Raw: raw/sessions/2026-09-19-session-2026-09-19-1811.md
- Filed 0 · reinforced 0 · review 0 · rejected 1

## [2026-09-19] capture | 3 insights (settled)
- Raw: raw/sessions/2026-09-19-session-2026-09-19-1811.md
- Filed 0 · reinforced 0 · review 0 · rejected 3

## [2026-09-19] write | 1 page(s) (auto)
- Written: decisions/decision-rejected-claims-stay-visible-in.md

## [2026-09-19] capture | 1 insights (tool)
- Raw: raw/sessions/2026-09-19-session-2026-09-19-1812.md
- Filed 1 · reinforced 0 · review 0 · rejected 0
- Auto-written: decisions/decision-rejected-claims-stay-visible-in.md

## [2026-09-19] capture | 2 insights (settled)
- Raw: raw/sessions/2026-09-19-session-2026-09-19-1812.md
- Filed 0 · reinforced 0 · review 0 · rejected 2

## [2026-09-19] capture | 3 insights (tool)
- Raw: raw/sessions/2026-09-19-session-2026-09-19-1813.md
- Filed 0 · reinforced 0 · review 1 · rejected 2

## [2026-09-19] finalize | Added architecture page for structure coverage check after accepting review item mu8y2nex-207165. Two other insights were rejected as derivable from code.
- Updated: architecture/structure-coverage.md

## [2026-09-19] capture | 4 insights (settled)
- Raw: raw/sessions/2026-09-19-session-2026-09-19-1815.md
- Filed 1 · reinforced 0 · review 0 · rejected 3

## [2026-09-19] lint | 0 added, 0 broken links, 0 unbacked claims
- Pages: 17
- TOC updated: 0 · missing files: 0
- Orphans: 0 · raw backlog: 0
- Contradiction checks: 1 · duplicate candidates: 1

## [2026-09-19] finalize | Added claim c3 about confidence thresholds and review gates to guided-writing.md per accepted dispute mu8y439j-30d879.
- Updated: decisions/guided-writing.md

## [2026-09-19] capture | 3 insights (tool)
- Raw: raw/sessions/2026-09-19-session-2026-09-19-1904.md
- Filed 0 · reinforced 0 · review 1 · rejected 2

## [2026-09-19] finalize | wiki_insights (guided) produced 0 file/reinforce claims; 2 rejected (derivable/unsupported) and 1 held for review below threshold. No new pages to finalize.

## [2026-09-19] capture | 5 insights (settled)
- Raw: raw/sessions/2026-09-19-session-2026-09-19-1904.md
- Filed 2 · reinforced 0 · review 1 · rejected 2

## [2026-09-19] capture | 2 insights (tool)
- Raw: raw/sessions/2026-09-19-session-2026-09-19-1921.md
- Filed 1 · reinforced 0 · review 0 · rejected 1

## [2026-09-19] finalize | Add architecture/table-of-contents.md capturing the TOC hierarchy decision (index.md vs toc.md) from HARDENING.md evidence.
- Updated: architecture/table-of-contents.md

## [2026-09-19] capture | 3 insights (settled)
- Raw: raw/sessions/2026-09-19-session-2026-09-19-1922.md
- Filed 1 · reinforced 0 · review 0 · rejected 2

## [2026-09-19] sync | 7 claim(s) checked
- Baseline: a627568 → 0484128
- Changed files: 59

## [2026-09-19] capture | 5 insights (settled)
- Raw: raw/sessions/2026-09-19-session-2026-09-19-1923.md
- Filed 0 · reinforced 2 · review 0 · rejected 3

## [2026-09-20] capture | 3 insights (tool)
- Raw: raw/sessions/2026-09-20-session-2026-09-20-2012.md
- Filed 0 · reinforced 0 · review 0 · rejected 3

## [2026-09-20] finalize | All three insights were rejected by Jev (not grounded/derivable), so no pages were written or modified.

## [2026-09-20] ingest | Releasing
- Raw: raw/releasing/2026-09-20-releasing.md
- Claims: 15 (filed 4, reinforced 0)

## [2026-09-20] finalize | Ingested docs/RELEASING.md — wrote 4 accepted claims into wiki pages under invariants/ and decisions/
- Updated: invariants/oidc-requires-existing-package.md
- Updated: invariants/granular-token-all-packages.md
- Updated: invariants/package-json-repository-fields.md
- Updated: decisions/bypass-2fa-token-restrictions.md

## [2026-09-20] lint | 0 added, 0 broken links, 0 unbacked claims
- Pages: 22
- TOC updated: 0 · missing files: 0
- Orphans: 0 · raw backlog: 0
- Contradiction checks: 1 · duplicate candidates: 1

## [2026-09-20] lint | 0 added, 0 broken links, 0 unbacked claims
- Pages: 22
- TOC updated: 1 · missing files: 0
- Orphans: 0 · raw backlog: 0
- Contradiction checks: 0 · duplicate candidates: 0

## [2026-09-20] capture | 6 insights (settled)
- Raw: raw/sessions/2026-09-20-session-2026-09-20-2017.md
- Filed 0 · reinforced 0 · review 0 · rejected 6

## [2026-09-20] capture | 2 insights (tool)
- Raw: raw/sessions/2026-09-20-session-2026-09-20-2021.md
- Filed 1 · reinforced 0 · review 0 · rejected 1

## [2026-09-20] finalize | Added gotcha: gallery page is live immediately after npm publish, but browsable catalog lags due to npm search indexing. Also reported rejection of invariant claim (gallery listing via pi-package tag and preview media) for insufficient evidence.
- Updated: pi/gallery-index-lag.md

## [2026-09-20] finalize | Fixed broken internal link in pi/gallery-index-lag.md by removing reference to non-existent invariant page.
- Updated: pi/gallery-index-lag.md

## [2026-09-20] capture | 4 insights (settled)
- Raw: raw/sessions/2026-09-20-session-2026-09-20-2022.md
- Filed 1 · reinforced 1 · review 0 · rejected 2

## [2026-09-20] capture | 1 insights (tool)
- Raw: raw/sessions/2026-09-20-session-2026-09-20-2035.md
- Filed 0 · reinforced 1 · review 0 · rejected 0

## [2026-09-20] finalize | Reinforced adjudication-policy.md with claim c2 about high-importance framing being queued for confirmation instead of rejected when rated derivable, per session 2026-09-20-2035.
- Updated: architecture/adjudication-policy.md

## [2026-09-20] capture | 3 insights (settled)
- Raw: raw/sessions/2026-09-20-session-2026-09-20-2038.md
- Filed 0 · reinforced 0 · review 0 · rejected 3

## [2026-09-20] capture | 8 insights (settled)
- Raw: raw/sessions/2026-09-20-session-2026-09-20-2115.md
- Filed 1 · reinforced 0 · review 3 · rejected 4

## [2026-09-20] finalize | Ingest 2026-09-20-2115: filed the accepted gotcha on skill/claim-schema drift (c1, verified_in_repo, support 0.35). Other 3 review + 4 rejected claims not written.
- Updated: architecture/gotcha-skill-schema-drift.md

## [2026-09-20] finalize | Skill refinement: schema-accurate SKILL.md (160 lines, down from 240), 8 page templates with frontmatter skeletons; superseded the schema-drift gotcha as resolved.
- Updated: architecture/gotcha-skill-schema-drift.md

## [2026-09-20] lint | 0 added, 0 broken links, 0 unbacked claims
- Pages: 24
- TOC updated: 0 · missing files: 0
- Orphans: 0 · raw backlog: 0
- Contradiction checks: 0 · duplicate candidates: 0

## [2026-09-20] capture | 8 insights (settled)
- Raw: raw/sessions/2026-09-20-session-2026-09-20-2127.md
- Filed 0 · reinforced 0 · review 2 · rejected 6

## [2026-09-26] ingest | Knowledge pipeline (current state)
- Raw: raw/knowledge-pipeline-current/2026-09-26-knowledge-pipeline-current-state.md
- Claims: 40 (filed 2, reinforced 3)

## [2026-09-26] capture | 2 insights (tool)
- Raw: raw/sessions/2026-09-26-session-2026-09-26-2247.md
- Filed 2 · reinforced 0 · review 0 · rejected 0

## [2026-09-26] finalize | document the knowledge pipeline and the advisory verdict policy
- Updated: architecture/flow-retrieval.md
- Updated: architecture/table-of-contents.md
- Updated: architecture/flow-capture.md
- Updated: invariants/filing-boundaries.md
- Updated: decisions/decision-rejected-claims-stay-visible-in.md
- Updated: architecture/adjudication-policy.md
- Updated: decisions/guided-writing.md
- Updated: decisions/review-escalation.md
- Updated: invariants/wiki-layout-atomic-root.md

## [2026-09-26] capture | 8 insights (settled)
- Raw: raw/sessions/2026-09-26-session-2026-09-26-2250.md
- Filed 0 · reinforced 2 · review 1 · rejected 5

## [2026-09-26] capture | 2 insights (tool)
- Raw: raw/sessions/2026-09-26-session-2026-09-26-2307.md
- Filed 1 · reinforced 0 · review 0 · rejected 1

## [2026-09-26] finalize | File the one-install-source gotcha (dropped from the 2026-09-26 home-session capture) into the repo wiki with README + commit evidence
- Updated: pi/one-install-source.md

## [2026-09-26] capture | 7 insights (settled)
- Raw: raw/sessions/2026-09-26-session-2026-09-26-2308.md
- Filed 2 · reinforced 2 · review 0 · rejected 3

## [2026-09-26] finalize | Task-cadence capture from the 2026-09-26 report session: filed the cwd-relative evidence-resolution gotcha (c1) plus the quote/tool-result fallback gap (c2); corroborated the one-install-source claim. Declined two reinforce proposals: the c4 adjudication anecdote (policy already covered by adjudication-policy.md) and the wiki-layout routing rationale (decision pending, wrong page).
- Updated: architecture/gotcha-capture-evidence-resolution.md
- Updated: pi/one-install-source.md

## [2026-09-26] ingest | Session capture 2026-09-26 (home session, moved from the life wiki)
- Raw: raw/session-capture-2026-09-26/2026-09-26-session-capture-2026-09-26-home-session-moved-from-the-life.md
- Claims: 21 (filed 2, reinforced 4)

## [2026-09-26] finalize | Move-in of the two repo-specific life-wiki pages (home session capture 2026-09-26, ingested as raw/session-capture-2026-09-26/…): capture routing/gating invariant (cwd targeting + 0.6 pre-screen) and extension load timing. Corrected the moved page's generalization: config values are re-read per event, only plugin code is frozen at session start. Declined the forward-compat onSettle extrapolation and the standalone smoke-run observation (evidence, not a claim).
- Updated: invariants/capture-routing-and-gating.md
- Updated: invariants/extension-loads-at-session-start.md

## [2026-09-26] lint | 0 added, 0 broken links, 0 unbacked claims
- Pages: 30
- TOC updated: 0 · missing files: 0
- Orphans: 0 · raw backlog: 0
- Contradiction checks: 8 · duplicate candidates: 1

## [2026-09-26] capture | 3 insights (tool)
- Raw: raw/sessions/2026-09-26-session-2026-09-26-2317.md
- Filed 1 · reinforced 0 · review 1 · rejected 1

## [2026-09-26] finalize | File the embedding-progress gotcha (182 events on a cached load; progress now goes to a throttled footer status) and record shard pruning as table-of-contents.md#c8. The progress-sink policy detail stays in the gotcha body, not as a separate claim (derivable from code).
- Updated: architecture/gotcha-embedding-progress-events.md
- Updated: architecture/table-of-contents.md

## [2026-09-26] lint | 0 added, 0 broken links, 0 unbacked claims
- Pages: 31
- TOC updated: 0 · missing files: 0
- Orphans: 0 · raw backlog: 0
- Contradiction checks: 8 · duplicate candidates: 1

## [2026-09-26] capture | 8 insights (settled)
- Raw: raw/sessions/2026-09-26-session-2026-09-26-2324.md
- Filed 4 · reinforced 0 · review 1 · rejected 3

## [2026-09-26] finalize | Release-session auto-capture worked: merged the "a fix is not live until the session reloads" consequence into extension-loads-at-session-start; the embedding-progress claim and shard-pruning invariant were already filed (duplicate review item rejected). Declined three File recommendations as docs duplication: the release procedure and 0.2.0-provenance note already live in docs/RELEASING.md, which stays the single source; progress-sink and non-UI details are derivable code behavior already in the gotcha body; the gh-PATH observation is environment-specific and not grounded here.
- Updated: invariants/extension-loads-at-session-start.md

## [2026-09-26] capture | 8 insights (settled)
- Raw: raw/sessions/2026-09-26-session-2026-09-26-0008.md
- Filed 3 · reinforced 0 · review 1 · rejected 4

## [2026-09-26] capture | 1 insights (tool)
- Raw: raw/sessions/2026-09-26-session-2026-09-26-0010.md
- Filed 0 · reinforced 0 · review 0 · rejected 1

## [2026-09-26] capture | 1 insights (tool)
- Raw: raw/sessions/2026-09-26-session-2026-09-26-0010.md
- Filed 0 · reinforced 0 · review 1 · rejected 0

## [2026-09-26] finalize | File the capture-files-proposals gotcha: task-cadence extraction can label an assistant recommendation as user: evidence and Jev scores it user_stated, so a pending proposal can be filed as if the user stated it. The capture's other three accepted claims were declined: the maxPerSession display-cap fact is about to be superseded by the 0.8.0 fix, the 10.1 routing design is awaiting Andrei's decision, and the SKILL.md schema-contract rule is already documented on gotcha-skill-schema-drift.
- Updated: architecture/gotcha-capture-proposals.md

## [2026-09-26] capture | 5 insights (tool)
- Raw: raw/sessions/2026-09-26-session-2026-09-26-0025.md
- Filed 1 · reinforced 0 · review 3 · rejected 1

## [2026-09-26] finalize | File the 0.8.0 decisions with commit evidence: cross-wiki write routing (explicit per-call wiki targets; capture.route subject default with warning), the out_of_scope review disposition, the append-only/LF-normalized raw invariant merged into raw-immutable, the capture-routing invariant updated (session-directory rule superseded), and the capture-proposals gotcha annotated with its mitigation.
- Updated: decisions/cross-wiki-writes.md
- Updated: decisions/out-of-scope-disposition.md
- Updated: invariants/raw-immutable.md
- Updated: invariants/capture-routing-and-gating.md
- Updated: architecture/gotcha-capture-proposals.md

## [2026-09-26] capture | 8 insights (settled)
- Raw: raw/sessions/2026-09-26-session-2026-09-26-0029.md
- Filed 1 · reinforced 0 · review 2 · rejected 5

## [2026-09-26] finalize | Dispositioned the 0.8.0 wrap-up capture: the sole File recommendation restated decisions/out-of-scope-disposition.md#c1 (no page change), the two review items restated the cross-wiki decisions already filed, and the five rejected items were derivable code detail or transient session state. Nothing new to write.

## [2026-09-26] capture | 1 insights (tool)
- Raw: raw/sessions/2026-09-26-session-2026-09-26-0034.md
- Filed 0 · reinforced 1 · review 0 · rejected 0

## [2026-09-26] finalize | Add the token-economy policy (c4) to the adjudication-policy page: Jev tokens are cheap relative to model tokens, so agents prefer an extra Jev call over a guess; code still owns thresholds.
- Updated: architecture/adjudication-policy.md

## [2026-09-26] sync | 40 claim(s) checked
- Baseline: 0484128 → 7165a91
- Changed files: 120
- Applied: architecture/flow-capture.md#c2 → needs_recheck
- Applied: architecture/flow-retrieval.md#c14 → needs_recheck
- Applied: architecture/gotcha-capture-evidence-resolution.md#c2 → needs_recheck
- Applied: architecture/gotcha-capture-proposals.md#c1 → needs_recheck
- Applied: architecture/gotcha-skill-schema-drift.md#c1 → supersede
- Applied: architecture/table-of-contents.md#c8 → needs_recheck
- Applied: decisions/cross-wiki-writes.md#c1 → needs_recheck
- Applied: decisions/cross-wiki-writes.md#c2 → needs_recheck

## [2026-09-26] finalize | Sync/review maintenance: accepted six re-verified claims, superseded the schema-drift and proposals-gotcha claims, rejected the stale wiki_ask status claim, and added the capture.route pointer to the capture flow. Also filed the use-Jev-liberally policy on the adjudication-policy page.
- Updated: architecture/adjudication-policy.md
- Updated: architecture/flow-capture.md
- Updated: architecture/gotcha-capture-proposals.md
- Updated: architecture/gotcha-skill-schema-drift.md
- Updated: architecture/gotcha-capture-evidence-resolution.md
- Updated: architecture/flow-retrieval.md
- Updated: architecture/table-of-contents.md
- Updated: decisions/cross-wiki-writes.md

## [2026-09-26] lint | 0 added, 0 broken links, 0 unbacked claims
- Pages: 34
- TOC updated: 0 · missing files: 0
- Orphans: 0 · raw backlog: 0
- Contradiction checks: 8 · duplicate candidates: 2

## [2026-09-26] capture | 1 insights (tool)
- Raw: raw/sessions/2026-09-26-session-2026-09-26-0041.md
- Filed 1 · reinforced 0 · review 0 · rejected 0

## [2026-09-26] finalize | File the npm minor-version pin gotcha: an @latest extension update can report success while the store stays on the old minor; explicit-version updates rewrite the spec. 0.8.0 published with provenance and the installed copy updated to 0.8.0.
- Updated: pi/npm-minor-version-pin.md

## [2026-09-26] finalize | Post-release review cleanup: de-duplicated the routing policy vs invariant claims, added the packed-artifact isolation procedure to the one-install-source gotcha, and dispositioned the remaining capture/review items (one serializer item deliberately left open).
- Updated: invariants/capture-routing-and-gating.md
- Updated: pi/one-install-source.md

## [2026-09-26] capture | 8 insights (settled)
- Raw: raw/sessions/2026-09-26-session-2026-09-26-0043.md
- Filed 3 · reinforced 1 · review 1 · rejected 3

## [2026-09-26] finalize | Dispositioned the post-publish capture: all File recommendations restated already-filed pi/ claims (and reinforced them mechanically), the Jev-liberal restatement maps to adjudication-policy c4, and the review item restated cross-wiki-writes c1 (confirmed). Two release-runbook gaps it surfaced were added to docs/RELEASING.md instead.

## [2026-09-26] sync | 3 claim(s) checked
- Baseline: 7165a91 → afbcc1a
- Changed files: 25

## [2026-09-26] capture | 8 insights (settled)
- Raw: raw/sessions/2026-09-26-session-2026-09-26-004856.md
- Filed 4 · reinforced 0 · review 1 · rejected 3

## [2026-09-26] finalize | Dispositioned the fourth post-release capture: all four File recommendations restated already-filed pi/ claims (mechanically reinforced to 3–4×) or duplicated docs/RELEASING.md, which stays the release single source; the review item restated the out-of-scope disposition decision (confirmed). No pages changed.

## [2026-09-26] capture | 5 insights (settled)
- Raw: raw/sessions/2026-09-26-session-2026-09-26-005931.md
- Filed 4 · reinforced 0 · review 0 · rejected 1

## [2026-09-26] finalize | File the finalize-before-decisions decision (user-stated, with Andrei's words): wiki writes and finalize complete before the task-ending response, decisions last, no maintenance narration after them. Other capture items were restatements or pending (capture.cadence: commit is still undecided).
- Updated: decisions/finalize-before-decisions.md

## [2026-09-26] capture | 2 insights (tool)
- Raw: raw/sessions/2026-09-26-session-2026-09-26-010608.md
- Filed 0 · reinforced 0 · review 2 · rejected 0

## [2026-09-26] finalize | File the 0.8.1 decisions with commit evidence: auto-capture delivery is advisory and cannot start a turn (c2 on finalize-before-decisions), and wiki_review resolutions verify the claim status after the serializer round-trip (new decisions/review-round-trip-verification.md, closing the long-open serializer item).
- Updated: decisions/finalize-before-decisions.md
- Updated: decisions/review-round-trip-verification.md

## [2026-09-28] sync | 35 claim(s) checked
- Baseline: afbcc1a → fd88e40
- Changed files: 24
- Applied: architecture/flow-capture.md#c2 → needs_recheck
- Applied: architecture/gotcha-skill-schema-drift.md#c1 → supersede

## [2026-09-28] remove | 1 page(s)
- Reason: Duplicate of decisions/lint-queues-unbacked-claims.md: Jev's duplicate check scored similarity 1 / same 0.90 (ledger 2026-09-19 and 2026-09-20) and recommended consolidate. The page's title ("Retry Handling in Client") never matched its lint-queue content, and the surviving page carries the same decision plus implementation detail. Its claim is restored to user-stated and the history note records the consolidation.
- Removed: decisions/retry-handling-in-client.md

## [2026-09-28] lint | 0 added, 0 broken links, 0 unbacked claims
- Pages: 36
- TOC updated: 4 · missing files: 0
- Orphans: 5 · raw backlog: 0
- Contradiction checks: 8 · duplicate candidates: 1

## [2026-09-28] lint | 0 added, 0 broken links, 0 unbacked claims
- Pages: 36
- TOC updated: 0 · missing files: 0
- Orphans: 0 · raw backlog: 0
- Contradiction checks: 8 · duplicate candidates: 1

## [2026-09-28] finalize | Hardening pass: sync baseline caught up (afbcc1a→fd88e40) and both impacts resolved; module-pi-extension refreshed to the 15-tool surface and key-file map; corrupted retry-handling-in-client duplicate removed and lint-queues-unbacked-claims repaired (canonical claim restored to user-stated); five orphan pages wired in; lint clean.
- Updated: architecture/module-pi-extension.md
- Updated: architecture/table-of-contents.md
- Updated: decisions/lint-queues-unbacked-claims.md
- Updated: decisions/bypass-2fa-token-restrictions.md
- Updated: invariants/oidc-requires-existing-package.md

## [2026-10-01] capture | 4 insights (tool)
- Raw: raw/sessions/2026-10-01-session-2026-10-01-014049.md
- Filed 0 · reinforced 0 · review 1 · rejected 3

## [2026-10-01] capture | 3 insights (tool)
- Raw: raw/sessions/2026-10-01-session-2026-10-01-014102.md
- Filed 1 · reinforced 0 · review 0 · rejected 2

## [2026-10-01] capture | 2 insights (tool)
- Raw: raw/sessions/2026-10-01-session-2026-10-01-014110.md
- Filed 1 · reinforced 0 · review 0 · rejected 1
- Promoted 1 recurring candidate(s) to review

## [2026-10-01] capture | 1 insights (tool)
- Raw: raw/sessions/2026-10-01-session-2026-10-01-014120.md
- Filed 0 · reinforced 0 · review 0 · rejected 1

## [2026-10-01] capture | 1 insights (tool)
- Raw: raw/sessions/2026-10-01-session-2026-10-01-014128.md
- Filed 0 · reinforced 0 · review 0 · rejected 1

## [2026-10-01] finalize | Added the efficacy-measurement substrate and the rediscovery-metric decision while writing docs/plans/EFFICACY.md (measurement plan: instruments, history-replay tasks, arms, statistics, kill criteria).
- Updated: architecture/flow-eval-substrate.md
- Updated: decisions/eval-mechanism-metric.md

## [2026-10-01] finalize | Corrected a wrong explanation on the eval-substrate page: four evidence rejections were caused by unresolved file refs that the brief does not report, not by Jev being unable to ground installed-package citations. Full bug report in handoffs/2026-10-01-search-fallback-and-evidence-diagnostics.md.
- Updated: architecture/flow-eval-substrate.md

## [2026-10-01] capture | 2 insights (tool)
- Raw: raw/sessions/2026-10-01-session-2026-10-01-015135.md
- Filed 1 · reinforced 0 · review 1 · rejected 0

## [2026-10-01] finalize | Recorded the silent-search-degradation gotcha and the decision to preserve the corrupt index for a triage session, plus the handoff's friction log.
- Updated: architecture/gotcha-silent-search-degradation.md

## [2026-10-01] capture | 3 insights (tool)
- Raw: raw/sessions/2026-10-01-session-2026-10-01-020321.md
- Filed 0 · reinforced 0 · review 2 · rejected 1

## [2026-10-01] finalize | Documented the pi-wiki-eval measurement package (module page + the decision to ship it separately) alongside the implementation in packages/pi-wiki-eval.
- Updated: architecture/module-pi-wiki-eval.md
- Updated: decisions/eval-separate-package.md

## [2026-10-01] capture | 3 insights (tool)
- Raw: raw/sessions/2026-10-01-session-2026-10-01-021352.md
- Filed 2 · reinforced 0 · review 0 · rejected 1

## [2026-10-01] finalize | R0 complete: study document at docs/studies/R0-retrospective.md; corrected the consultation metric (read vs maintenance) in the tool and in every doc that carried the old 93% figure; recorded the maintenance/consultation gotcha and extended the rediscovery decision with its code-wiki scope limit.
- Updated: architecture/gotcha-wiki-consultation-vs-maintenance.md
- Updated: decisions/eval-mechanism-metric.md
- Updated: architecture/module-pi-wiki-eval.md

## [2026-10-01] capture | 2 insights (tool)
- Raw: raw/sessions/2026-10-01-session-2026-10-01-032158.md
- Filed 0 · reinforced 0 · review 1 · rejected 1

## [2026-10-01] finalize | Documented the A/B evaluation harness (invariants, the local-vs-global pi finding, what the pilot measures) alongside the implementation in eval/.
- Updated: architecture/eval-harness.md

## [2026-10-01] finalize | Added the branch-per-task convention for the experiment and the wiki-side invalidation hazard (a page about a task written before it runs) to the harness page, matching the handoff committed in discord-assistant as 0a2acac.
- Updated: architecture/eval-harness.md

## [2026-10-01] finalize | Hardened the A/B harness for fairness: per-arm agent directories so the control differs only by the wiki (verified 10 shared tools + 15 wiki-only), a tool-loadout equality gate that refuses confounded runs, sparse-checkout for a clean control tree, dependency handling, grader restoration from the target commit, and a required pinned model; added eval/selftest.mjs (22 checks, no model calls) and the brief arm. Documented in the harness page and in the discord-assistant handoff (commit 0f05e6c).
- Updated: architecture/eval-harness.md

## [2026-10-01] capture | 2 insights (tool)
- Raw: raw/sessions/2026-10-01-session-2026-10-01-041916.md
- Filed 0 · reinforced 0 · review 0 · rejected 2

## [2026-10-01] capture | 2 insights (tool)
- Raw: raw/sessions/2026-10-01-session-2026-10-01-041934.md
- Filed 0 · reinforced 1 · review 1 · rejected 0

## [2026-10-01] finalize | E1 pilot rehearsal complete: study document docs/studies/E1-pilot-2026-10-01.md, the controlled evidence merged into the consultation-vs-maintenance page, and the measured paired SD added to the harness page as provisional.
- Updated: architecture/gotcha-wiki-consultation-vs-maintenance.md
- Updated: architecture/eval-harness.md

## [2026-10-01] capture | 1 insights (tool)
- Raw: raw/sessions/2026-10-01-session-2026-10-01-042945.md
- Filed 0 · reinforced 0 · review 0 · rejected 1

## [2026-10-01] finalize | Recorded Andrei's hypothesis that the wiki pays for itself on harder tasks and the resulting direction to cut maintenance cost, from the first pilot's brief-arm numbers.

## [2026-10-01] capture | 10 insights (tool)
- Raw: raw/sessions/2026-10-01-session-2026-10-01-060004.md
- Filed 1 · reinforced 0 · review 2 · rejected 7

## [2026-10-01] finalize | Validity audit of the A/B harness, from r1-run-2026-10-01T08-44-45 (in flight, 17/32) and the E1 pilot. Ten leak and measurement defects went into one gotcha page; eval-harness and consultation-vs-maintenance now carry caveats that E1/R1 numbers are not evidence about the wiki.
- Updated: architecture/gotcha-eval-harness-leaks.md
- Updated: architecture/eval-harness.md
- Updated: architecture/gotcha-wiki-consultation-vs-maintenance.md

## [2026-10-01] capture | 7 insights (tool)
- Raw: raw/sessions/2026-10-01-session-2026-10-01-070617.md
- Filed 2 · reinforced 2 · review 2 · rejected 1

## [2026-10-01] finalize | Eval harness hardened (uncommitted, after 77b33da). Neutral temp copies and agent dirs with no registry or user context; graders installed after the agent; canaries plus a session contamination scan; read-only wiki-nocapture; blind code-only judge with samples; four-contrast log-ratio report. The self-test drives the real runner and judge with a stub pi (111 checks; three R1 defects reintroduced are each caught). New gotcha page: sparse checkout clears skip-worktree.
- Updated: architecture/eval-harness.md
- Updated: architecture/gotcha-eval-harness-leaks.md
- Updated: architecture/gotcha-sparse-checkout-skip-worktree.md

## [2026-10-02] capture | 1 insights (tool)
- Raw: raw/sessions/2026-10-02-session-2026-10-02-233340.md
- Filed 1 · reinforced 0 · review 0 · rejected 0

## [2026-10-02] finalize | Authored ds-009 (screenshot capability for 苏睿聆: real-capture grader, forward card, base d77f7f5) and its grader. First single-task run on the hardened harness, s1-run-2026-10-02T03-17-34: valid and clean, all three arms passed; off $0.054/226s, brief $0.043/154s, wiki $0.133/446s with 8 Jev calls, 2 wiki reads and 16 writes. n=1 — no effect read. The gitignored-AGENTS.md trap that the card nearly shipped is captured in the new gotcha page.
- Updated: architecture/gotcha-eval-cards-ignored-files.md

## [2026-10-02] capture | 1 insights (tool)
- Raw: raw/sessions/2026-10-02-session-2026-10-02-002535.md
- Filed 0 · reinforced 0 · review 0 · rejected 1

## [2026-10-02] capture | 1 insights (tool)
- Raw: raw/sessions/2026-10-02-session-2026-10-02-002551.md
- Filed 0 · reinforced 0 · review 0 · rejected 1

## [2026-10-02] finalize | Recorded the corrupt-vector-store incident and its recovery: delete ~/.pi/agent/jev-wiki/vector and rebuild all seven wikis (1,385 chunks). Overrode Jev's reject_unsupported because the evidence is reproduced runtime output — the panic from a direct PGlite probe, the denied rename, the successful deletion and the per-wiki rebuild reports — which the groundedness check does not accept as evidence; no pre-existing file can state an incident that happened in this session, and the claim links to gotcha-silent-search-degradation.md.
- Updated: architecture/gotcha-corrupt-vector-store-recovery.md

## [2026-10-02] sync | 26 claim(s) checked
- Baseline: fd88e40 → 12a88a3
- Changed files: 103
- Applied: architecture/eval-harness.md#c1 → needs_recheck
- Applied: architecture/eval-harness.md#c3 → needs_recheck
- Applied: architecture/gotcha-eval-harness-leaks.md#c1 → needs_recheck
- Applied: architecture/gotcha-eval-harness-leaks.md#c2 → needs_recheck
- Applied: architecture/gotcha-eval-harness-leaks.md#c3 → needs_recheck
- Applied: architecture/gotcha-eval-harness-leaks.md#c4 → needs_recheck
- Applied: architecture/gotcha-eval-harness-leaks.md#c7 → needs_recheck
- Applied: architecture/gotcha-eval-harness-leaks.md#c8 → needs_recheck
- Applied: architecture/gotcha-eval-harness-leaks.md#c9 → needs_recheck
- Applied: architecture/gotcha-eval-harness-leaks.md#c10 → needs_recheck

## [2026-10-02] finalize | Maintenance pass close-out. wiki_sync fd88e40→12a88a3: 103 files, 26 matched claims, 10 needs_recheck queued (all in the eval-harness and leak pages, to be read against the post-audit fixes). Updated gotcha-silent-search-degradation (corrected the obsolete 'do not rebuild' state; added the wiki_ask scope-parameter trap), gotcha-corrupt-vector-store-recovery (a Before-deleting warning about preserved artefacts), and invariants/claim-evidence (incident claims need a source quote from the session raw). Pain points from the whole maintenance are written up in handoffs/2026-10-02-maintenance-pain-points.md: the preserved-store deletion, the silent wiki_ask scope, cross-wiki finalize paths, incident-claim grounding, blocking rebuilds, and the sync backlog.
- Updated: architecture/gotcha-silent-search-degradation.md
- Updated: architecture/gotcha-corrupt-vector-store-recovery.md
- Updated: invariants/claim-evidence.md

## [2026-10-04] capture | 3 insights (tool)
- Raw: raw/sessions/2026-10-04-session-2026-10-04-181406.md
- Filed 2 · reinforced 0 · review 0 · rejected 1

## [2026-10-04] capture | 1 insights (tool)
- Raw: raw/sessions/2026-10-04-session-2026-10-04-181435.md
- Filed 0 · reinforced 0 · review 1 · rejected 0

## [2026-10-04] finalize | Recorded the auto-retrieval decision (inject by default, Jev-gated, session-wiki-only, fail-closed, op:auto) and the pi before_agent_start injection mechanism it rests on. Amended PLAN §0/§4.1 and CRITIQUE §1.10 from "no injection" to "no ungated injection". Implemented in src/auto-retrieve.ts + hooks.autoRetrieve; unit/integration/vector suites pass, no live Jev call made.
- Updated: decisions/auto-retrieval-injection.md
- Updated: pi/before-agent-start-injection.md

## [2026-10-08] capture | 2 insights (tool)
- Raw: raw/sessions/2026-10-08-session-2026-10-08-065156.md
- Filed 0 · reinforced 0 · review 1 · rejected 1

## [2026-10-08] capture | 2 insights (tool)
- Raw: raw/sessions/2026-10-08-session-2026-10-08-065213.md
- Filed 1 · reinforced 0 · review 0 · rejected 1

## [2026-10-08] capture | 1 insights (tool)
- Raw: raw/sessions/2026-10-08-session-2026-10-08-065227.md
- Filed 1 · reinforced 0 · review 0 · rejected 0

## [2026-10-08] finalize | New gotcha: PGlite 0.5.8 locks nothing and the store is opened at session_start / closed at session_shutdown, so concurrent sessions are unguarded openers. Filed under architecture/ with the other PGlite and vector pages rather than the suggested new gotchas/ or invariants/ topics; cross-linked from the corrupt-store recovery page.
- Updated: architecture/gotcha-vector-store-single-owner.md
- Updated: architecture/gotcha-corrupt-vector-store-recovery.md

## [2026-10-08] capture | 3 insights (tool)
- Raw: raw/sessions/2026-10-08-session-2026-10-08-070016.md
- Filed 1 · reinforced 0 · review 2 · rejected 0

## [2026-10-08] finalize | New page with the pre-swap measurements: SQLite store constraints (short-lived connections for resettability, busy_timeout before WAL, local-FS requirement, missing store must read as empty) and the candidate cost comparison against PGlite at the real corpus size, plus the per-session model cost. Filed under architecture/ to sit with the other index pages rather than the suggested new gotchas/ topic. Measurements are marked needs_review since they are machine- and corpus-specific; the ranking-equivalence check is named as the outstanding test.
- Updated: architecture/vector-store-swap-constraints.md

## [2026-10-08] capture | 3 insights (tool)
- Raw: raw/sessions/2026-10-08-session-2026-10-08-070753.md
- Filed 2 · reinforced 0 · review 1 · rejected 0

## [2026-10-08] finalize | Recorded the two decisions from 2026-10-08: the index store moves to SQLite with per-operation connections (merged into architecture/vector-store-swap-constraints.md, which now carries the decision and a pointer to docs/plans/INDEX-SERVICE.md), and one shared embedder process with an explicit fingerprint identity (new decisions/shared-embedder-parity.md, placed under decisions/ with the other decision records rather than the suggested architecture/ topic).
- Updated: architecture/vector-store-swap-constraints.md
- Updated: decisions/shared-embedder-parity.md

## [2026-10-08] capture | 4 insights (tool)
- Raw: raw/sessions/2026-10-08-session-2026-10-08-074620.md
- Filed 1 · reinforced 0 · review 0 · rejected 3

## [2026-10-08] finalize | Implementation record. New page: the shared embedder's two singleton traps (a pipe name is not a single instance on Windows; the pipe hash needs a canonicalised agent dir) plus the batch-retry fix, and the migration's verified numbers. Updated to historical: gotcha-vector-store-single-owner and gotcha-corrupt-vector-store-recovery (PGlite is gone). vector-store-swap-constraints carries the outcome section; decisions/shared-embedder-parity notes it is implemented. Overrides: Jev called the two pipe traps derivable from code — the code shows the fixes, but not the platform behaviour that made them necessary (empirically observed: two daemons, ~2,400 CPU-seconds spent, one pipe name), so they are recorded here with the command evidence rather than dropped.
- Updated: architecture/gotcha-embedder-restarts.md
- Updated: architecture/gotcha-vector-store-single-owner.md
- Updated: architecture/gotcha-corrupt-vector-store-recovery.md
- Updated: architecture/vector-store-swap-constraints.md
- Updated: decisions/shared-embedder-parity.md

## [2026-10-08] finalize | Post-release doc fix: the user-facing text pointed installers at `npm run rebuild`, which is not shipped (scripts/ is outside package `files`), so it now names `wiki_index action=rebuild all=true` and keeps the script as the checkout equivalent. Also verified the published 1.0.0 artifact: tarball contains src/vector/sqlite.ts and src/vector/embedder/*, engines >=22.13, no pglite anywhere in the manifest.
- Updated: architecture/gotcha-corrupt-vector-store-recovery.md

## [2026-10-08] capture | 2 insights (tool)
- Raw: raw/sessions/2026-10-08-session-2026-10-08-080652.md
- Filed 0 · reinforced 0 · review 1 · rejected 1

## [2026-10-08] finalize | Recorded the 1.0.0 installed-copy failure: the daemon entry was TypeScript under node_modules, where Node refuses to strip types (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), so every npm install had no semantic search while the suite stayed green. Page documents the symptom, the cause, the jiti shim fix, and the new npm run test:install gate. Jev scored the "checkout-green proves nothing about an installed package" claim below the auto-accept threshold and called the type-stripping fact derivable; the first is filed as the page's claim at its real support, the second is kept as prose with the literal error as evidence, since the restriction is Node behaviour rather than something the code reveals.
- Updated: architecture/gotcha-installed-copy-cannot-spawn.md

## [2026-10-08] finalize | CI now enforces what used to depend on remembering: ci.yml runs the integration, vector and installed-copy suites on every push and pull request (it ran typecheck, unit and scale only), and publish.yml runs the installed-copy test before publishing a tag. The embedding model is cached between runs; install-test.ts takes JEV_WIKI_MODELS_DIR so CI can point it at that cache and use a plain symlink off Windows. RELEASING.md records the gate as CI-enforced rather than a pre-release habit.
- Updated: architecture/gotcha-installed-copy-cannot-spawn.md

## [2026-10-08] capture | 5 insights (tool)
- Raw: raw/sessions/2026-10-08-session-2026-10-08-092138.md
- Filed 2 · reinforced 0 · review 2 · rejected 1

## [2026-10-08] finalize | Autonomy realization. New: architecture/flow-maintenance.md (the maintenance loop as six stages — only the write stage needs an agent — bounded by the escalation and failure boundaries), decisions/writer-default-mode.md (draft as the writer default; auto is verified, not assumed), invariants/failure-loop-safety.md (persisted guards, timestamps advanced on failure, circuit breaker on non-retryable errors, incremental sync progress). Merged rather than duplicated: scope-boundary.md gains the positive half of the scope policy (the wiki is a conceptual state space and a decisioning history) alongside its existing exclusion, and review-escalation.md gains the explicit list of agent-owned upkeep next to its existing escalation rule. The detailed work items, the live capture retry-storm defect, and the draft-vs-auto verification protocol live in docs/plans/AUTONOMY.md — deliberately not in the wiki, since implementation status is a snapshot rather than conceptual knowledge.
- Updated: architecture/flow-maintenance.md
- Updated: decisions/writer-default-mode.md
- Updated: invariants/failure-loop-safety.md
- Updated: decisions/scope-boundary.md
- Updated: decisions/review-escalation.md

## [2026-10-09] capture | 2 insights (tool)
- Raw: raw/sessions/2026-10-09-session-2026-10-09-044802.md
- Filed 0 · reinforced 0 · review 0 · rejected 2

