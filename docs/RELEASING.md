# Releasing

## One-time setup

> **npm removed classic tokens in December 2025.** "Classic → Automation" no longer exists. There are
> two ways to publish, and a granular token with a **Bypass two-factor authentication** checkbox is
> the only fallback (that capability is being removed for direct publishing in January 2027).

### Path A — first release with an interactive OTP (recommended for 0.2.0)

`npm login` now creates a two-hour session token, and publishing operations require a one-time
password. From the project root:

```bash
npm login
npm publish --otp <code>
```

This publishes without provenance. Use it to get the first version live, then set up Path B so no
long-lived credential is ever needed again.

### Path B — trusted publishing (OIDC), no token

1. Publish the first version once (Path A), because a trusted publisher is configured on an existing
   package, and staged publishing explicitly cannot create a brand-new package.
2. On npmjs.com open the package → **Settings → Trusted Publisher** → **GitHub Actions**:
   - Organization or user: `xAndreiLi`
   - Repository: `pi-jev-wiki`
   - Workflow filename: `publish.yml`
   - Allowed actions: enable direct publishing (`npm publish`)
3. Update `.github/workflows/publish.yml`: remove the `NODE_AUTH_TOKEN` environment and install a
   current npm before publishing, because Node 22 ships npm 10 which predates OIDC publishing:
   `npm install -g npm@^11.5.1` (or later). Keep `id-token: write`.
4. Push a version tag. The workflow publishes with provenance and no secrets.

### Fallback — granular access token with Bypass 2FA (until January 2027)

A granular access token can still publish directly, but **only if "Bypass two-factor
authentication" is checked when it is created**. Without that checkbox the token requires an OTP
and fails in CI with `EOTP`. Create it at **Access Tokens → Generate New Token**:

- Token name/description: e.g. `pi-jev-wiki CI`
- **Bypass two-factor authentication: checked** (step 5 on the form)
- Packages and scopes → Permissions: **Read and write (publish and stage)**
- Select Packages: **All Packages** (a package-scoped token cannot create a new package name)
- Expiration: at least one day in the future

Add the value as the `NPM_TOKEN` repository secret. Note that since August 2026 bypass-2FA tokens
cannot perform account or package-governance actions, and direct publishing is scheduled to be
removed in January 2027.

2. Confirm the package name is available: `npm view pi-jev-wiki version` (an E404 means it is free).
3. Confirm `repository`, `homepage`, and `bugs` in `package.json` point at the real repository.

## Release checklist

1. Update `CHANGELOG.md` with the release notes.
2. Bump the version and tag in one step: `npm version patch|minor|major`
   (creates a commit and a `vX.Y.Z` tag).
3. Run the full local check: `npm run test:all` (typecheck + offline unit tests + scale test).
4. Inspect the tarball: `npm pack --dry-run` — expect 34+ files, only `src/`, `skills/`,
   `README.md`, `CHANGELOG.md`, and `LICENSE` (plus `package.json`).
5. Smoke-test the packed artifact:
   ```bash
   tmp=$(mktemp -d) && npm pack --pack-destination "$tmp"
   mkdir -p "$tmp/pkg" && tar -xzf "$tmp"/pi-jev-wiki-*.tgz -C "$tmp/pkg"
   pi -e "$tmp/pkg/package" -p "Call wiki_status and report the provider and wiki root."
   ```
6. Publish: push a version tag (`git tag vX.Y.Z && git push origin vX.Y.Z`) to run
   `.github/workflows/publish.yml` (tests + `npm publish --provenance`), or run that workflow
   manually from the Actions tab (`workflow_dispatch`) to publish the version in `package.json`.
7. Create a GitHub release from the tag with the changelog section.

## What never ships

- `.env` (gitignored and unlisted), `docs/`, `research/`, `scripts/`, `.pi/`, `node_modules/`.
  The `files` whitelist in `package.json` is the single source of truth.

## After publishing

- Verify the gallery entry: `pi install npm:pi-jev-wiki`, then `pi -e npm:pi-jev-wiki` for a throwaway run.
- Confirm the published README renders and the pi manifest (`extensions`, `skills`) resolves.
