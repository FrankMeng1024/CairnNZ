#!/bin/bash
# integration_test_story_528.sh — Friend System v1 / Sprint 67 / STORY-00528
#
# Integration tests for the 8 new endpoints + 4 H1 public-rejection contracts.
# Runs against the live aliyun backend (http://localhost:3001 on the server).
# All requests use real @cairn.demo seeded users (STORY-00527).
#
# Test plan (12 named checks; each fails the script if assertion breaks):
#   T01  Alice login → JWT captured
#   T02  Bob login → JWT captured
#   T03  Alice POST /api/memory-subscriptions {friend_id: Bob} → 403 (not friends yet)
#   T04  Establish friend pair Alice↔Bob via direct DB insert (bypass /api/friends UI)
#   T05  Alice POST /api/memory-subscriptions {friend_id: Bob} → 201
#   T06  Alice POST /api/memory-subscriptions {friend_id: Bob} again → 409 (dup)
#   T07  Alice GET /api/memory-subscriptions → list contains Bob, count=1, limit=5
#   T08  Alice GET /api/circle/markers → contains Bob's 8 markers
#   T09  Alice GET /api/circle/routes → contains Bob's 1 route
#   T10  Alice GET /api/circle/fog → contains Bob's friend_points (or [] if no points)
#   T11  Alice GET /api/markers/public?bbox=...  → returns Stranger 1 + 2 + 3 marks
#        + Carol's 4 public marks within bbox
#   T12  Alice POST /api/hide {item_type: mark, item_id: <Carol-public-mark>} → 201
#   T13  Alice GET /api/markers/public?bbox=... AGAIN → hidden mark filtered out
#   T14  Alice POST /api/markers {permission: 'public'} → 400 (H1 reject)
#   T15  Alice PUT  /api/markers/<id> {permission: 'public'} → 400 (H1 reject)
#   T16  Alice POST /api/routes  {permission: 'public'} → 400 (H1 reject)
#   T17  Alice PUT  /api/routes/<id>  {permission: 'public'} → 400 (H1 reject)
#   T18  Alice DELETE /api/memory-subscriptions/<Bob> → 200
#
# Cleanup at end: remove the Alice↔Bob friend pair and any test-created hidden_items
# so the seed test state is restored.

set -e

SSH="ssh root@122.51.174.118"
API="http://localhost:3001/api"
DB_EXEC="docker exec ainews-db sh -c"

# Helper: run on the aliyun server (curl + jq are present there)
function on_server() {
  $SSH "$@"
}

# Helper: run a MySQL query and return raw lines
function mysql_q() {
  $SSH "$DB_EXEC 'mysql -uroot -p\$MYSQL_ROOT_PASSWORD -N cairn -e \"$1\"'" 2>&1 | grep -v Warning
}

PASS=0
FAIL=0
function check() {
  local label="$1"; local expected="$2"; local actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    echo "  ✓ $label  ($actual)"
    PASS=$((PASS+1))
  else
    echo "  ✗ $label  expected=$expected actual=$actual"
    FAIL=$((FAIL+1))
  fi
}

echo "=========================================="
echo "STORY-00528 Integration Tests"
echo "=========================================="

# ── Pull mock user ids
ALICE_ID=$(mysql_q "SELECT id FROM users WHERE email='1@cairn.demo';" | head -1)
BOB_ID=$(mysql_q "SELECT id FROM users WHERE email='2@cairn.demo';" | head -1)
CAROL_ID=$(mysql_q "SELECT id FROM users WHERE email='3@cairn.demo';" | head -1)
echo "Mock ids: Alice=$ALICE_ID Bob=$BOB_ID Carol=$CAROL_ID"

# ── T01 Alice login
ALICE_TOKEN=$($SSH "curl -s -X POST $API/auth/login -H 'Content-Type: application/json' -d '{\"email\":\"1@cairn.demo\",\"password\":\"1\"}'" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")
check "T01 Alice login" "true" "$([[ -n "$ALICE_TOKEN" ]] && echo true || echo false)"

# ── T02 Bob login
BOB_TOKEN=$($SSH "curl -s -X POST $API/auth/login -H 'Content-Type: application/json' -d '{\"email\":\"2@cairn.demo\",\"password\":\"2\"}'" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")
check "T02 Bob login"   "true" "$([[ -n "$BOB_TOKEN" ]] && echo true || echo false)"

# ── T03 Alice POST subscription to Bob (NOT friends yet) → 403
CODE=$($SSH "curl -s -o /dev/null -w '%{http_code}' -X POST $API/memory-subscriptions \
  -H 'Authorization: Bearer $ALICE_TOKEN' -H 'Content-Type: application/json' \
  -d '{\"friend_id\":$BOB_ID}'")
check "T03 sub-before-friend → 403" "403" "$CODE"

# ── T04 Establish Alice↔Bob friendship directly (bypass UI for test)
mysql_q "INSERT IGNORE INTO friends (user_id, friend_id, created_at) VALUES ($ALICE_ID,$BOB_ID,NOW()),($BOB_ID,$ALICE_ID,NOW());" > /dev/null
FRIEND_COUNT=$(mysql_q "SELECT COUNT(*) FROM friends WHERE (user_id=$ALICE_ID AND friend_id=$BOB_ID) OR (user_id=$BOB_ID AND friend_id=$ALICE_ID);" | head -1)
check "T04 friend pair inserted"     "2"   "$FRIEND_COUNT"

# ── T05 Alice POST subscription to Bob → 201
CODE=$($SSH "curl -s -o /dev/null -w '%{http_code}' -X POST $API/memory-subscriptions \
  -H 'Authorization: Bearer $ALICE_TOKEN' -H 'Content-Type: application/json' \
  -d '{\"friend_id\":$BOB_ID}'")
check "T05 sub-after-friend → 201"   "201" "$CODE"

# ── T06 duplicate subscription → 409
CODE=$($SSH "curl -s -o /dev/null -w '%{http_code}' -X POST $API/memory-subscriptions \
  -H 'Authorization: Bearer $ALICE_TOKEN' -H 'Content-Type: application/json' \
  -d '{\"friend_id\":$BOB_ID}'")
check "T06 duplicate sub → 409"      "409" "$CODE"

# ── T07 list subscriptions
SUB_LIST=$($SSH "curl -s $API/memory-subscriptions -H 'Authorization: Bearer $ALICE_TOKEN'")
SUB_COUNT=$(echo "$SUB_LIST" | python3 -c "import sys,json; print(json.load(sys.stdin).get('count',-1))")
SUB_LIMIT=$(echo "$SUB_LIST" | python3 -c "import sys,json; print(json.load(sys.stdin).get('limit',-1))")
check "T07 sub list count"           "1"   "$SUB_COUNT"
check "T07 sub list limit"           "5"   "$SUB_LIMIT"

# ── T08 circle/markers contains Bob's 8 marks
MARK_COUNT=$($SSH "curl -s $API/circle/markers -H 'Authorization: Bearer $ALICE_TOKEN'" \
  | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('markers',[])))")
check "T08 circle/markers count"     "8"   "$MARK_COUNT"

# ── T09 circle/routes contains Bob's 1 route
ROUTE_COUNT=$($SSH "curl -s $API/circle/routes -H 'Authorization: Bearer $ALICE_TOKEN'" \
  | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('routes',[])))")
check "T09 circle/routes count"      "1"   "$ROUTE_COUNT"

# ── T10 circle/fog — Bob has no memory_points (seed didn't add any), so 0
FOG_RESP=$($SSH "curl -s $API/circle/fog -H 'Authorization: Bearer $ALICE_TOKEN'")
FOG_FRIEND_COUNT=$(echo "$FOG_RESP" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('friend_points',[])))")
# Bob has 0 memory_points in seed → expect 0 friend groups in response
check "T10 circle/fog friend-groups" "0"   "$FOG_FRIEND_COUNT"

# ── T11 public markers in 9163-area bbox
PUB_RESP=$($SSH "curl -s '$API/markers/public?bbox=31.18,121.38,31.28,121.48' -H 'Authorization: Bearer $ALICE_TOKEN'")
PUB_COUNT=$(echo "$PUB_RESP" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('markers',[])))")
# Seed: x1=1, x2=3, x3=5 (but x3 has marks scattered — only some in bbox), Carol=4 publics.
# Within bbox 31.18-31.28, 121.38-121.48: x1 (1), x2 (3), Carol (4),
# x3 "East trail" 31.230/121.475 in, "Center misc" 31.225/121.430 in,
# x3 "Far north" 31.275/121.470 in, x3 "Far south" 31.190/121.395 in,
# x3 "West clearing" 31.240/121.390 in.
# All 5 x3 marks are inside the bbox.
# Total: 1+3+5+4 = 13. Verify by also computing in DB.
EXPECTED_PUB=$(mysql_q "SELECT COUNT(*) FROM markers WHERE permission='public' AND status='healthy' AND lat BETWEEN 31.18 AND 31.28 AND lng BETWEEN 121.38 AND 121.48;" | head -1)
check "T11 public markers count"     "$EXPECTED_PUB"  "$PUB_COUNT"

# Capture one Carol public mark id for hide test
CAROL_PUB_ID=$(mysql_q "SELECT id FROM markers WHERE user_id=$CAROL_ID AND permission='public' ORDER BY id ASC LIMIT 1;" | head -1)

# ── T12 hide Carol's mark
CODE=$($SSH "curl -s -o /dev/null -w '%{http_code}' -X POST $API/hide \
  -H 'Authorization: Bearer $ALICE_TOKEN' -H 'Content-Type: application/json' \
  -d '{\"item_type\":\"mark\",\"item_id\":$CAROL_PUB_ID}'")
check "T12 hide carol mark → 201"    "201" "$CODE"

# ── T13 public bbox re-query (should be one fewer)
PUB_RESP2=$($SSH "curl -s '$API/markers/public?bbox=31.18,121.38,31.28,121.48' -H 'Authorization: Bearer $ALICE_TOKEN'")
PUB_COUNT2=$(echo "$PUB_RESP2" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('markers',[])))")
EXPECTED_PUB2=$((EXPECTED_PUB - 1))
check "T13 public after hide"        "$EXPECTED_PUB2" "$PUB_COUNT2"

# ── T14 POST /api/markers permission=public → 400
CODE=$($SSH "curl -s -o /dev/null -w '%{http_code}' -X POST $API/markers \
  -H 'Authorization: Bearer $ALICE_TOKEN' -H 'Content-Type: application/json' \
  -d '{\"type\":\"cairn\",\"lat\":31.234,\"lng\":121.435,\"permission\":\"public\"}'")
check "T14 POST mark public → 400"   "400" "$CODE"

# ── T15 PUT existing Alice mark to public → 400. Need an Alice mark id.
ALICE_MARK_ID=$(mysql_q "SELECT id FROM markers WHERE user_id=$ALICE_ID ORDER BY id ASC LIMIT 1;" | head -1)
CODE=$($SSH "curl -s -o /dev/null -w '%{http_code}' -X PUT $API/markers/$ALICE_MARK_ID \
  -H 'Authorization: Bearer $ALICE_TOKEN' -H 'Content-Type: application/json' \
  -d '{\"permission\":\"public\"}'")
check "T15 PUT mark public → 400"    "400" "$CODE"

# ── T16 POST /api/routes permission=public → 400
CODE=$($SSH "curl -s -o /dev/null -w '%{http_code}' -X POST $API/routes \
  -H 'Authorization: Bearer $ALICE_TOKEN' -H 'Content-Type: application/json' \
  -d '{\"name\":\"x\",\"points\":[{\"lat\":31.232,\"lng\":121.434}],\"permission\":\"public\"}'")
check "T16 POST route public → 400"  "400" "$CODE"

# ── T17 PUT existing Alice route to public → 400.
ALICE_ROUTE_ID=$(mysql_q "SELECT id FROM routes WHERE user_id=$ALICE_ID ORDER BY id ASC LIMIT 1;" | head -1)
CODE=$($SSH "curl -s -o /dev/null -w '%{http_code}' -X PUT $API/routes/$ALICE_ROUTE_ID \
  -H 'Authorization: Bearer $ALICE_TOKEN' -H 'Content-Type: application/json' \
  -d '{\"name\":\"Alice loop A renamed\",\"points\":[{\"lat\":31.235,\"lng\":121.438}],\"permission\":\"public\"}'")
check "T17 PUT route public → 400"   "400" "$CODE"

# ── T18 DELETE subscription
CODE=$($SSH "curl -s -o /dev/null -w '%{http_code}' -X DELETE $API/memory-subscriptions/$BOB_ID \
  -H 'Authorization: Bearer $ALICE_TOKEN'")
check "T18 DELETE sub → 200"         "200" "$CODE"

# ── Cleanup
mysql_q "DELETE FROM friends WHERE (user_id=$ALICE_ID AND friend_id=$BOB_ID) OR (user_id=$BOB_ID AND friend_id=$ALICE_ID);" > /dev/null
mysql_q "DELETE FROM hidden_items WHERE user_id=$ALICE_ID;" > /dev/null
echo ""
echo "=========================================="
echo "PASS=$PASS FAIL=$FAIL"
echo "=========================================="
exit $FAIL
