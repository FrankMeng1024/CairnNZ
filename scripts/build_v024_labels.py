"""V5.2 — 生成 5 个 type 的 label 卡片 PNG,带 type icon (而非纯文字)。
对应用户 40/100 review:
  "中间的图标太大了 而且 cairn 也没按照我们 logo 的样式来做
   其他的图形我看不到 但是估计也不符合我们的 app type 的 icon 要求"

修法:
1. label PNG 尺寸缩小 700x210 → 500x150 (Unity quad 缩 30%)
2. 左侧 80px 区域画 type icon(对应 markerTypes.ts 的 icon)
   - cairn: CairnStoneIcon 3 stone stack(对应 app 自定义 SVG)
   - danger: TriangleAlert(三角警告)
   - water: Droplets(水滴)
   - junction: Navigation2(箭头)
   - hut: House(屋顶)
3. 字体保留中文支持但缩小,不再遮挡
"""
import os
import math
from PIL import Image, ImageDraw, ImageFont

TYPES = [
    {"id": "cairn",    "title": "CAIRN",    "note": "路过留念。",       "author": "Henare",   "days": "5D",   "color": (232, 199, 152)},
    {"id": "danger",   "title": "DANGER",   "note": "湿滑。小心。",     "author": "Sarah",    "days": "12D",  "color": (255, 41, 26)},
    {"id": "water",    "title": "WATER",    "note": "清澈溪水。",       "author": "Te Aroha", "days": "3D",   "color": (89, 230, 255)},
    {"id": "junction", "title": "JUNCTION", "note": "北 → 山顶。",      "author": "Manaia",   "days": "7D",   "color": (196, 232, 71)},
    {"id": "hut",      "title": "HUT",      "note": "避难所 200m。",    "author": "DOC",      "days": "18D",  "color": (212, 161, 107)},
]

# V5.2 缩小 700x210 → 500x150,Unity quad 端再缩 0.5m → 0.35m
W, H = 500, 150
ICON_AREA_W = 80   # 左侧 icon 区域 80px
ICON_PAD = 12      # icon 区内边距
OUT_DIR = "UnityARLib/Assets/Textures"

font_paths = [
    "C:/Windows/Fonts/msyhbd.ttc",
    "C:/Windows/Fonts/msyh.ttc",
    "C:/Windows/Fonts/simhei.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
]
font_path = next((p for p in font_paths if os.path.exists(p)), None)
if not font_path:
    raise RuntimeError("找不到中文字体")

font_title  = ImageFont.truetype(font_path, 18)
font_note   = ImageFont.truetype(font_path, 22)
font_author = ImageFont.truetype(font_path, 14)


def draw_cairn_icon(d, cx, cy, size, color):
    """三个堆叠石头椭圆,对应 app/src/components/CairnStoneIcon.tsx
    base 最大 中间 偏左 上面最小 偏右
    """
    s = size / 24.0  # 24x24 viewBox 缩放系数
    # base stone (cx=11.5,cy=19,rx=8,ry=2.6 in 24x24)
    bx = cx - (12 - 11.5) * s
    by = cy + (19 - 12) * s
    rx, ry = 8 * s, 2.6 * s
    d.ellipse((bx - rx, by - ry, bx + rx, by + ry), fill=color)
    # middle stone (cx=10.5,cy=13.6,rx=6,ry=2.2)
    mx = cx - (12 - 10.5) * s
    my = cy + (13.6 - 12) * s
    rx, ry = 6 * s, 2.2 * s
    d.ellipse((mx - rx, my - ry, mx + rx, my + ry), fill=color)
    # top stone (cx=13,cy=8.5,rx=3.6,ry=1.8)
    tx = cx + (13 - 12) * s
    ty = cy + (8.5 - 12) * s
    rx, ry = 3.6 * s, 1.8 * s
    d.ellipse((tx - rx, ty - ry, tx + rx, ty + ry), fill=color)


def draw_triangle_alert(d, cx, cy, size, color):
    """lucide TriangleAlert 简化:三角形 + 中间感叹号"""
    half = size / 2
    pts = [(cx, cy - half * 0.85), (cx - half * 0.95, cy + half * 0.7), (cx + half * 0.95, cy + half * 0.7)]
    d.polygon(pts, outline=color, width=4)
    # 感叹号
    bar_w = max(2, int(size * 0.06))
    d.rectangle((cx - bar_w, cy - half * 0.25, cx + bar_w, cy + half * 0.25), fill=color)
    d.ellipse((cx - bar_w, cy + half * 0.4, cx + bar_w, cy + half * 0.55), fill=color)


def draw_droplets(d, cx, cy, size, color):
    """lucide Droplets 简化:两滴水珠"""
    s = size / 2
    # 主水珠
    d.ellipse((cx - s * 0.55, cy - s * 0.1, cx + s * 0.45, cy + s * 0.85), fill=color)
    # 水滴尖(三角)
    d.polygon([(cx - s * 0.05, cy - s * 0.85), (cx - s * 0.55, cy + s * 0.1), (cx + s * 0.45, cy + s * 0.1)], fill=color)
    # 第二小水珠
    d.ellipse((cx + s * 0.15, cy - s * 0.5, cx + s * 0.85, cy + s * 0.2), fill=color)


def draw_navigation(d, cx, cy, size, color):
    """lucide Navigation2 简化:向上箭头"""
    half = size / 2
    pts = [
        (cx, cy - half * 0.85),
        (cx + half * 0.7, cy + half * 0.7),
        (cx, cy + half * 0.3),
        (cx - half * 0.7, cy + half * 0.7),
    ]
    d.polygon(pts, fill=color)


def draw_house(d, cx, cy, size, color):
    """lucide House 简化:屋顶 + 墙"""
    s = size / 2
    # 屋顶三角
    d.polygon([(cx, cy - s * 0.85), (cx - s * 0.85, cy - s * 0.05), (cx + s * 0.85, cy - s * 0.05)],
              outline=color, width=4)
    # 墙体
    d.rectangle((cx - s * 0.6, cy - s * 0.05, cx + s * 0.6, cy + s * 0.7), outline=color, width=4)
    # 门
    d.rectangle((cx - s * 0.18, cy + s * 0.2, cx + s * 0.18, cy + s * 0.7), fill=color)


ICON_DRAWERS = {
    "cairn": draw_cairn_icon,
    "danger": draw_triangle_alert,
    "water": draw_droplets,
    "junction": draw_navigation,
    "hut": draw_house,
}

os.makedirs(OUT_DIR, exist_ok=True)

for t in TYPES:
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # 黑底圆角
    d.rounded_rectangle((0, 0, W-1, H-1), radius=12, fill=(8, 12, 18, 235))

    # 左侧 icon 区域 — 用 type 主色画 icon
    icon_cx = ICON_PAD + (ICON_AREA_W - ICON_PAD * 2) // 2 + ICON_PAD // 2
    icon_cy = H // 2
    icon_size = ICON_AREA_W - ICON_PAD * 2
    icon_color = (t["color"][0], t["color"][1], t["color"][2], 255)
    drawer = ICON_DRAWERS[t["id"]]
    drawer(d, icon_cx, icon_cy, icon_size, icon_color)

    # 右侧文字区 (从 ICON_AREA_W+12 开始)
    text_x = ICON_AREA_W + 12

    # title (type 主色偏白)
    title_col = (min(255, int(t["color"][0] * 1.0)), min(255, int(t["color"][1] * 0.95)), min(255, int(t["color"][2] * 0.75)), 255)
    d.text((text_x, 14), t["title"], font=font_title, fill=title_col)
    # daysAgo 同行右
    days_w = d.textlength(t["days"], font=font_title)
    d.text((W - 16 - days_w, 14), t["days"], font=font_title, fill=title_col)

    # note 中间(白字)
    note_col = (222, 227, 237, 255)
    d.text((text_x, 50), t["note"], font=font_note, fill=note_col)

    # author 底部(灰字)
    auth_col = (125, 135, 150, 255)
    auth_text = f"— {t['author']}, {t['days']} ago"
    d.text((text_x, H - 28), auth_text, font=font_author, fill=auth_col)

    # Quad 朝相机要 180°Y 旋转,文字会水平镜像 → Python 端预先翻转
    img = img.transpose(Image.FLIP_LEFT_RIGHT)

    out_path = os.path.join(OUT_DIR, f"V4_label_{t['id']}.png")
    img.save(out_path)
    print(f"saved {out_path}  ({W}x{H} with {t['id']} icon)")
