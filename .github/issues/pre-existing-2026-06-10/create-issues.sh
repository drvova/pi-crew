#!/usr/bin/env bash
# Auto-create GitHub issues for pre-existing test failures.
# Requires: gh CLI authenticated, run from pi-crew repo root.
#
# Usage:
#   cd /home/bom/source/my_pi/pi-crew
#   .github/issues/pre-existing-2026-06-10/create-issues.sh
#
# Dry-run (prints what it would do without creating):
#   DRY_RUN=1 .github/issues/pre-existing-2026-06-10/create-issues.sh
#
# Only create specific issues (e.g. 01, 05, 06):
#   ONLY="01 05 06" .github/issues/pre-existing-2026-06-10/create-issues.sh

set -euo pipefail

cd "$(dirname "$0")/../../.."

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  echo "DRY-RUN MODE — no issues will be created"
  GH_CMD="echo gh"
else
  GH_CMD="gh"
  command -v gh >/dev/null || { echo "ERROR: gh CLI not installed"; exit 1; }
  $GH_CMD auth status >/dev/null || { echo "ERROR: gh not authenticated"; exit 1; }
fi

create_issue() {
  local file="$1"
  local title label
  # Extract title from the first H1 line
  title=$(grep -m1 -E '^# ' "$file" | sed 's/^# //')
  # Extract severity from the **Severity**: line
  label=$(grep -m1 -E '^\*\*Severity\*\*:' "$file" | sed 's/.*: //;s/\*//g' | tr '[:upper:]' '[:lower:]' | tr -d ' ')
  if [[ -z "$title" ]]; then
    echo "  SKIP: $file (no title)"
    return
  fi
  if [[ -z "$label" ]]; then
    label="unspecified"
  fi
  echo "  CREATE: $title  [$label]"
  if [[ "${DRY_RUN:-0}" != "1" ]]; then
    $GH_CMD issue create \
      --title "$title" \
      --body-file "$file" \
      --label "test-failure,pre-existing,$label" \
      --assignee "@me"
  fi
}

# Process files in numerical order, EXCLUDING README.md
for file in $(ls .github/issues/pre-existing-2026-06-10/*.md | grep -v 'README.md$' | sort); do
  basename="$(basename "$file")"
  # Skip README and create-issues.sh itself
  if [[ "$basename" == "README.md" ]] || [[ "$basename" == "create-issues.sh" ]]; then
    continue
  fi
  # Extract number prefix
  num="${basename%%-*}"
  # Filter by ONLY if set
  if [[ -n "${ONLY:-}" ]]; then
    if [[ ! " $ONLY " == *" $num "* ]]; then
      continue
    fi
  fi
  create_issue "$file"
done

echo ""
echo "Done. ${DRY_RUN:+DRY-RUN: }Issues created."
