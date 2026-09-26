# Releasing

## Current state (2026-09-26)

- **Published:** `pi-jev-wiki@0.5.0` by CI with **SLSA provenance** (2026-09-26). `0.2.0` was the
  manual first release and has no attestation; `0.3.0` and `0.4.0` were CI-published.
- **Release flow:** `npm run release -- <version|major|minor|patch>` verifies a clean tree, the
  changelog section, and the tag; runs the full suite; bumps, commits, and creates an **annotated**
  tag. Then `git push origin main --follow-tags` — CI runs `npm run test:all` and publishes on the
  tag. Lightweight tags are not pushed by `--follow-tags`, so always use annotated tags.
- **CI auth:** verified end-to-end. `.github/workflows/publish.yml` authenticates with the
  `NPM_TOKEN` secret (a granular access token with **Bypass two-factor authentication** checked),
  publishes with provenance, and skips versions that are already on the registry.
- **Next improvement:** migrate to trusted publishing (OIDC) so no long-lived token is needed. See
  Path B.

> **npm removed classic tokens in December 2025.** "Classic → Automation" no longer exists, and
> `npm token list` labels granular tokens by permission ("Publish token"), not by token type. A
> granular token can publish in CI only if **Bypass two-factor authentication** was checked at
> creation; without it the token requires an interactive challenge and CI fails with `EOTP`. That
> capability is scheduled for removal for direct publishing in January 2027.

## Path A — interactive publish (used for 0.2.0)

`npm login` creates a two-hour session, and publishing requires a 2FA challenge (a security
key/passkey, or an authenticator app OTP). From the project root:

```bash
npm login
npm publish            # add --otp <code> only if your account has an authenticator app
```

This publishes without provenance, so prefer the tag workflow for anything after 0.2.0. Note that
npm's `EOTP` wording mentions an authenticator even for passkey accounts, which have no OTP.

## Path B — trusted publishing (OIDC), recommended next

1. The first version must already exist (0.2.0 is published), because a trusted publisher is
   configured on an existing package and staged publishing explicitly cannot create a brand-new
   package.
2. On npmjs.com open the package → **Settings → Trusted Publisher** → **GitHub Actions**:
   - Organization or user: `xAndreiLi`
   - Repository: `pi-jev-wiki`
   - Workflow filename: `publish.yml`
   - Allowed actions: enable direct publishing (`npm publish`)
3. Update `.github/workflows/publish.yml`: drop `NODE_AUTH_TOKEN`, add a step to install a current
   npm before publishing (`npm install -g npm@^11.5.1`) because Node 22 ships npm 10, which predates
   OIDC publishing, and keep `id-token: write`. The `NPM_TOKEN` secret can then be deleted.
4. Push a version tag. The workflow publishes with provenance and no secrets.

## Fallback — granular access token with Bypass 2FA (until January 2027)

Create at **Access Tokens → Generate New Token**:

- Token name/description: e.g. `pi-jev-wiki CI`
- **Bypass two-factor authentication: checked** (step 5 on the form)
- Packages and scopes → Permissions: **Read and write (publish and stage)**
- Select Packages: **All Packages** (a package-scoped token cannot create a new package name)
- Expiration: at least one day in the future

Store it as the `NPM_TOKEN` repository secret. Since August 2026 bypass-2FA tokens cannot perform
account or package-governance actions, and direct publishing with them is scheduled to be removed
in January 2027.

## Pre-release checks

- Confirm the current registry version: `npm view pi-jev-wiki version`.
- Confirm `repository`, `homepage`, and `bugs` in `package.json` point at the real repository.

## Release checklist

1. Update `CHANGELOG.md` with the release notes and commit it.
2. Run `npm run release -- <version|major|minor|patch>`. It verifies a clean tree, the changelog
   section, and that the tag does not exist; runs the full suite; bumps `package.json`; commits
   `chore(release): X`; and creates an annotated `vX.Y.Z` tag. (`npm version` by hand also works but
   skips the clean-tree and changelog checks, and only annotated tags are pushed by
   `--follow-tags`.)
3. Inspect the tarball: `npm pack --dry-run` — expect 34+ files, only `src/`, `skills/`,
   `README.md`, `CHANGELOG.md`, and `LICENSE` (plus `package.json`).
4. Smoke-test the packed artifact:
   ```bash
   tmp=$(mktemp -d) && npm pack --pack-destination "$tmp"
   mkdir -p "$tmp/pkg" && tar -xzf "$tmp"/pi-jev-wiki-*.tgz -C "$tmp/pkg"
   pi -e "$tmp/pkg/package" -p "Call wiki_status and report the provider and wiki root."
   ```
5. Publish: `git push origin main --follow-tags` runs `.github/workflows/publish.yml` (full suite +
   `npm publish --provenance`). The workflow can also be run manually from the Actions tab
   (`workflow_dispatch`), but it skips versions that already exist, so a version bump is required
   for it to publish.
6. Create a GitHub release from the tag with the changelog section, then record the release in the
   repository with a `docs(release)` commit.

## Gallery listing

The [pi package gallery](https://pi.dev/packages) is **automatic**: npm packages carrying the
`pi-package` keyword (plus a `pi` manifest or conventional directories) are indexed. There is no
submission step and no form — the only contact path is the per-package "report" link, which opens an
issue on `earendil-works/pi`.

The per-package page is generated from the registry and is live as soon as the package exists:
<https://pi.dev/packages/pi-jev-wiki>. The browsable catalog is built from npm's **search index**,
which can lag a new publication by hours (npm search does not return a brand-new package
immediately). Until then the catalog's "Recently published" list and client-side filter will not
show it.

Optional preview metadata in `package.json` makes the gallery card richer:

```json
{
  "pi": {
    "extensions": ["./src/extension.ts"],
    "skills": ["./skills"],
    "image": "https://example.com/preview.png"
  }
}
```

- `image`: PNG, JPEG, GIF, or WebP; shown as a static preview.
- `video`: MP4 only; takes precedence over `image`.

Verify with `pi install npm:pi-jev-wiki` after the catalog refreshes. If the package is still
missing from the catalog a day after publishing, use the package page's "report" link.

## What never ships

- `.env` (gitignored and unlisted), `docs/`, `research/`, `scripts/`, `.pi/`, `node_modules/`.
  The `files` whitelist in `package.json` is the single source of truth.

## After publishing

- Verify the gallery entry: `pi install npm:pi-jev-wiki`, then `pi -e npm:pi-jev-wiki` for a throwaway run.
- Confirm the published README renders and the pi manifest (`extensions`, `skills`) resolves.
