#!/usr/bin/env python3
"""v335 recovery: parse mysqlbinlog -vv DECODE-ROWS output, extract every
DELETE FROM cairn.sessions row, and emit INSERT statements that restore
exactly the same rows (preserving id via explicit primary key).

Run on server with mysqlbinlog installed.
"""
import re
import sys
import json

# Read binlog dump from stdin
import io
text = sys.stdin.buffer.read().decode('utf-8', errors='replace')

# Find all "### DELETE FROM `cairn`.`sessions`" blocks
# Each block is followed by "### WHERE" then a series of "###   @N=<value>"
# lines until the next "###" without @ prefix, or another `### `-prefixed
# section header (UPDATE/DELETE/INSERT).

blocks = re.split(r'^### DELETE FROM `cairn`\.`sessions`\s*$', text, flags=re.MULTILINE)
# blocks[0] is everything before the first match; blocks[1..] are the bodies
deletes = blocks[1:]
print(f"-- found {len(deletes)} DELETE blocks", file=sys.stderr)

# Build column name list (@1..@13 → schema)
COLS = [
    'id',             # @1 bigint
    'user_id',        # @2 bigint
    'route_id',       # @3 bigint nullable
    'type',           # @4 enum (1 = hiking, 2 = running)
    'start_time',     # @5 datetime
    'end_time',       # @6 datetime
    'distance_m',     # @7 float
    'duration_s',     # @8 int
    'name',           # @9 varchar(60) nullable
    'route_points',   # @10 json nullable
    'route_points_raw',  # @11 json nullable
    'flags',          # @12 json nullable
    'created_at',     # @13 timestamp
]

ENUM_MAP = {'1': 'hiking', '2': 'running'}

def parse_value(raw, col_idx):
    """raw is the part after the = sign in `###   @N=<raw>`. raw includes
    the inline comment, so we strip /* ... */ first."""
    # remove trailing inline comment
    raw = re.sub(r'\s*/\*.*\*/\s*$', '', raw)
    raw = raw.strip()
    col_name = COLS[col_idx]
    if raw == 'NULL':
        return 'NULL'
    # Enum col 'type' (index 3)
    if col_name == 'type':
        return f"'{ENUM_MAP.get(raw, raw)}'"
    # Numeric cols (no quotes)
    if col_name in ('id', 'user_id', 'route_id', 'distance_m', 'duration_s'):
        return raw
    # String / datetime / json — already wrapped in quotes from mysqlbinlog
    return raw

def sql_escape_json_field(raw):
    """JSON fields come out as 'wrapped string' from mysqlbinlog with
    embedded single quotes already escaped. Keep as-is — it's valid SQL."""
    return raw

# Parse each delete block
inserts = []
for body in deletes:
    # Body starts with "### WHERE" then column assignments.
    # Stop at the next blank line or non-### line.
    lines = body.split('\n')
    cols = {}
    for line in lines:
        m = re.match(r'^###\s+@(\d+)=(.+)$', line)
        if m:
            n = int(m.group(1)) - 1
            raw_val = m.group(2)
            # Strip inline comment
            val = re.sub(r'\s*/\*.*\*/\s*$', '', raw_val).strip()
            cols[n] = val
        elif line.startswith('### ') and ('@' not in line):
            # next block (UPDATE/DELETE/INSERT header) or '### SET' — stop
            if '@' not in line and ('FROM' in line or 'SET' in line or 'INTO' in line):
                break

    if len(cols) < 13:
        print(f"-- skipping block, only {len(cols)} cols", file=sys.stderr)
        continue

    # Build INSERT
    col_list = ', '.join(f'`{c}`' for c in COLS)
    val_list = []
    for i, c in enumerate(COLS):
        raw = cols[i]
        if raw == 'NULL':
            val_list.append('NULL')
        elif c == 'type':
            val_list.append(f"'{ENUM_MAP.get(raw, raw.strip(chr(39)))}'")
        elif c in ('id', 'user_id', 'route_id', 'distance_m', 'duration_s'):
            val_list.append(raw)
        else:
            # string / datetime / json — raw already has surrounding quotes
            val_list.append(raw)
    vals = ', '.join(val_list)
    inserts.append(f"INSERT INTO `sessions` ({col_list}) VALUES ({vals});")

# Print
print("-- v335 recovery: re-insert deleted sessions")
print("SET FOREIGN_KEY_CHECKS=0;")
for s in inserts:
    print(s)
print("SET FOREIGN_KEY_CHECKS=1;")
print(f"-- inserted {len(inserts)} rows", file=sys.stderr)
