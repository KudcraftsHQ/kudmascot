#!/usr/bin/env bash
# Build the kudmascot menu-bar app, assemble the .app bundle, ad-hoc sign it, install to ~/Applications.
#   ./build.sh                build + install (restarts the app if it was running)
#   ./build.sh --no-install   build bundle into ./build only (CI)
#   ./build.sh --run          build + install + launch
# Version comes from $VERSION (the workflow passes 1.0.<run>), else Info.plist.
set -euo pipefail
cd "$(dirname "$0")"

INSTALL=1; RUN=0
for arg in "$@"; do
  case "$arg" in
    --no-install) INSTALL=0 ;;
    --run) RUN=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

APP_NAME="kudmascot"
APP="build/$APP_NAME.app"
DEST="$HOME/Applications/$APP_NAME.app"
ARCHS=(--arch arm64 --arch x86_64)

echo "==> swift build (release, universal)"
swift build -c release "${ARCHS[@]}"
BIN_DIR="$(swift build -c release "${ARCHS[@]}" --show-bin-path)"

echo "==> assembling $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" "$APP/Contents/Frameworks"
cp "$BIN_DIR/KudMascot" "$APP/Contents/MacOS/$APP_NAME"
cp Resources/Info.plist "$APP/Contents/Info.plist"
if [ -n "${VERSION:-}" ]; then
  /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" -c "Set :CFBundleVersion $VERSION" "$APP/Contents/Info.plist"
fi
echo "    version $(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist")"
ditto "$BIN_DIR/Sparkle.framework" "$APP/Contents/Frameworks/Sparkle.framework"
cp Resources/AppIcon.icns "$APP/Contents/Resources/"
printf 'APPL????' > "$APP/Contents/PkgInfo"

echo "==> ad-hoc signing"
codesign --force --deep -s - "$APP"
codesign --verify --strict "$APP"

if [ "$INSTALL" = 1 ]; then
  WAS_RUNNING=0
  if pgrep -x "$APP_NAME" >/dev/null; then
    WAS_RUNNING=1
    osascript -e 'tell application id "com.kudcrafts.kudmascot.mac" to quit' >/dev/null 2>&1 || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do pgrep -x "$APP_NAME" >/dev/null || break; sleep 0.3; done
    pkill -x "$APP_NAME" 2>/dev/null || true
  fi
  echo "==> installing to $DEST"
  mkdir -p "$HOME/Applications"
  rm -rf "$DEST"
  ditto "$APP" "$DEST"
  if [ "$RUN" = 1 ] || [ "$WAS_RUNNING" = 1 ]; then open "$DEST"; fi
fi
echo "==> done"
