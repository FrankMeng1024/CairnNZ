#!/bin/bash
# Runs ON the aliyun server. Same test plan as integration_test_story_528.sh.
# DO NOT use `set -e` — we want every assertion to run even if one fails so
# the operator sees the full PASS/FAIL matrix on every invocation.
DB_PW="$MYSQL_ROOT_PASSWORD"
API="http://localhost:3001/api"

# All queries go through docker exec ainews-db. Use heredoc-style for cleanliness.
function mysqlq() {
  docker exec ainews-db sh -c "mysql -uroot -p\$MYSQL_ROOT_PASSWORD -N cairn -e \"$1\"" 2>&1 | grep -v Warning
}

PASS=0; FAIL=0
function check() {
  local label="$1"; local expected="$2"; local actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    echo "  PASS $label  ($actual)"; PASS=$((PASS+1))
  else
    echo "  FAIL $label  expected=[$expected] actual=[$actual]"; FAIL=$((FAIL+1))
  fi
}

echo "=========================================="
echo "STORY-00528 Integration Tests (server-side)"
echo "=========================================="

ALICE_ID=$(mysqlq "SELECT id FROM users WHERE email='1@cairn.demo';" | head -1)
BOB_ID=$(mysqlq "SELECT id FROM users WHERE email='2@cairn.demo';" | head -1)
CAROL_ID=$(mysqlq "SELECT id FROM users WHERE email='3@cairn.demo';" | head -1)
echo "Mock ids: Alice=$ALICE_ID Bob=$BOB_ID Carol=$CAROL_ID"

# Pre-clean: clear any leftover state from prior runs scoped to the mock users.
# Safe because mock users have no production data.
mysqlq "DELETE FROM memory_subscriptions WHERE user_id IN ($ALICE_ID,$BOB_ID) OR friend_id IN ($ALICE_ID,$BOB_ID);" > /dev/null
mysqlq "DELETE FROM friends WHERE user_id IN ($ALICE_ID,$BOB_ID,$CAROL_ID) OR friend_id IN ($ALICE_ID,$BOB_ID,$CAROL_ID);" > /dev/null
mysqlq "DELETE FROM hidden_items WHERE user_id = $ALICE_ID;" > /dev/null

ALICE_TOKEN=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' -d '{"email":"1@cairn.demo","password":"1"}' | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")
check "T01 Alice login" "true" "$([[ -n "$ALICE_TOKEN" ]] && echo true || echo false)"

BOB_TOKEN=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' -d '{"email":"2@cairn.demo","password":"2"}' | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")
check "T02 Bob login"   "true" "$([[ -n "$BOB_TOKEN" ]] && echo true || echo false)"

CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/memory-subscriptions \
  -H "Authorization: Bearer $ALICE_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"friend_id\":$BOB_ID}")
check "T03 sub-before-friend → 403" "403" "$CODE"

mysqlq "INSERT IGNORE INTO friends (user_id, friend_id, created_at) VALUES ($ALICE_ID,$BOB_ID,NOW()),($BOB_ID,$ALICE_ID,NOW());" > /dev/null
FRIEND_COUNT=$(mysqlq "SELECT COUNT(*) FROM friends WHERE (user_id=$ALICE_ID AND friend_id=$BOB_ID) OR (user_id=$BOB_ID AND friend_id=$ALICE_ID);" | head -1)
check "T04 friend pair inserted"     "2"   "$FRIEND_COUNT"

CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/memory-subscriptions \
  -H "Authorization: Bearer $ALICE_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"friend_id\":$BOB_ID}")
check "T05 sub-after-friend → 201"   "201" "$CODE"

CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/memory-subscriptions \
  -H "Authorization: Bearer $ALICE_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"friend_id\":$BOB_ID}")
check "T06 duplicate sub → 409"      "409" "$CODE"

SUB_LIST=$(curl -s $API/memory-subscriptions -H "Authorization: Bearer $ALICE_TOKEN")
SUB_COUNT=$(echo "$SUB_LIST" | python3 -c "import sys,json; print(json.load(sys.stdin).get('count',-1))")
SUB_LIMIT=$(echo "$SUB_LIST" | python3 -c "import sys,json; print(json.load(sys.stdin).get('limit',-1))")
check "T07 sub list count"           "1"   "$SUB_COUNT"
check "T07 sub list limit"           "5"   "$SUB_LIMIT"

MARK_COUNT=$(curl -s $API/circle/markers -H "Authorization: Bearer $ALICE_TOKEN" \
  | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('markers',[])))")
check "T08 circle/markers count"     "8"   "$MARK_COUNT"

ROUTE_COUNT=$(curl -s $API/circle/routes -H "Authorization: Bearer $ALICE_TOKEN" \
  | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('routes',[])))")
check "T09 circle/routes count"      "1"   "$ROUTE_COUNT"

FOG_FRIEND_COUNT=$(curl -s $API/circle/fog -H "Authorization: Bearer $ALICE_TOKEN" \
  | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('friend_points',[])))")
# Bob now has 3 memory_points seeded → expect 1 friend group with 3 points.
check "T10 circle/fog friend-groups" "1"   "$FOG_FRIEND_COUNT"
# Layer 3 check: verify the points actually round-trip.
FOG_POINT_COUNT=$(curl -s $API/circle/fog -H "Authorization: Bearer $ALICE_TOKEN" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['friend_points'][0]['points']) if d['friend_points'] else 0)")
check "T10b circle/fog Bob points"   "3"   "$FOG_POINT_COUNT"

PUB_RESP=$(curl -s "$API/markers/public?bbox=31.18,121.38,31.28,121.48" -H "Authorization: Bearer $ALICE_TOKEN")
PUB_COUNT=$(echo "$PUB_RESP" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('markers',[])))")
EXPECTED_PUB=$(mysqlq "SELECT COUNT(*) FROM markers WHERE permission='public' AND status='healthy' AND lat BETWEEN 31.18 AND 31.28 AND lng BETWEEN 121.38 AND 121.48;" | head -1)
check "T11 public markers count"     "$EXPECTED_PUB"  "$PUB_COUNT"

CAROL_PUB_ID=$(mysqlq "SELECT id FROM markers WHERE user_id=$CAROL_ID AND permission='public' ORDER BY id ASC LIMIT 1;" | head -1)
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/hide \
  -H "Authorization: Bearer $ALICE_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"item_type\":\"mark\",\"item_id\":$CAROL_PUB_ID}")
check "T12 hide carol mark → 201"    "201" "$CODE"

PUB_RESP2=$(curl -s "$API/markers/public?bbox=31.18,121.38,31.28,121.48" -H "Authorization: Bearer $ALICE_TOKEN")
PUB_COUNT2=$(echo "$PUB_RESP2" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('markers',[])))")
EXPECTED_PUB2=$((EXPECTED_PUB - 1))
check "T13 public after hide"        "$EXPECTED_PUB2" "$PUB_COUNT2"

CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/markers \
  -H "Authorization: Bearer $ALICE_TOKEN" -H 'Content-Type: application/json' \
  -d '{"type":"cairn","lat":31.234,"lng":121.435,"permission":"public"}')
check "T14 POST mark public → 400"   "400" "$CODE"

ALICE_MARK_ID=$(mysqlq "SELECT id FROM markers WHERE user_id=$ALICE_ID ORDER BY id ASC LIMIT 1;" | head -1)
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X PUT $API/markers/$ALICE_MARK_ID \
  -H "Authorization: Bearer $ALICE_TOKEN" -H 'Content-Type: application/json' \
  -d '{"permission":"public"}')
check "T15 PUT mark public → 400"    "400" "$CODE"

CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/routes \
  -H "Authorization: Bearer $ALICE_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"x","points":[{"lat":31.232,"lng":121.434}],"permission":"public"}')
check "T16 POST route public → 400"  "400" "$CODE"

ALICE_ROUTE_ID=$(mysqlq "SELECT id FROM routes WHERE user_id=$ALICE_ID ORDER BY id ASC LIMIT 1;" | head -1)
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X PUT $API/routes/$ALICE_ROUTE_ID \
  -H "Authorization: Bearer $ALICE_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Alice loop A","points":[{"lat":31.235,"lng":121.438}],"permission":"public"}')
check "T17 PUT route public → 400"   "400" "$CODE"

CODE=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE $API/memory-subscriptions/$BOB_ID \
  -H "Authorization: Bearer $ALICE_TOKEN")
check "T18 DELETE sub → 200"         "200" "$CODE"

# ── T19 Route permission persistence (Arch review Medium issue fix)
# Re-subscribe to verify route appears
curl -s -o /dev/null -X POST $API/memory-subscriptions \
  -H "Authorization: Bearer $ALICE_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"friend_id\":$BOB_ID}"
# Bob POSTs a friend-tier route. Capture its id.
BOB_NEW_ROUTE_RESP=$(curl -s -X POST $API/routes \
  -H "Authorization: Bearer $BOB_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Bob friend route","points":[{"lat":31.25,"lng":121.45},{"lat":31.251,"lng":121.451}],"permission":"friend"}')
BOB_NEW_ROUTE_PERM=$(echo "$BOB_NEW_ROUTE_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('route',{}).get('permission',''))")
check "T19 new route persists 'friend'" "friend" "$BOB_NEW_ROUTE_PERM"

# T20 Alice circle/routes now sees Bob's 1 seeded + 1 new = 2
NEW_ROUTE_COUNT=$(curl -s $API/circle/routes -H "Authorization: Bearer $ALICE_TOKEN" \
  | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('routes',[])))")
# Note: seed route inserted Bob's 1 with permission='friend' at seed time, so this should be 2.
check "T20 circle/routes after add"  "2"   "$NEW_ROUTE_COUNT"

# T21 personal route is NOT visible in circle (must verify the filter works the other way)
curl -s -o /dev/null -X POST $API/routes \
  -H "Authorization: Bearer $BOB_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Bob personal route","points":[{"lat":31.25,"lng":121.45}],"permission":"personal"}'
ROUTE_COUNT_AFTER_PERSONAL=$(curl -s $API/circle/routes -H "Authorization: Bearer $ALICE_TOKEN" \
  | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('routes',[])))")
check "T21 personal NOT in circle"   "2"   "$ROUTE_COUNT_AFTER_PERSONAL"

# Cleanup
mysqlq "DELETE FROM memory_subscriptions WHERE user_id=$ALICE_ID;" > /dev/null
mysqlq "DELETE FROM routes WHERE user_id=$BOB_ID AND name LIKE 'Bob % route';" > /dev/null
mysqlq "DELETE FROM friends WHERE (user_id=$ALICE_ID AND friend_id=$BOB_ID) OR (user_id=$BOB_ID AND friend_id=$ALICE_ID);" > /dev/null
mysqlq "DELETE FROM hidden_items WHERE user_id=$ALICE_ID;" > /dev/null
echo ""
echo "=========================================="
echo "PASS=$PASS FAIL=$FAIL"
echo "=========================================="
exit $FAIL
