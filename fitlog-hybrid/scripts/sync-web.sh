#!/usr/bin/env bash
# fitlog-main 의 웹 파일을 안드로이드 앱의 assets 로 복사합니다.
# (윈도우에서는 scripts/sync-web.ps1 을 쓰세요. 하는 일은 같습니다.)
#
#   ./scripts/sync-web.sh [웹_원본_경로] [--no-media]
#
# 웹 코드의 원본은 fitlog-main 하나뿐입니다. 웹을 고친 뒤에는 항상 이걸
# 돌리고 빌드하세요 — 안 그러면 APK 안에 옛날 화면이 남습니다.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(dirname "$here")"

src="${1:-$(dirname "$repo")/fitlog-main}"
[ "${1:-}" = "--no-media" ] && { src="$(dirname "$repo")/fitlog-main"; }
no_media=false
for arg in "$@"; do [ "$arg" = "--no-media" ] && no_media=true; done

dest="$repo/android/app/src/main/assets/web"

[ -d "$src" ] || { echo "웹 원본을 찾을 수 없습니다: $src" >&2; exit 1; }
[ -f "$src/index.html" ] || { echo "$src 안에 index.html 이 없습니다." >&2; exit 1; }

rm -rf "$dest"
mkdir -p "$dest"

excludes=(
  --exclude '.git/' --exclude '.github/'
  --exclude 'firebase.json' --exclude '.firebaserc'
  --exclude 'firestore.rules' --exclude 'firestore.indexes.json'
  --exclude '.gitignore' --exclude '.nojekyll' --exclude 'README.md'
)
$no_media && excludes+=(--exclude 'media/')

if command -v rsync >/dev/null 2>&1; then
  rsync -a "${excludes[@]}" "$src/" "$dest/"
else
  cp -R "$src/." "$dest/"
  rm -rf "$dest/.git" "$dest/.github"
  rm -f "$dest/firebase.json" "$dest/.firebaserc" "$dest/firestore.rules" \
        "$dest/firestore.indexes.json" "$dest/.gitignore" "$dest/.nojekyll"
  $no_media && rm -rf "$dest/media"
fi

count=$(find "$dest" -type f | wc -l | tr -d ' ')
size=$(du -sh "$dest" | cut -f1)
echo "${count}개 파일, ${size} → $dest"
echo "이제 ./gradlew assembleDebug 를 실행하세요."
