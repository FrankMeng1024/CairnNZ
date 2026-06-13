"""V5.5 — HTML baseline vs Unity V5 输出 side-by-side 对比图。
左 HTML(Three.js,?v=22day10),右 Unity(V5 capture)。
用户铁律:任何 Unity 视觉改动必须 Playwright HTML + Unity 侧边对比。
"""
import os
from PIL import Image, ImageDraw, ImageFont

PAIRS = [
    # (label, html_screenshot, unity_screenshot, output)
    ("V5 cairn type frame-30 (HTML vs Unity V5 ribbon mid-life)",
     "_review/v0.2.4/HTML-cairn-V5-baseline.png",
     "UnityARLib/Logs/v024-capture/anim/frame-30.png",
     "_review/v0.2.4/SIDE-BY-SIDE-V5-cairn-mid.png"),
    ("V5 cairn type frame-45 (HTML vs Unity V5 ribbon late)",
     "_review/v0.2.4/HTML-cairn-V5-baseline.png",
     "UnityARLib/Logs/v024-capture/anim/frame-45.png",
     "_review/v0.2.4/SIDE-BY-SIDE-V5-cairn-late.png"),
    ("V5 ceremony frame-18 (HTML vs Unity ceremony 75%)",
     "_review/v0.2.4/HTML-cairn-V5-baseline.png",
     "UnityARLib/Logs/v024-capture/ceremony-18.png",
     "_review/v0.2.4/SIDE-BY-SIDE-V5-ceremony.png"),
]

font_path = "C:/Windows/Fonts/msyhbd.ttc"
if not os.path.exists(font_path):
    font_path = "C:/Windows/Fonts/arialbd.ttf"

font_label = ImageFont.truetype(font_path, 28)


for title, html_path, unity_path, out_path in PAIRS:
    if not os.path.exists(html_path):
        print(f"[skip] missing {html_path}")
        continue
    if not os.path.exists(unity_path):
        print(f"[skip] missing {unity_path}")
        continue

    html_img = Image.open(html_path).convert("RGBA")
    unity_img = Image.open(unity_path).convert("RGBA")

    # 统一高度(取较小值),按比例缩 width
    target_h = min(html_img.height, unity_img.height, 720)
    def fit(img, h):
        scale = h / img.height
        return img.resize((int(img.width * scale), h), Image.LANCZOS)
    html_img = fit(html_img, target_h)
    unity_img = fit(unity_img, target_h)

    title_h = 50
    gap = 20
    total_w = html_img.width + gap + unity_img.width
    total_h = target_h + title_h

    canvas = Image.new("RGBA", (total_w, total_h), (24, 22, 18, 255))
    d = ImageDraw.Draw(canvas)

    # 顶部 title
    d.text((20, 10), f"{title}  |  LEFT = HTML baseline (8766)  |  RIGHT = Unity V5",
           font=font_label, fill=(232, 199, 152, 255))

    canvas.paste(html_img, (0, title_h), html_img)
    canvas.paste(unity_img, (html_img.width + gap, title_h), unity_img)

    # 中间分隔线
    d.line([(html_img.width + gap // 2, title_h), (html_img.width + gap // 2, total_h)],
           fill=(255, 200, 100, 180), width=2)

    canvas.save(out_path)
    print(f"[ok] {out_path}  ({total_w}x{total_h})")
