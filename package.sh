#!/bin/bash
# Packages build/Grain Tracer.app into a zip for a GitHub Release.
#   ./build.sh && ./package.sh  → dist/GrainTracer-<version>-macOS.zip
set -euo pipefail
cd "$(dirname "$0")"
APP="build/Grain Tracer.app"
[ -d "$APP" ] || { echo "Run ./build.sh first."; exit 1; }
V=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" mac/Info.plist)
mkdir -p dist
ditto -c -k --sequesterRsrc --keepParent "$APP" "dist/GrainTracer-$V-macOS.zip"
cp index.html "dist/GrainTracer-$V-web.html"
echo "✓ dist/GrainTracer-$V-macOS.zip"
echo "✓ dist/GrainTracer-$V-web.html"
