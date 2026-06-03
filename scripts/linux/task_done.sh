#!/usr/bin/env bash
# Run from repo root: ./scripts/linux/task_done.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MOBILE="$ROOT/mobile"

step() { echo; echo "==> $1"; }
pass() { echo "  PASS: $1"; }
skip() { echo "  SKIP: $1"; }

# 1. Dart format
step "1. Dart format"
cd "$MOBILE"
dart format --check lib
pass "dart format"

# 2. Flutter analyze
step "2. Flutter analyze"
flutter analyze --no-fatal-infos
pass "flutter analyze"
cd "$ROOT"

# 3. Flutter tests
step "3. Flutter tests"
if [ -d "$MOBILE/test" ]; then
    count=$(find "$MOBILE/test" -name "*_test.dart" | wc -l)
    if [ "$count" -gt 0 ]; then
        cd "$MOBILE"
        flutter test
        pass "flutter test ($count test files)"
        cd "$ROOT"
    else
        skip "no test files in mobile/test/ yet"
    fi
else
    skip "mobile/test/ does not exist yet"
fi

# 3b. Backend tests
step "3b. Backend tests"
BACKEND="$ROOT/backend"
if [ -f "$BACKEND/package.json" ]; then
    if grep -q '"jest"' "$BACKEND/package.json"; then
        cd "$BACKEND"
        npm test
        pass "npm test"
        cd "$ROOT"
    else
        skip "jest not configured in backend yet"
    fi
else
    skip "backend/package.json not found"
fi

echo
echo "All checks passed."

# Suggested commit — app repo
echo
echo "==> Suggested commit (app)"
changed=$(git diff --stat HEAD 2>/dev/null || git status --short 2>/dev/null)
[ -n "$changed" ] && echo "$changed" && echo
cat <<'EOF'
  Copy and edit:
  git commit -m "feat: <summary>

  - <optional detail>"
EOF

# Suggested commit — vault repo
VAULT="$ROOT/../whatorder-vault"
if [ -d "$VAULT/.git" ]; then
    echo
    echo "==> Suggested commit (vault)"
    vault_changed=$(cd "$VAULT" && { git diff --stat HEAD 2>/dev/null || git status --short 2>/dev/null; })
    [ -n "$vault_changed" ] && echo "$vault_changed" && echo
    cat <<'EOF'
  Copy and edit:
  git commit -m "chore: <summary>

  - <optional detail>"
EOF
fi
