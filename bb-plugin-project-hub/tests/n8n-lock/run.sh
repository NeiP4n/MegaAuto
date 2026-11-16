#!/bin/sh
# n8n manager lock (proper-lockfile) - unit + multi-process stress suite.
# Extracts the lock section from server.ts by anchors, stubs the server-only
# dependencies (port probe, log), then runs:
#   UNIT     18 cases: acquire/release, busy error, stale reclaim, compromised
#   STRESS1  6 workers, 2 SIGKILLed mid-run -> single live owner at all times
#   STRESS2  holder SIGKILLed mid-hold -> stale recovery by another process
#   STRESS3  live holder blocks everyone; clean exit frees the lock
#   STRESS4  aggressor plants backdated stale dirs vs 6 racing workers
# Run from the plugin root after npm install:
#   sh tests/n8n-lock/run.sh
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
GEN="$HERE/.gen"
mkdir -p "$GEN"
awk '/^let n8nLockFile/,/^async function startLocalN8nProcess/' "$HERE/../../server.ts" | sed '$d' > "$GEN/extract.ts"
cat "$HERE/preamble.ts" "$GEN/extract.ts" "$HERE/worker-body.ts" > "$GEN/worker.ts"
cat "$HERE/preamble.ts" "$GEN/extract.ts" "$HERE/victim-body.ts" > "$GEN/victim.ts"
cat "$HERE/preamble.ts" "$GEN/extract.ts" "$HERE/core.ts" > "$GEN/core-run.ts"
export N8N_LOCK_STALE_MS=${N8N_LOCK_STALE_MS:-2000}
export N8N_LOCK_UPDATE_MS=${N8N_LOCK_UPDATE_MS:-1000}
echo "== UNIT =="
node --experimental-strip-types "$GEN/core-run.ts"
echo "== STRESS1: 6 workers, 2 SIGKILLed mid-run =="
node "$HERE/driver.mjs"
echo "== STRESS2: holder SIGKILLed mid-hold, stale recovery =="
node "$HERE/driver2.mjs"
echo "== STRESS3: live holder blocks, clean exit frees =="
node "$HERE/driver3.mjs"
echo "== STRESS4: backdated stale plants vs 6 racing workers =="
node "$HERE/driver4.mjs"
echo "ALL SUITES PASS"
