#!/bin/bash
# Build HIGHGROUND.app — a native Swift/WebKit shell (no third-party binaries) — and install it in
# ~/Applications. It runs the LIVE project folder (~/Developer/HIGHGROUND), so rebuilding is only
# needed when this shell changes; game updates show up with Cmd+R.
set -euo pipefail
cd "$(dirname "$0")"
APP=dist/HIGHGROUND.app
rm -rf dist && mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -O -o "$APP/Contents/MacOS/HIGHGROUND" HighgroundApp.swift -framework Cocoa -framework WebKit -framework Network
cp icon.icns "$APP/Contents/Resources/icon.icns"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>HIGHGROUND</string>
  <key>CFBundleDisplayName</key><string>HIGHGROUND</string>
  <key>CFBundleIdentifier</key><string>io.github.maxlirio.highground</string>
  <key>CFBundleExecutable</key><string>HIGHGROUND</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PLIST
codesign --force --deep --sign - "$APP"
# ~/Applications (not /Applications): launches without the first-run hold macOS put on the other copies
mkdir -p "$HOME/Applications" && rm -rf "$HOME/Applications/HIGHGROUND.app"
ditto "$APP" "$HOME/Applications/HIGHGROUND.app"
echo "==> Installed ~/Applications/HIGHGROUND.app"
