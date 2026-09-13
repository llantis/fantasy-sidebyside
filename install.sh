#!/bin/bash
# One-line install + run for macOS / Linux (no Gatekeeper prompt, nothing to double-click):
#
#   curl -fsSL https://raw.githubusercontent.com/llantis/fantasy-sidebyside/main/install.sh | bash
#
# Installs Node.js if missing (Homebrew on Mac), downloads the app to ~/fantasy-sidebyside
# (or updates it if already there), starts it, and opens your browser. Re-run any time.
set -e

DIR="${FSBS_DIR:-$HOME/fantasy-sidebyside}"
REPO="https://github.com/llantis/fantasy-sidebyside"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    echo "Node.js is not installed. Installing with Homebrew (takes a minute)..."
    brew install node
  else
    echo "Node.js is not installed. Install the LTS version from https://nodejs.org, then re-run this command."
    exit 1
  fi
fi

if [ -d "$DIR/.git" ]; then
  echo "Updating $DIR ..."
  git -C "$DIR" pull -q --ff-only || true
elif command -v git >/dev/null 2>&1; then
  echo "Downloading to $DIR ..."
  git clone -q "$REPO.git" "$DIR"
else
  echo "Downloading to $DIR ..."
  mkdir -p "$DIR"
  curl -fsSL "$REPO/archive/refs/heads/main.tar.gz" | tar -xz -C "$DIR" --strip-components=1
fi

cd "$DIR"
echo "Starting Fantasy Side by Side. Leave this window open; press Ctrl+C to stop."
exec node server.js
