---
title: package.json repository fields must point to the real repo before publishing
type: invariant
topic: invariants
summary: The repository, homepage, and bugs fields in package.json must point at the real repository before publishing to npm.
tags: [npm, package.json, publishing, metadata]
updated: 2026-09-20
sources: [raw/releasing/2026-09-20-releasing.md]
claims:
  - id: c1
    text: "The repository, homepage, and bugs fields in package.json must point at the real repository before publishing."
    status: accepted
    support: 0.80
    evidence: [raw/releasing/2026-09-20-releasing.md]
files:
  - package.json
---

# package.json repository fields must point to the real repo before publishing

**Statement.** Before publishing to npm, the `repository`, `homepage`, and `bugs` fields in `package.json` must reference the actual source repository and issue tracker. Incorrect or placeholder URLs break discoverability and downstream tooling.

**Why it exists.** npm, package managers, and automated scanners rely on these fields to link a published artifact back to its source. Provenance attestation also requires the repository URL to match the OIDC publisher identity.

**Where it is enforced.** `npm publish` (warns or errors on malformed URLs), npm registry UI, GitHub Dependabot, and security-audit tools.

**What breaks if violated.** Consumers cannot find the source repository to file issues or verify code. Provenance attestation may fail because the claimed repository does not match the OIDC publisher. Automated security scanners may flag the package.

**How to verify.** Inspect `package.json` before every release; confirm that `repository.url`, `homepage`, and `bugs.url` resolve to the real GitHub (or equivalent) repository.

## Related

- [Raw sources are immutable](../invariants/raw-immutable.md)
