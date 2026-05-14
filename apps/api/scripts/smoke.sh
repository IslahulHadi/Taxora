#!/usr/bin/env bash
# End-to-end smoke test for the Taxora API.
# Boots the server, hits every endpoint, asserts expected outputs, shuts down.
# Returns 0 on full success, 1 on any failed assertion.
set -uo pipefail

cd "$(dirname "$0")/.."
PATH="/root/.nvm/versions/node/v24.15.0/bin:$PATH"
export PATH

LOG=/tmp/api-smoke.log
PORT=4000

# Start the API in background.
node_modules/.bin/tsx src/main.ts > "$LOG" 2>&1 &
PID=$!

cleanup() { kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; }
trap cleanup EXIT

# Wait for /health to respond.
for i in $(seq 1 30); do
  if curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/health" 2>/dev/null | grep -q 200; then
    break
  fi
  sleep 1
done

PASS=0
FAIL=0

assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  [PASS] $label"
    PASS=$((PASS+1))
  else
    echo "  [FAIL] $label: expected '$expected', got '$actual'"
    FAIL=$((FAIL+1))
  fi
}

assert_match() {
  local label="$1" pattern="$2" actual="$3"
  if echo "$actual" | grep -q "$pattern"; then
    echo "  [PASS] $label"
    PASS=$((PASS+1))
  else
    echo "  [FAIL] $label: pattern '$pattern' not found in: $actual"
    FAIL=$((FAIL+1))
  fi
}

echo "=== /health ==="
BODY=$(curl -s -w "\n%{http_code}" "http://127.0.0.1:$PORT/health")
CODE=$(echo "$BODY" | tail -1); BODY=$(echo "$BODY" | head -n -1)
assert_eq "status code"           "200"           "$CODE"
assert_eq "body"                  '{"status":"ok"}' "$BODY"

echo "=== /readyz ==="
BODY=$(curl -s -w "\n%{http_code}" "http://127.0.0.1:$PORT/readyz")
CODE=$(echo "$BODY" | tail -1); BODY=$(echo "$BODY" | head -n -1)
assert_eq "status code"           "200"           "$CODE"
assert_match "db ok"              '"db":"ok"'     "$BODY"

echo "=== /v1/me without JWT (expect 401 RFC 7807) ==="
BODY=$(curl -s -w "\n%{http_code}" "http://127.0.0.1:$PORT/v1/me")
CODE=$(echo "$BODY" | tail -1); BODY=$(echo "$BODY" | head -n -1)
assert_eq "status code"           "401"           "$CODE"
assert_match "code field"         '"code":"UNAUTHENTICATED"' "$BODY"
assert_match "title field"        '"title"'       "$BODY"

echo "=== /auth/dev-login ==="
BODY=$(curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"tenantSlug":"demo"}' \
  -w "\n%{http_code}" "http://127.0.0.1:$PORT/auth/dev-login")
CODE=$(echo "$BODY" | tail -1); BODY=$(echo "$BODY" | head -n -1)
assert_eq "status code"           "201"           "$CODE"
assert_match "has accessToken"    '"accessToken"' "$BODY"
assert_match "has tenant"         '"slug":"demo"' "$BODY"
TOKEN=$(echo "$BODY" | python3 -c "import json,sys; print(json.load(sys.stdin)['accessToken'])")

echo "=== /v1/me WITH JWT ==="
BODY=$(curl -s -H "Authorization: Bearer $TOKEN" \
  -w "\n%{http_code}" "http://127.0.0.1:$PORT/v1/me")
CODE=$(echo "$BODY" | tail -1); BODY=$(echo "$BODY" | head -n -1)
assert_eq "status code"           "200"           "$CODE"
assert_match "tenant slug=demo"   '"slug":"demo"' "$BODY"
assert_match "pkpStatus=PKP"      '"pkpStatus":"PKP"' "$BODY"
assert_match "user id"            '"user":{"id":' "$BODY"
assert_match "roles"              '"roles":\["owner"\]' "$BODY"

echo "=== /auth/dev-login bad slug (expect 404 with our code) ==="
BODY=$(curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"tenantSlug":"nope"}' \
  -w "\n%{http_code}" "http://127.0.0.1:$PORT/auth/dev-login")
CODE=$(echo "$BODY" | tail -1); BODY=$(echo "$BODY" | head -n -1)
assert_eq "status code"           "404"           "$CODE"
assert_match "error code"         '"code":"TENANT_NOT_FOUND"' "$BODY"

echo "=== Validation: empty body to dev-login (expect 400 + fields) ==="
BODY=$(curl -s -X POST -H 'Content-Type: application/json' \
  -d '{}' \
  -w "\n%{http_code}" "http://127.0.0.1:$PORT/auth/dev-login")
CODE=$(echo "$BODY" | tail -1); BODY=$(echo "$BODY" | head -n -1)
assert_eq "status code"           "400"           "$CODE"
assert_match "code"               '"code":"VALIDATION_FAILED"' "$BODY"
assert_match "fields[].path"      '"path":"tenantSlug"' "$BODY"

echo
echo "=========================================="
echo " RESULT: $PASS passed, $FAIL failed"
echo "=========================================="
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
