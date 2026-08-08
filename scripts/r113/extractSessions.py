#!/usr/bin/env python3
"""
Extract session UPDATE row-images from mysqlbinlog DECODE-ROWS output and
generate INSERT statements for restoration.
"""
import re
import sys

TARGET_IDS = {1475, 1476, 1477}

RE_HEADER = re.compile(r'### (INSERT INTO|UPDATE) `cairn`\.`sessions`')
RE_COL = re.compile(r'###\s+@(\d+)=(.*)$')

def parse_binlog(fname):
    """Yield (id, final_row_dict) for each session UPDATE/INSERT, taking latest."""
    latest = {}
    in_sessions_block = False
    capturing_set = False
    block = []

    def flush(reason):
        nonlocal block
        if block:
            row = dict(block)
            sid_str = row.get(1, '').strip()
            try:
                sid = int(sid_str)
            except (ValueError, TypeError):
                sid = None
            if sid in TARGET_IDS:
                # For UPDATE this is the SET (post-image); for INSERT it's the row.
                # Only overwrite if new row has non-zero distance (skip empty INSERT).
                dist = row.get(8, '0').strip()
                try:
                    dist_v = float(dist)
                except ValueError:
                    dist_v = 0
                if sid not in latest or dist_v > 0:
                    latest[sid] = row
        block = []

    with open(fname, 'r', encoding='utf-8', errors='replace') as f:
        for line in f:
            line_stripped = line.rstrip('\n')
            # Session table header
            if RE_HEADER.search(line):
                flush('new block')
                in_sessions_block = True
                capturing_set = 'INSERT' in line  # for INSERT, next lines are the SET
                continue
            if not in_sessions_block:
                continue
            # SET or WHERE keyword line
            stripped = line_stripped.strip()
            if stripped == '### SET':
                flush('SET keyword — start new SET block')
                capturing_set = True
                continue
            if stripped == '### WHERE':
                flush('WHERE keyword')
                capturing_set = False
                continue
            # Column line
            m = RE_COL.match(line_stripped)
            if m:
                if capturing_set:
                    block.append((int(m.group(1)), m.group(2).rstrip()))
                continue
            # Non-### line — session block ends
            if not line_stripped.startswith('###') and stripped != '':
                flush('non-### line, end of block')
                in_sessions_block = False
                capturing_set = False
    flush('EOF')
    return latest

def emit_insert(sid, row):
    cols = ['id', 'user_id', 'route_id', 'type', 'start_time', 'end_time',
            'finalized_at', 'distance_m', 'duration_s', 'name',
            'route_points', 'route_points_raw', 'flags', 'created_at']
    def fmt(idx, val):
        v = val.strip() if val else 'NULL'
        if v == 'NULL':
            return 'NULL'
        col = cols[idx - 1]
        if col == 'type':
            return "'hiking'" if v == '1' else "'running'"
        if col == 'created_at':
            return f"FROM_UNIXTIME({v})"
        # Already-quoted datetimes / json / varchar / numeric
        return v
    vals = []
    for i in range(1, 15):
        v = row.get(i)
        vals.append('NULL' if v is None else fmt(i, v))
    col_list = ', '.join(f'`{c}`' for c in cols)
    val_list = ', '.join(vals)
    return f"INSERT INTO `sessions` ({col_list}) VALUES ({val_list});"

if __name__ == '__main__':
    fname = sys.argv[1]
    rows = parse_binlog(fname)
    print(f"-- Recovered {len(rows)} target sessions from binlog", file=sys.stderr)
    for sid in sorted(rows.keys()):
        row = rows[sid]
        dist = row.get(8, 'NULL').strip()
        dur = row.get(9, 'NULL').strip()
        name = row.get(10, 'NULL')
        pt_field = row.get(11, '[]')
        pt_count = pt_field.count('"lat"') if isinstance(pt_field, str) else 0
        print(f"-- Session {sid}: user={row.get(2)}, distance={dist}, dur={dur}, name={name}, points={pt_count}", file=sys.stderr)
    for sid in sorted(rows.keys()):
        print(emit_insert(sid, rows[sid]))
