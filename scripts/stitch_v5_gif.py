"""V5 — 把 v024-capture 的帧 stitch 成 GIF + 5 type stack PNG。
生成:
  _review/v0.2.4/V5-flipbook-anim.gif   (60 帧 ribbon 动画)
  _review/v0.2.4/V5-flipbook-ceremony.gif (24 帧 仪式)
  _review/v0.2.4/V5-5-types-stack.png   (5 type 横向并排)
  _review/v0.2.4/V5-flipbook-final.gif  (ceremony + anim 合一,主推看)
"""
import os
import glob
from PIL import Image

CAP = "UnityARLib/Logs/v024-capture"
OUT = "_review/v0.2.4"
os.makedirs(OUT, exist_ok=True)


def make_gif(frames, out_path, duration_ms=80, loop=0):
    if not frames:
        print(f"  [skip] {out_path}: no frames")
        return
    imgs = [Image.open(f).convert("RGBA") for f in frames]
    # Convert to P palette for smaller GIF
    imgs[0].save(
        out_path,
        save_all=True,
        append_images=imgs[1:],
        duration=duration_ms,
        loop=loop,
        disposal=2,
        optimize=True,
    )
    size_kb = os.path.getsize(out_path) // 1024
    print(f"  [ok] {out_path}  ({len(imgs)} frames, {size_kb}KB)")


# 1. anim flipbook
anim_frames = sorted(glob.glob(f"{CAP}/anim/frame-*.png"))
make_gif(anim_frames, f"{OUT}/V5-flipbook-anim.gif", duration_ms=66)

# 2. ceremony flipbook
ceremony_frames = sorted(glob.glob(f"{CAP}/ceremony-*.png"))
make_gif(ceremony_frames, f"{OUT}/V5-flipbook-ceremony.gif", duration_ms=80)

# 3. ceremony + anim 合并 GIF
combined = ceremony_frames + anim_frames
make_gif(combined, f"{OUT}/V5-flipbook-final.gif", duration_ms=70)

# 4. 5 type stack(横向并排)
types = ["cairn", "danger", "water", "junction", "hut"]
type_imgs = []
for t in types:
    p = f"{CAP}/type-{t}.png"
    if os.path.exists(p):
        type_imgs.append((t, Image.open(p).convert("RGBA")))

if type_imgs:
    # 假设所有图同尺寸,横拼
    w, h = type_imgs[0][1].size
    stack = Image.new("RGBA", (w * len(type_imgs), h), (0, 0, 0, 0))
    for i, (t, img) in enumerate(type_imgs):
        stack.paste(img, (i * w, 0), img)
    stack.save(f"{OUT}/V5-5-types-stack.png")
    print(f"  [ok] {OUT}/V5-5-types-stack.png  ({len(type_imgs)} types, {w*len(type_imgs)}x{h})")
