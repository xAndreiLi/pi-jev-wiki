# architecture

| Page | Type | Tags | Summary | Updated |
|------|------|------|---------|---------|
| [Adjudication policy computed in code](architecture/adjudication-policy.md) | architecture/layer | adjudication thresholds policy jev | Thresholds and composite scores are computed in code, making Jev verdicts advisory and policy changes model-free. | 2026-09-20 |
| [Capture flow](architecture/flow-capture.md) | architecture/flow | capture insights workflow | At the end of work, the agent composes an insight list with evidence pointers; Jev filters and places each insight, and the agent writes the resulting updates. | 2026-09-19 |
| [Claim schema drift between the skill and code](architecture/gotcha-skill-schema-drift.md) | gotcha | skill schema claims lifecycle frontmatter | Historical: the llm-wiki skill was the only documentation of the page-claim schema and its status list had drifted from the code; SKILL.md now documents needs_recheck, reviewed, last_checked, needs_review, the YAML subset, and the rule to update it alongside the code. | 2026-09-20 |
| [pi extension module](architecture/module-pi-extension.md) | architecture/module | pi-extension architecture wiki | Owns staging, Jev adjudication, placement, and TOC/log bookkeeping for the project wiki. | 2026-09-19 |
| [Structure coverage check](architecture/structure-coverage.md) | architecture/layer | structure coverage wiki documentation | How the structure scanner decides whether a module is documented in the wiki, using both name matching and file references to avoid false undocumented reports. | 2026-09-19 |
| [Table of contents hierarchy](architecture/table-of-contents.md) | architecture/module | toc index architecture scalability | The wiki maintains two TOC files — index.md as the complete machine catalog and toc.md as the compact agent-facing view with per-topic tables under toc/. | 2026-09-19 |
