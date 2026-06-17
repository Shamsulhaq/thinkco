# Releasing thinkco (beta)

thinkco is currently shipped as a **beta** at version `0.1.0`. Betas are published under the
npm `beta` dist-tag so they never become the default `latest` install.

## Pre-publish gate

`prepublishOnly` runs automatically on `npm publish` and blocks the release unless all of the
following pass:

```bash
npm run build   # tsc → dist/
npm run lint    # eslint
npm test        # vitest (full suite)
```

You can run them manually first to fail fast.

## What gets published

Controlled by the `files` allowlist in `package.json`:

- `dist/` — compiled JS, type declarations, and source maps
- `plugins/` — bundled default plugins (incl. `ruflo-core`)
- `install.sh` — the curl install script
- `README.md`, `LICENSE`, `package.json` — always included by npm

Verify the exact contents before publishing:

```bash
npm pack --dry-run
```

## Smoke test the tarball

Confirm a clean install works before pushing to the registry:

```bash
TARBALL=$(npm pack | tail -1)
TMP=$(mktemp -d) && (cd "$TMP" && npm init -y >/dev/null && npm install "$OLDPWD/$TARBALL")
"$TMP/node_modules/.bin/thinkco" --version    # → 0.1.0
rm -f "$TARBALL" && rm -rf "$TMP"
```

## Publish the beta

`publishConfig` in `package.json` pins `access: public` and `tag: beta`, so a plain publish is
correct:

```bash
npm login            # once, with an account that can publish `thinkco`
npm publish          # publishes 0.1.0 under the `beta` tag (not `latest`)
```

Users then install the beta explicitly:

```bash
npm install -g thinkco@beta
```

> ⚠️ `npm publish` is **irreversible** — a version cannot be re-published once taken, and
> unpublish is restricted. Always run the smoke test first and double-check the version.

## After 1.0

When the product leaves beta, bump the version, remove `tag: beta` from `publishConfig` (or
publish with `--tag latest`), and update `src/index.ts`'s `VERSION` constant to match
`package.json`.
