#!/bin/bash
# Double-click me. Installs Node.js if needed, starts the app, opens your browser.
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    echo "Node.js is not installed. Installing it with Homebrew (this takes a minute)..."
    brew install node
  else
    echo "Node.js is not installed. Opening nodejs.org - install the LTS version,"
    echo "then double-click this file again."
    open "https://nodejs.org"
    read -n 1 -s -r -p "Press any key to close."
    exit 1
  fi
fi

echo "Starting Fantasy Side by Side. Leave this window open; close it (or press Ctrl+C) to stop."
node server.js
