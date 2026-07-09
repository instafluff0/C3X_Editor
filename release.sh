#!/usr/bin/env bash
set -euo pipefail

host_os="$(uname -s)"

case "$host_os" in
  Darwin*)
    echo "Building macOS universal DMG..."
    npx electron-builder --mac dmg --universal
    ;;
  MINGW*|MSYS*|CYGWIN*)
    echo "Building Windows x64 portable app..."
    npx electron-builder --x64 --win portable
    ;;
  *)
    echo "Unsupported release host: $host_os"
    echo "Run this script on macOS for a universal DMG or from Git Bash/MSYS/Cygwin on Windows for the Windows portable app."
    exit 1
    ;;
esac
