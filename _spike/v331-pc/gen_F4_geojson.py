"""F4 — Verify world-rect-minus-one-circle polygon renders cleanly at all zooms.
This is the L1 layer of plan v2 architecture A1.
36 vertices total (4 outer + 32 inner). If this breaks earcut, A1 is dead.
"""
import json, math

USER_LAT, USER_LNG = 31.232, 121.457
CIRCLE_RADIUS_M = 2100  # 1.4 × 1500m padding (A1 says radius = padding * 1.4)
SEGMENTS = 32

M_PER_DEG_LAT = 111320
cos_lat = math.cos(math.radians(USER_LAT))

# Outer world rect (CCW per GeoJSON convention)
outer = [
    [-179.9, -85],
    [179.9, -85],
    [179.9, 85],
    [-179.9, 85],
    [-179.9, -85],
]

# Inner ring: circle around user (CW = opposite winding for hole)
inner = []
for i in range(SEGMENTS + 1):
    angle = 2 * math.pi * i / SEGMENTS
    # CW direction
    dx_m = CIRCLE_RADIUS_M * math.cos(-angle)
    dy_m = CIRCLE_RADIUS_M * math.sin(-angle)
    lat = USER_LAT + dy_m / M_PER_DEG_LAT
    lng = USER_LNG + dx_m / (M_PER_DEG_LAT * cos_lat)
    inner.append([lng, lat])

feature = {
    'type': 'Feature',
    'properties': {'outer_verts': 5, 'inner_verts': len(inner), 'total': 5 + len(inner)},
    'geometry': {
        'type': 'Polygon',
        'coordinates': [outer, inner],
    },
}

with open(r'C:/ClaudeCodeProjects/Cairn/_spike/v331-pc/F4_world_minus_circle.geojson', 'w') as f:
    json.dump(feature, f)
print(f"F4 polygon: outer 5 + inner {len(inner)} = {5 + len(inner)} vertices")
