---
title: Package-scoped granular tokens cannot create new npm packages
type: invariant
topic: invariants
summary: A package-scoped granular access token cannot create a new package name on npm; the 'All Packages' permission is required for initial package creation.
tags: [npm, tokens, publishing, granular]
updated: 2026-09-20
sources: [raw/releasing/2026-09-20-releasing.md]
claims:
  - id: c1
    text: "Package-scoped granular tokens cannot create new package names; 'All Packages' permission is required for initial package creation."
    status: accepted
    support: 0.87
    evidence: [raw/releasing/2026-09-20-releasing.md]
files: []
---

# Package-scoped granular tokens cannot create new npm packages

**Statement.** When creating a granular access token on npm, selecting a specific package scope or individual packages prevents the token from creating a brand-new package name. Only the **All Packages** permission level allows initial package creation.

**Why it exists.** npm restricts package creation to tokens with broad enough scope to prevent accidental or malicious registration of unrelated package names from narrowly scoped credentials.

**Where it is enforced.** npmjs.com Access Tokens generation form (step "Select Packages") and the `npm publish` CLI when a package-scoped token is used against a non-existent package name.

**What breaks if violated.** A CI workflow using a package-scoped granular token will fail on the very first publish of a new package name with an authorization error, even if all other permissions are correct.

**How to verify.** Create a granular token scoped to a single existing package and attempt `npm publish` for a never-before-published name; the registry will reject it.

## Related

- [OIDC trusted publishing requires an existing package](../invariants/oidc-requires-existing-package.md)
