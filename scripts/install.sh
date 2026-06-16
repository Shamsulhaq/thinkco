#!/usr/bin/env bash
# Install thinkco onto your PATH. Builds and links the CLI.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "Building thinkco..."
npm run build

echo "Linking 'thinkco' globally (npm link)..."
npm link

echo "Done. Try: thinkco --help"
