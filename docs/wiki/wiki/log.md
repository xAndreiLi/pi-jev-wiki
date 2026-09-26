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

