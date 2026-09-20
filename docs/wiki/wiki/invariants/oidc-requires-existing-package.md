---
title: OIDC trusted publishing requires an existing npm package
type: invariant
topic: invariants
summary: A trusted publisher (OIDC) can only be configured on a package that already exists on the npm registry; staged publishing explicitly cannot create a brand-new package.
tags: [npm, publishing, oidc, provenance]
updated: 2026-09-20
sources: [raw/releasing/2026-09-20-releasing.md]
claims:
  - id: c1
    text: "Trusted publishing (OIDC) requires the package to already exist on npm; staged publishing cannot create a brand-new package."
    status: accepted
    support: 0.94
    evidence: [raw/releasing/2026-09-20-releasing.md]
files: []
---

# OIDC trusted publishing requires an existing npm package

**Statement.** A trusted publisher via OpenID Connect (OIDC) can only be configured on a package that already exists on the npm registry. Staged publishing explicitly cannot create a brand-new package using OIDC.

**Why it exists.** npm's OIDC trusted-publishing mechanism binds a publisher identity to an existing package. There is no path to bootstrap a brand-new package into existence via OIDC alone.

**Where it is enforced.** npm registry web UI (package Settings → Trusted Publisher) and the publish CLI when using `--provenance` with an OIDC-backed workflow.

**What breaks if violated.** CI publishes for a never-before-published package will fail because the trusted-publisher relationship has not been established. The package must be created first via an interactive or token-based publish.

**How to verify.** Attempt to add a trusted publisher on npmjs.com for a package name that does not yet exist; the UI will refuse or the publish will error.

## Related

- [Granular tokens require All Packages for initial creation](../invariants/granular-token-all-packages.md)
