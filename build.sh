#!/bin/bash
# Builds "Grain Tracer.app" with Xcode Command Line Tools (no Xcode project needed).
#   xcode-select --install   # once, if swiftc is missing
#   ./build.sh               # → build/Grain Tracer.app
set -euo pipefail
cd "$(dirname "$0")"

APP="build/Grain Tracer.app"
rm -rf build
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web"

echo "▸ Compiling Swift shell"
swiftc -O -parse-as-library -o "$APP/Contents/MacOS/GrainTracer" mac/GrainTracer.swift -framework Cocoa -framework WebKit

echo "▸ Copying web UI and Info.plist"
cp index.html "$APP/Contents/Resources/web/index.html"
cp mac/Info.plist "$APP/Contents/Info.plist"

echo "▸ Building icon"
ICONSET="build/AppIcon.iconset"
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s mac/icon_1024.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z $d $d mac/icon_1024.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
rm -rf "$ICONSET"

echo "▸ Ad-hoc signing"
# OneDrive/iCloud folders add extended attributes that codesign rejects ("resource fork ... detritus")
xattr -cr "$APP"
codesign --force --deep --sign - "$APP" >/dev/null

echo "✓ Built: $APP"
echo "  Run:   open \"$APP\"   (첫 실행은 Finder에서 우클릭 ▸ 열기)"
