#!/usr/bin/env bash
# One-line installer for thinkco:  curl -fsSL https://raw.githubusercontent.com/Shamsulhaq/thinkco/main/install.sh | bash
set -euo pipefail

REPO="${THINKCO_REPO:-https://github.com/Shamsulhaq/thinkco.git}"
DIR="${THINKCO_DIR:-$HOME/.thinkco/src}"

echo "→ Installing thinkco…"
command -v git  >/dev/null 2>&1 || { echo "✗ git is required"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "✗ Node.js >= 20 is required (https://nodejs.org)"; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || { echo "✗ Node.js >= 20 required (found $(node -v))"; exit 1; }

mkdir -p "$(dirname "$DIR")"
if [ -d "$DIR/.git" ]; then
  echo "→ Updating existing checkout in $DIR"
  git -C "$DIR" pull --ff-only
else
  echo "→ Cloning $REPO → $DIR"
  git clone --depth 1 "$REPO" "$DIR"
fi

cd "$DIR"
echo "→ Installing dependencies and building…"
npm install
npm run build
echo "→ Linking the 'thinkco' command onto your PATH…"
npm link

echo ""
echo "✓ thinkco installed. Start it with:  thinkco"
echo "  (optional) web_search:  npm i -g playwright && npx playwright install chromium"
