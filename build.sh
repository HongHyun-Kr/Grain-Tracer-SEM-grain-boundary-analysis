#!/bin/bash
# Builds "Grain Tracer.app" (Universal when possible) with Xcode Command Line Tools.
#   xcode-select --install   # once, if swiftc is missing
#   ./build.sh               # → build/Grain Tracer.app
set -euo pipefail
cd "$(dirname "$0")"

APP="build/Grain Tracer.app"
MIN_OS="12.0"
rm -rf build
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web"

echo "▸ Compiling Swift shell"
# Universal when the toolchain supports it; newer Command Line Tools may lack x86_64 Swift libraries,
# in which case the Intel slice is skipped and an Apple Silicon build is produced.
SLICES=()
for ARCH in arm64 x86_64; do
  if swiftc -O -parse-as-library -target "$ARCH-apple-macos$MIN_OS" \
       -o "build/GrainTracer-$ARCH" mac/GrainTracer.swift -framework Cocoa -framework WebKit 2>"build/swiftc-$ARCH.log"; then
    SLICES+=("build/GrainTracer-$ARCH"); echo "  ✓ $ARCH"
  else
    echo "  – $ARCH skipped (see build/swiftc-$ARCH.log)"
    [ "$ARCH" = arm64 ] && { cat "build/swiftc-$ARCH.log"; exit 1; }
  fi
done
lipo -create -output "$APP/Contents/MacOS/GrainTracer" "${SLICES[@]}"
rm -f build/GrainTracer-arm64 build/GrainTracer-x86_64

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
# OneDrive/iCloud folders add extended attributes that make codesign fail
xattr -cr "$APP"
codesign --force --deep --sign - "$APP" >/dev/null

echo "✓ Built: $APP"
echo "  Run:   open \"$APP\""
echo "  Zip:   ./package.sh   (release zip)"
