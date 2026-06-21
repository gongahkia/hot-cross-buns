#!/usr/bin/env bash
set -euo pipefail

URL="${HCB_MCP_URL:-http://127.0.0.1:8765/mcp}"
TOKEN="${HCB_MCP_TOKEN:-}"
RUN_RATE_LIMIT="${HCB_MCP_RUN_RATE_LIMIT:-0}"
RATE_COUNT="${HCB_MCP_RATE_COUNT:-130}"

if [[ -z "$TOKEN" ]]; then
  echo "Set HCB_MCP_TOKEN to the bearer token from Settings -> Agent access." >&2
  exit 2
fi

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

post_json() {
  local name="$1"
  local body="$2"
  local expected="$3"
  shift 3
  local out="$WORKDIR/$name.out"
  local status
  status="$(curl -sS -o "$out" -w '%{http_code}' \
    -X POST "$URL" \
    -H 'Content-Type: application/json' \
    "$@" \
    --data-binary "$body")"
  if [[ "$status" != "$expected" ]]; then
    echo "FAIL $name: expected HTTP $expected, got $status" >&2
    cat "$out" >&2
    exit 1
  fi
  echo "ok $name HTTP $status"
}

post_file() {
  local name="$1"
  local file="$2"
  local expected="$3"
  shift 3
  local out="$WORKDIR/$name.out"
  local status
  status="$(curl -sS -o "$out" -w '%{http_code}' \
    -X POST "$URL" \
    -H 'Content-Type: application/json' \
    "$@" \
    --data-binary @"$file")"
  if [[ "$status" != "$expected" ]]; then
    echo "FAIL $name: expected HTTP $expected, got $status" >&2
    cat "$out" >&2
    exit 1
  fi
  echo "ok $name HTTP $status"
}

post_json "initialize" '{"jsonrpc":"2.0","id":"init","method":"initialize","params":{}}' 200 \
  -H "Authorization: Bearer $TOKEN" \
  -H 'User-Agent: HCBMCPAbuseSmoke/1.0'

post_json "tools-list" '{"jsonrpc":"2.0","id":"tools","method":"tools/list","params":{}}' 200 \
  -H "Authorization: Bearer $TOKEN" \
  -H 'User-Agent: HCBMCPAbuseSmoke/1.0'

post_json "unauthorized" '{"jsonrpc":"2.0","id":"bad-auth","method":"tools/list","params":{}}' 401 \
  -H 'Authorization: Bearer wrong-token' \
  -H 'User-Agent: HCBMCPAbuseSmoke/1.0'

post_json "bad-origin" '{"jsonrpc":"2.0","id":"bad-origin","method":"tools/list","params":{}}' 403 \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Origin: https://example.com' \
  -H 'User-Agent: HCBMCPAbuseSmoke/1.0'

post_json "malformed-json" '{' 400 \
  -H "Authorization: Bearer $TOKEN" \
  -H 'User-Agent: HCBMCPAbuseSmoke/1.0'

post_json "dry-run-write" '{"jsonrpc":"2.0","id":"dry-run","method":"tools/call","params":{"name":"hcb_create_note","arguments":{"title":"MCP abuse smoke dry-run","notes":"This must not be applied.","dryRun":true}}}' 200 \
  -H "Authorization: Bearer $TOKEN" \
  -H 'User-Agent: HCBMCPAbuseSmoke/1.0'

LARGE_BODY="$WORKDIR/large-body.json"
perl -e 'print "{\"jsonrpc\":\"2.0\",\"id\":\"large\",\"method\":\"tools/list\",\"params\":{\"padding\":\""; print "A" x (1024 * 1024 + 1); print "\"}}";' > "$LARGE_BODY"
post_file "oversized-body" "$LARGE_BODY" 413 \
  -H "Authorization: Bearer $TOKEN" \
  -H 'User-Agent: HCBMCPAbuseSmoke/1.0'

if [[ "$RUN_RATE_LIMIT" == "1" ]]; then
  seen_429=0
  for index in $(seq 1 "$RATE_COUNT"); do
    out="$WORKDIR/rate-$index.out"
    status="$(curl -sS -o "$out" -w '%{http_code}' \
      -X POST "$URL" \
      -H 'Content-Type: application/json' \
      -H "Authorization: Bearer $TOKEN" \
      -H 'User-Agent: HCBMCPAbuseSmoke/1.0' \
      --data-binary '{"jsonrpc":"2.0","id":"rate","method":"tools/list","params":{}}')"
    if [[ "$status" == "429" ]]; then
      seen_429=1
      break
    fi
  done
  if [[ "$seen_429" != "1" ]]; then
    echo "FAIL rate-limit: no HTTP 429 after $RATE_COUNT requests" >&2
    exit 1
  fi
  echo "ok rate-limit HTTP 429"
else
  echo "skip rate-limit flood; set HCB_MCP_RUN_RATE_LIMIT=1 to run it"
fi
