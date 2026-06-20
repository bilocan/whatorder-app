#!/usr/bin/env bash
# Run from repo root: ./scripts/linux/task_done.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DASHBOARD="$ROOT/dashboard"

step() { echo; echo "==> $1"; }
pass() { echo "  PASS: $1"; }
skip() { echo "  SKIP: $1"; }

# 1. TypeScript check
step "1. TypeScript check"
if [ -f "$DASHBOARD/package.json" ]; then
    cd "$DASHBOARD"
    npx tsc --noEmit
    pass "tsc --noEmit"
    cd "$ROOT"
else
    skip "dashboard/package.json not found"
fi

# 2. ESLint
step "2. ESLint"
if [ -f "$DASHBOARD/package.json" ]; then
    cd "$DASHBOARD"
    npx eslint src --max-warnings 0
    pass "eslint src --max-warnings 0"
    cd "$ROOT"
else
    skip "dashboard/package.json not found"
fi

# 3. Dashboard tests
step "3. Dashboard tests"
if [ -d "$DASHBOARD/src/__tests__" ]; then
    count=$(find "$DASHBOARD/src/__tests__" -name "*.test.*" 2>/dev/null | wc -l)
    if [ "$count" -gt 0 ]; then
        cd "$DASHBOARD"
        npm test -- --watchAll=false
        pass "npm test ($count test files)"
        cd "$ROOT"
    else
        skip "no test files in dashboard/src/__tests__/ yet"
    fi
else
    skip "dashboard/src/__tests__/ does not exist yet"
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
