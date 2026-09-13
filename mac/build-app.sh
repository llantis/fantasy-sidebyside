#!/bin/bash
# Builds "Fantasy Side by Side.app" (universal, Node bundled) and a drag-to-Applications DMG.
#
#   ./mac/build-app.sh                       unsigned (ad-hoc) build: runs on this Mac, Gatekeeper
#                                            will still warn friends who download it
#   SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)" ./mac/build-app.sh
#                                            signed with hardened runtime
#   SIGN_IDENTITY=... NOTARY_PROFILE=fsbs ./mac/build-app.sh
#                                            signed + notarized + stapled: opens cleanly anywhere
#
# One-time setup for notarization (needs the paid Apple Developer Program):
#   1. Xcode → Settings → Accounts → Manage Certificates → + → "Developer ID Application"
#   2. xcrun notarytool store-credentials fsbs --apple-id you@example.com --team-id TEAMID
#      (use an app-specific password from appleid.apple.com)
#
# Output: dist/Fantasy Side by Side.app and dist/Fantasy-Side-by-Side-<version>.dmg
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAC="$ROOT/mac"
DIST="$ROOT/dist"
APP_NAME="Fantasy Side by Side"
# Stage everything outside the repo: folders synced by iCloud Drive / Dropbox get extended
# attributes stamped on every file, and codesign refuses to seal a bundle carrying them.
BUILD="$(mktemp -d "${TMPDIR:-/tmp}/fsbs-build.XXXXXX")"
APP="$BUILD/$APP_NAME.app"
trap 'rm -rf "$BUILD"' EXIT
VERSION="$(node -p "require('$ROOT/package.json').version")"
NODE_VERSION="${NODE_VERSION:-}"     # e.g. v22.12.0; default = latest LTS

say() { printf '\n\033[1m› %s\033[0m\n' "$*"; }

command -v swiftc >/dev/null || { echo "swiftc not found. Install Xcode (or Command Line Tools)."; exit 1; }

mkdir -p "$DIST"

# --- 1. Node runtime: official darwin-arm64 + darwin-x64 builds, lipo'd into one binary ---
if [ -z "$NODE_VERSION" ]; then
  NODE_VERSION="$(curl -fsSL https://nodejs.org/dist/index.json | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const v=JSON.parse(d).find(x=>x.lts);console.log(v.version)})')"
fi
say "Node $NODE_VERSION"
CACHE="$ROOT/.cache/node"; mkdir -p "$CACHE"
for arch in arm64 x64; do
  tgz="$CACHE/node-$NODE_VERSION-darwin-$arch.tar.gz"
  [ -f "$tgz" ] || curl -fsSL -o "$tgz" "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-darwin-$arch.tar.gz"
  mkdir -p "$BUILD/node-$arch"
  tar -xzf "$tgz" -C "$BUILD/node-$arch" --strip-components=1 "node-$NODE_VERSION-darwin-$arch/bin/node"
done
mkdir -p "$BUILD/node/bin"
lipo -create "$BUILD/node-arm64/bin/node" "$BUILD/node-x64/bin/node" -output "$BUILD/node/bin/node"

# --- 2. Swift launcher, universal ---
say "Compiling launcher"
swiftc -O -target arm64-apple-macos12.0  -o "$BUILD/launcher-arm64" "$MAC/main.swift"
swiftc -O -target x86_64-apple-macos12.0 -o "$BUILD/launcher-x64"   "$MAC/main.swift"
lipo -create "$BUILD/launcher-arm64" "$BUILD/launcher-x64" -output "$BUILD/launcher"

# --- 3. Icon (SVG → PNG via Quick Look → .icns) ---
say "Icon"
qlmanage -t -s 1024 -o "$BUILD" "$MAC/icon.svg" >/dev/null 2>&1
ICONSET="$BUILD/icon.iconset"; mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s "$BUILD/icon.svg.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) "$BUILD/icon.svg.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$BUILD/icon.icns"

# --- 4. Assemble bundle ---
say "Assembling $APP"
C="$APP/Contents"
mkdir -p "$C/MacOS" "$C/Resources/app" "$C/Resources/node/bin"
sed "s/__VERSION__/$VERSION/g" "$MAC/Info.plist" > "$C/Info.plist"
cp "$BUILD/launcher" "$C/MacOS/launcher"
cp "$BUILD/icon.icns" "$C/Resources/icon.icns"
cp "$BUILD/node/bin/node" "$C/Resources/node/bin/node"
cp -R "$ROOT/server.js" "$ROOT/lib" "$ROOT/public" "$ROOT/package.json" "$ROOT/config.example.json" "$C/Resources/app/"

# --- 5. Sign (inside-out: node, launcher, then the bundle) ---
xattr -cr "$APP"   # codesign refuses bundles carrying Finder/quarantine attributes
if [ -n "${SIGN_IDENTITY:-}" ]; then
  say "Signing with: $SIGN_IDENTITY"
  codesign --force --options runtime --timestamp --entitlements "$MAC/entitlements.plist" --sign "$SIGN_IDENTITY" "$C/Resources/node/bin/node"
  codesign --force --options runtime --timestamp --entitlements "$MAC/entitlements.plist" --sign "$SIGN_IDENTITY" "$C/MacOS/launcher"
  codesign --force --options runtime --timestamp --entitlements "$MAC/entitlements.plist" --sign "$SIGN_IDENTITY" "$APP"
else
  say "No SIGN_IDENTITY: ad-hoc signing (runs here; friends will see the Gatekeeper warning)"
  codesign --force --deep --sign - "$APP"
fi
codesign --verify --deep --strict "$APP" && echo "signature ok"

# --- 6. Notarize + staple the app ---
if [ -n "${SIGN_IDENTITY:-}" ] && [ -n "${NOTARY_PROFILE:-}" ]; then
  say "Notarizing app (this can take a few minutes)"
  ditto -c -k --keepParent "$APP" "$BUILD/app.zip"
  xcrun notarytool submit "$BUILD/app.zip" --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "$APP"
fi

# --- 7. DMG with an Applications shortcut ---
DMG="$BUILD/Fantasy-Side-by-Side-$VERSION.dmg"
say "Building $DMG"
rm -f "$DMG"; rm -rf "$BUILD/dmg"; mkdir -p "$BUILD/dmg"
cp -R "$APP" "$BUILD/dmg/"
ln -s /Applications "$BUILD/dmg/Applications"
hdiutil create -quiet -volname "$APP_NAME" -srcfolder "$BUILD/dmg" -ov -format UDZO "$DMG"
if [ -n "${SIGN_IDENTITY:-}" ]; then
  codesign --force --timestamp --sign "$SIGN_IDENTITY" "$DMG"
  if [ -n "${NOTARY_PROFILE:-}" ]; then
    say "Notarizing DMG"
    xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait
    xcrun stapler staple "$DMG"
  fi
fi

# --- 8. Copy finished artifacts into dist/ (attribute-free) ---
rm -rf "$DIST/$APP_NAME.app" "$DIST/$(basename "$DMG")"
ditto --noextattr --noqtn --norsrc "$APP" "$DIST/$APP_NAME.app"
ditto --noextattr --noqtn --norsrc "$DMG" "$DIST/$(basename "$DMG")"
APP="$DIST/$APP_NAME.app"; DMG="$DIST/$(basename "$DMG")"

say "Done"
echo "  $APP"
echo "  $DMG"
[ -n "${SIGN_IDENTITY:-}" ] && [ -n "${NOTARY_PROFILE:-}" ] && echo "  Signed + notarized: friends can open it straight from the download." || \
  echo "  Unsigned: fine on this Mac; downloads on other Macs will show the Gatekeeper warning."
