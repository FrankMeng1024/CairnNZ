"""V4.7 — 生成 5 个 type 的 label 卡片 PNG,Unity quad 贴图用。
对照 HTML demo line 60-66 黑底圆角卡片 + 金色 type 标签 + 白字主体 + 灰字 author。
"""
import os
from PIL import Image, ImageDraw, ImageFont

TYPES = [
    {"id": "cairn",    "title": "CAIRN",    "note": "路过留念。视野很好。",   "author": "Henare",   "days": "5D",   "color": (232, 199, 152)},  # 0.91*255 0.78*255 0.59*255
    {"id": "danger",   "title": "DANGER",   "note": "湿滑。小心。",           "author": "Sarah",    "days": "12D",  "color": (255, 41, 26)},
    {"id": "water",    "title": "WATER",    "note": "清澈溪水。可饮。",       "author": "Te Aroha", "days": "3D",   "color": (89, 230, 255)},
    {"id": "junction", "title": "JUNCTION", "note": "分叉路。北 → 山顶。",    "author": "Manaia",   "days": "7D",   "color": (196, 232, 71)},
    {"id": "hut",      "title": "HUT",      "note": "紧急避难所 200m 西北。", "author": "DOC",      "days": "18D",  "color": (212, 161, 107)},
]

W, H = 700, 210  # 70cm × 21cm × 10px/cm
OUT_DIR = "UnityARLib/Assets/Textures"

# 找系统字体支持中文
font_paths = [
    "C:/Windows/Fonts/msyhbd.ttc",  # 微软雅黑 Bold
    "C:/Windows/Fonts/msyh.ttc",    # 微软雅黑
    "C:/Windows/Fonts/simhei.ttf",  # 黑体
    "C:/Windows/Fonts/arialbd.ttf",
]
font_path = None
for p in font_paths:
    if os.path.exists(p):
        font_path = p
        break

if not font_path:
    raise RuntimeError("找不到中文字体")

font_title  = ImageFont.truetype(font_path, 24)
font_note   = ImageFont.truetype(font_path, 30)
font_author = ImageFont.truetype(font_path, 18)

os.makedirs(OUT_DIR, exist_ok=True)

for t in TYPES:
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # 黑底圆角矩形(rgba=8,12,18,235)
    d.rounded_rectangle((0, 0, W-1, H-1), radius=14, fill=(8, 12, 18, 235))
    # 顶部条 type-color 暗化(*0.20)
    header_h = 48
    hc = (int(t["color"][0] * 0.20), int(t["color"][1] * 0.20), int(t["color"][2] * 0.20), 255)
    d.rounded_rectangle((0, 0, W-1, header_h), radius=14, fill=hc)
    # 切掉底部圆角(用矩形覆盖)
    d.rectangle((0, header_h - 14, W-1, header_h), fill=hc)

    # title 左上(typeColor 偏白:r*1.0, g*0.95, b*0.7)
    title_col = (min(255, int(t["color"][0] * 1.0)), min(255, int(t["color"][1] * 0.95)), min(255, int(t["color"][2] * 0.70)), 255)
    d.text((20, 12), t["title"], font=font_title, fill=title_col)

    # daysAgo 右上
    days_w = d.textlength(t["days"], font=font_title)
    d.text((W - 20 - days_w, 12), t["days"], font=font_title, fill=title_col)

    # note 中间(白字 0.87, 0.89, 0.93)
    note_col = (222, 227, 237, 255)
    note_w = d.textlength(t["note"], font=font_note)
    d.text(((W - note_w) / 2, header_h + 30), t["note"], font=font_note, fill=note_col)

    # author 底部(灰字 0.49, 0.53, 0.59)
    auth_col = (125, 135, 150, 255)
    auth_text = f"— {t['author']}, {t['days']} ago"
    auth_w = d.textlength(auth_text, font=font_author)
    d.text(((W - auth_w) / 2, H - 35), auth_text, font=font_author, fill=auth_col)

    # V4.7 fix: Quad 朝相机要 180°Y 旋转,文字会水平镜像
    # 在 Python 端预先水平翻转 PNG,Unity 端旋转后字正过来
    img = img.transpose(Image.FLIP_LEFT_RIGHT)

    out_path = os.path.join(OUT_DIR, f"V4_label_{t['id']}.png")
    img.save(out_path)
    print(f"saved {out_path}")
