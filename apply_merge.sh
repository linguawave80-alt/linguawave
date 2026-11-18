#!/usr/bin/env bash
#
# apply_merge.sh — copies every file from the merged "changed files" zip
# into your real Inferno repo, backing up anything it overwrites first.
#
# Usage:
#   ./apply_merge.sh /path/to/inferno-combined-merged  /path/to/your/repo
#
# What it does:
#   1. Makes a timestamped backup of every file it's about to overwrite,
#      under <repo>/.merge-backup-<timestamp>/  (mirrors original paths)
#   2. Copies every file from the merged folder into the matching path
#      in your repo, creating any missing directories
#   3. Prints a summary: files updated, files newly created, files skipped
#
# It never deletes files, and never touches anything outside the paths
# present in the merged folder. Safe to re-run.

set -euo pipefail

SRC="${1:-}"
DEST="${2:-}"

if [[ -z "$SRC" || -z "$DEST" ]]; then
  echo "Usage: $0 <merged-source-folder> <your-repo-root>"
  exit 1
fi
if [[ ! -d "$SRC" ]]; then
  echo "Source folder not found: $SRC"
  exit 1
fi
if [[ ! -d "$DEST" ]]; then
  echo "Destination repo not found: $DEST"
  exit 1
fi

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$DEST/.merge-backup-$TIMESTAMP"

updated=0
created=0
skipped_same=0

echo "Applying changes from: $SRC"
echo "Into repo:              $DEST"
echo "Backups going to:       $BACKUP_DIR"
echo

# Walk every file under SRC (skip the summary doc itself).
while IFS= read -r -d '' file; do
  rel="${file#"$SRC"/}"
  [[ "$rel" == "MERGE_SUMMARY.md" ]] && continue

  target="$DEST/$rel"

  if [[ -f "$target" ]]; then
    if cmp -s "$file" "$target"; then
      skipped_same=$((skipped_same + 1))
      continue
    fi
    mkdir -p "$(dirname "$BACKUP_DIR/$rel")"
    cp "$target" "$BACKUP_DIR/$rel"
    updated=$((updated + 1))
    echo "  updated:  $rel"
  else
    created=$((created + 1))
    echo "  new:      $rel"
  fi

  mkdir -p "$(dirname "$target")"
  cp "$file" "$target"
done < <(find "$SRC" -type f -print0)

echo
echo "Done. $updated updated, $created created, $skipped_same already identical."
if [[ $updated -gt 0 ]]; then
  echo "Original versions of updated files were backed up to:"
  echo "  $BACKUP_DIR"
else
  rmdir "$BACKUP_DIR" 2>/dev/null || true
fi
echo
echo "Next: review with 'git status' / 'git diff', run your tests, then commit."
