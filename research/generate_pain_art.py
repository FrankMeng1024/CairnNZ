import json

# 4 张卡的 SVG art，每张 4 帧。
# 用 cream + ink 主题，简笔风格，每帧含：环境（山/海/路）+ 人物剪影 + 关键道具

# 共用 SVG 片段
def env_mountains(seed=1):
    """远中近三层山"""
    return f'''<defs><linearGradient id="bg-{seed}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--surface2)"/><stop offset="100%" stop-color="var(--surface)"/></linearGradient></defs>
<rect width="320" height="240" fill="url(#bg-{seed})"/>
<path d="M 0 90 L 60 65 L 130 80 L 200 55 L 280 75 L 320 70 L 320 240 L 0 240 Z" class="pain-shape-far"/>
<path d="M 0 130 L 70 110 L 140 125 L 210 100 L 280 120 L 320 110 L 320 240 L 0 240 Z" class="pain-shape-mid"/>
<path d="M 0 175 L 80 165 L 160 175 L 240 160 L 320 170 L 320 240 L 0 240 Z" class="pain-shape-near"/>'''

def env_coast(seed=2):
    """海岸线 - 远海 + 海岸"""
    return f'''<defs><linearGradient id="bg-{seed}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--surface2)"/><stop offset="100%" stop-color="var(--surface)"/></linearGradient></defs>
<rect width="320" height="240" fill="url(#bg-{seed})"/>
<rect x="0" y="120" width="320" height="60" fill="var(--surface3)" opacity="0.45"/>
<path d="M 0 175 L 60 165 L 130 175 L 200 160 L 280 170 L 320 165 L 320 240 L 0 240 Z" class="pain-shape-near"/>
<path d="M 0 120 L 80 115 L 160 122 L 240 110 L 320 118 L 320 145 L 0 145 Z" class="pain-shape-mid" opacity="0.6"/>'''

def env_summit(seed=3):
    """山顶 - 视野开阔，远海/远山 + 风感"""
    return f'''<defs><linearGradient id="bg-{seed}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--surface2)"/><stop offset="100%" stop-color="var(--surface)"/></linearGradient></defs>
<rect width="320" height="240" fill="url(#bg-{seed})"/>
<path d="M 0 90 L 60 60 L 130 75 L 200 50 L 280 70 L 320 65 L 320 240 L 0 240 Z" class="pain-shape-far" opacity="0.55"/>
<path d="M 0 200 Q 60 195 130 198 T 280 200 L 320 200 L 320 240 L 0 240 Z" class="pain-shape-near"/>
<path d="M 30 50 Q 50 40 70 50" class="pain-bird"/>
<path d="M 200 60 Q 220 50 240 60" class="pain-bird"/>'''

# 人物剪影 (简笔, 中性)
def figure_standing(x, y, scale=1.0, with_pack=True):
    s = scale
    pack = f'<rect x="{x-7*s}" y="{y-5*s}" width="{6*s}" height="{10*s}" rx="2" class="pain-pack"/>' if with_pack else ''
    return f'''<g>
  <ellipse cx="{x}" cy="{y+22*s}" rx="{9*s}" ry="2" class="pain-shadow"/>
  <circle cx="{x}" cy="{y-15*s}" r="{6*s}" class="pain-figure"/>
  <path d="M {x-1*s} {y-9*s} L {x-1*s} {y+8*s} L {x-5*s} {y+20*s} L {x-3*s} {y+20*s} L {x} {y+9*s} L {x+3*s} {y+20*s} L {x+5*s} {y+20*s} L {x+1*s} {y+8*s} L {x+1*s} {y-9*s} Z" class="pain-figure"/>
  <path d="M {x-1*s} {y-3*s} L {x-8*s} {y+4*s} L {x-7*s} {y+5*s} L {x} {y-1*s}" class="pain-figure"/>
  <path d="M {x+1*s} {y-3*s} L {x+8*s} {y+4*s} L {x+7*s} {y+5*s} L {x} {y-1*s}" class="pain-figure"/>
  {pack}
</g>'''

def figure_squat(x, y, scale=1.0):
    """蹲下"""
    s = scale
    return f'''<g>
  <ellipse cx="{x}" cy="{y+15*s}" rx="{10*s}" ry="2" class="pain-shadow"/>
  <circle cx="{x}" cy="{y-10*s}" r="{6*s}" class="pain-figure"/>
  <path d="M {x-1*s} {y-4*s} L {x-1*s} {y+4*s} L {x-6*s} {y+12*s} L {x-4*s} {y+13*s} L {x} {y+5*s} L {x+4*s} {y+13*s} L {x+6*s} {y+12*s} L {x+1*s} {y+4*s} L {x+1*s} {y-4*s} Z" class="pain-figure"/>
  <path d="M {x+1*s} {y} L {x+10*s} {y-2*s} L {x+10*s} {y} L {x} {y+1*s}" class="pain-figure"/>
  <path d="M {x-1*s} {y} L {x-8*s} {y-1*s} L {x-8*s} {y+1*s} L {x} {y+1*s}" class="pain-figure"/>
  <rect x="{x-7*s}" y="{y-3*s}" width="{6*s}" height="{8*s}" rx="2" class="pain-pack"/>
</g>'''

def figure_small(x, y):
    """远处的小人 (孤独感)"""
    return f'''<g>
  <ellipse cx="{x}" cy="{y+10}" rx="4" ry="1.5" class="pain-shadow"/>
  <circle cx="{x}" cy="{y-9}" r="3" class="pain-figure"/>
  <path d="M {x-0.5} {y-6} L {x-0.5} {y+4} L {x-2.5} {y+9} L {x-1.5} {y+9} L {x} {y+4.5} L {x+1.5} {y+9} L {x+2.5} {y+9} L {x+0.5} {y+4} L {x+0.5} {y-6} Z" class="pain-figure"/>
  <rect x="{x-3}" y="{y-3}" width="2.5" height="5" rx="0.8" class="pain-pack"/>
</g>'''

# 道具
def stone_cairn(x, y, color_class="pain-stone-ar", with_glow=True):
    """AR 石堆 (前人留的)"""
    glow = f'<ellipse cx="{x}" cy="{y}" rx="34" ry="11" fill="url(#glow-{x}-{y})"/><defs><radialGradient id="glow-{x}-{y}" cx="0.5" cy="0.5"><stop offset="0%" stop-color="var(--persona-a)" stop-opacity="0.45"/><stop offset="100%" stop-color="var(--persona-a)" stop-opacity="0"/></radialGradient></defs>' if with_glow else ''
    return f'''{glow}
<g transform="translate({x} {y})">
  <ellipse cx="0" cy="2" rx="11" ry="2.5" class="pain-stone-shadow"/>
  <path d="M -10 -1 Q -8 -6 0 -5 Q 10 -6 11 -1 Q 8 3 0 3 Q -8 3 -10 -1 Z" class="{color_class}"/>
  <path d="M -8 -8 Q -6 -12 0 -11 Q 7 -12 8 -8 Q 5 -5 0 -5 Q -5 -5 -8 -8 Z" class="{color_class}"/>
  <path d="M -5 -15 Q -4 -18 0 -17 Q 5 -18 5 -15 Q 4 -13 0 -12 Q -4 -13 -5 -15 Z" class="{color_class}"/>
  <path d="M -3 -22 Q -2 -24 0 -24 Q 3 -24 3 -22 Q 2 -20 0 -20 Q -2 -20 -3 -22 Z" class="{color_class}"/>
</g>'''

def bubble(x, y, w, h, text, color="var(--persona-a)"):
    """文字气泡"""
    return f'''<g transform="translate({x} {y})">
  <rect x="0" y="0" width="{w}" height="{h}" rx="4" fill="var(--surface)" stroke="{color}" stroke-width="1"/>
  <text x="{w/2}" y="{h/2+4}" text-anchor="middle" class="pain-bubble-text">{text}</text>
  <path d="M 12 {h} L 8 {h+8} L 18 {h} Z" fill="var(--surface)" stroke="{color}" stroke-width="1"/>
</g>'''

def car(x, y):
    """简笔车"""
    return f'''<g transform="translate({x} {y})">
  <ellipse cx="0" cy="14" rx="25" ry="2" class="pain-shadow"/>
  <path d="M -22 5 L -16 -4 L 16 -4 L 22 5 L 22 12 L -22 12 Z" class="pain-car-body"/>
  <path d="M -14 -4 L -10 -10 L 10 -10 L 14 -4 Z" class="pain-car-top"/>
  <circle cx="-13" cy="12" r="3" class="pain-car-wheel"/>
  <circle cx="13" cy="12" r="3" class="pain-car-wheel"/>
</g>'''

def trail(start_x, start_y, end_x, end_y, walked_part=0.6):
    """山道"""
    return f'<path d="M {start_x} {start_y} Q {(start_x+end_x)/2} {(start_y+end_y)/2-20} {end_x} {end_y}" class="pain-trail-walked"/>'

def vibrate_phone(x, y):
    """举起的手机 + 振动波"""
    return f'''<g transform="translate({x} {y})">
  <rect x="-4" y="-8" width="10" height="16" rx="2" class="pain-phone-mini"/>
  <path d="M 8 -4 Q 11 0 8 4" class="pain-vibrate"/>
  <path d="M 11 -7 Q 16 0 11 7" class="pain-vibrate"/>
</g>'''

def perm_chip(x, y, label="路过的人", color="var(--persona-c)"):
    """权限选择 chip"""
    return f'''<g transform="translate({x} {y})">
  <rect x="-44" y="-8" width="88" height="16" rx="8" class="pain-perm-bg"/>
  <text x="-30" y="3" text-anchor="middle" class="pain-perm-label">自己</text>
  <text x="0" y="3" text-anchor="middle" class="pain-perm-label">朋友</text>
  <rect x="14" y="-7" width="36" height="14" rx="7" class="pain-perm-active" fill="{color}"/>
  <text x="32" y="3" text-anchor="middle" class="pain-perm-label-active">{label}</text>
</g>'''

def lock_icon(x, y):
    """私人锁图标"""
    return f'''<g transform="translate({x} {y})">
  <rect x="-6" y="-2" width="12" height="9" rx="1.5" fill="var(--persona-c)" opacity="0.85"/>
  <path d="M -3 -2 L -3 -5 a 3 3 0 0 1 6 0 L 3 -2" fill="none" stroke="var(--persona-c)" stroke-width="1.5" opacity="0.85"/>
</g>'''

def wind_lines(x, y):
    """风的线条"""
    return f'''<g opacity="0.5">
  <path d="M {x} {y} q 10 -2 20 0 q -5 1 -10 2" class="pain-trail-walked" stroke-width="0.8"/>
  <path d="M {x+5} {y+8} q 15 -2 25 0" class="pain-trail-walked" stroke-width="0.8"/>
  <path d="M {x-3} {y-6} q 8 -1 16 0" class="pain-trail-walked" stroke-width="0.8"/>
</g>'''

def rain(start=0, count=8):
    """雨"""
    lines = []
    for i in range(count):
        xi = (i * 40) + start
        lines.append(f'<line x1="{xi}" y1="20" x2="{xi-3}" y2="40" class="pain-vibrate" stroke-width="0.8"/>')
        lines.append(f'<line x1="{xi+10}" y1="50" x2="{xi+7}" y2="70" class="pain-vibrate" stroke-width="0.8"/>')
        lines.append(f'<line x1="{xi+20}" y1="30" x2="{xi+17}" y2="50" class="pain-vibrate" stroke-width="0.8"/>')
    return ''.join(lines)


# ==================== 4 张卡 16 帧 SVG ====================

ART = {
    "pc-jamie": [
        # 帧 1 · 周六一早 · 进山
        f'<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">{env_mountains(11)}{car(225, 195)}{figure_standing(140, 180)}<circle cx="270" cy="50" r="14" fill="var(--persona-a)" opacity="0.5"/></svg>',
        # 帧 2 · 走了两个小时 · 心里有点空
        f'<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">{env_mountains(12)}<path d="M 50 230 Q 100 200 140 195 T 220 170 T 290 130" class="pain-trail-walked"/>{figure_small(170, 178)}<path d="M 60 70 q 4 -3 8 0 q 4 -3 8 0" class="pain-bird"/><path d="M 230 80 q 3 -2 6 0 q 3 -2 6 0" class="pain-bird"/></svg>',
        # 帧 3 · 手机震 + AR 石堆 + 气泡
        f'<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">{env_mountains(13)}<path d="M 30 230 Q 80 200 130 188 T 210 170 T 290 140" class="pain-trail-walked"/>{figure_squat(135, 175)}{vibrate_phone(150, 165)}{stone_cairn(225, 172)}{bubble(190, 105, 92, 22, "前人留下的话")}</svg>',
        # 帧 4 · 他也留了一个
        f'<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">{env_coast(14)}<path d="M 30 230 Q 100 200 160 180 T 280 140" class="pain-trail-walked"/>{figure_squat(170, 175)}<g transform="translate(220 178)"><ellipse cx="0" cy="2" rx="9" ry="2" class="pain-stone-shadow"/><path d="M -8 -1 Q -7 -5 0 -4 Q 8 -5 8 -1 Q 6 2 0 2 Q -6 2 -8 -1 Z" class="pain-stone-self"/><path d="M -6 -7 Q -4 -10 0 -9 Q 5 -10 6 -7 Q 4 -5 0 -5 Q -4 -5 -6 -7 Z" class="pain-stone-self"/><path d="M -3 -12 Q -2 -14 0 -14 Q 3 -14 3 -12 Q 2 -11 0 -11 Q -2 -11 -3 -12 Z" class="pain-stone-self"/></g>{perm_chip(220, 215)}</svg>',
    ],
    "pc-murray": [
        # 帧 1 · Murray 在 hut 旁边
        f'<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">{env_mountains(21)}<g transform="translate(220 165)"><path d="M -25 0 L -25 -15 L 0 -28 L 25 -15 L 25 0 Z" fill="var(--surface3)" stroke="var(--text2)" stroke-width="1"/><rect x="-10" y="-10" width="6" height="10" fill="var(--surface)" stroke="var(--text2)" stroke-width="0.6"/><rect x="-22" y="-2" width="44" height="2" fill="var(--text2)" opacity="0.5"/></g>{figure_standing(120, 175)}<text x="120" y="200" text-anchor="middle" class="pain-figure-name">Murray</text></svg>',
        # 帧 2 · 走到岔路口
        f'<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">{env_mountains(22)}<path d="M 30 230 Q 80 200 140 195 L 160 188" class="pain-trail-walked"/><path d="M 160 188 Q 200 175 240 145" class="pain-trail-walked" stroke-dasharray="4 3" opacity="0.7"/><path d="M 160 188 Q 210 195 270 200" class="pain-trail-walked" opacity="0.7"/>{figure_standing(155, 180)}<g transform="translate(160 188)"><circle cx="0" cy="0" r="4" fill="var(--persona-b)"/><circle cx="0" cy="0" r="9" fill="none" stroke="var(--persona-b)" stroke-width="1" opacity="0.5"/></g></svg>',
        # 帧 3 · 留下 mark
        f'<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">{env_mountains(23)}<path d="M 30 230 Q 100 195 170 175 T 280 130" class="pain-trail-walked"/>{figure_squat(140, 175)}{stone_cairn(200, 172, "pain-stone-self")}{bubble(180, 100, 110, 22, "右边才是正道")}{perm_chip(220, 215, "公开", "var(--persona-a)")}</svg>',
        # 帧 4 · 他往前走
        f'<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">{env_mountains(24)}<path d="M 30 230 Q 100 200 160 180 T 280 130" class="pain-trail-walked"/><g transform="translate(110 200)" opacity="0.55"><ellipse cx="0" cy="2" rx="9" ry="2" class="pain-stone-shadow"/><path d="M -8 -1 Q -7 -5 0 -4 Q 8 -5 8 -1 Q 6 2 0 2 Q -6 2 -8 -1 Z" class="pain-stone-self"/><path d="M -6 -7 Q -4 -10 0 -9 Q 5 -10 6 -7 Q 4 -5 0 -5 Q -4 -5 -6 -7 Z" class="pain-stone-self"/></g>{figure_standing(220, 168)}<path d="M 30 50 Q 50 40 70 50" class="pain-bird"/></svg>',
    ],
    "pc-lin": [
        # 帧 1 · 妈妈和女儿在登山口
        f'<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">{env_mountains(31)}{figure_standing(140, 180)}<g transform="translate(165 192)"><ellipse cx="0" cy="13" rx="6" ry="1.5" class="pain-shadow"/><circle cx="0" cy="-9" r="4" class="pain-figure"/><path d="M -1 -5 L -1 5 L -3 12 L -2 12 L 0 6 L 2 12 L 3 12 L 1 5 L 1 -5 Z" class="pain-figure"/></g><text x="140" y="210" text-anchor="middle" class="pain-figure-name">Lin</text><text x="165" y="217" text-anchor="middle" class="pain-figure-name" style="font-size:8px">女儿</text></svg>',
        # 帧 2 · 山顶 风大 女儿笑
        f'<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">{env_summit(32)}{figure_standing(140, 175)}<g transform="translate(170 188)"><ellipse cx="0" cy="13" rx="6" ry="1.5" class="pain-shadow"/><circle cx="0" cy="-9" r="4" class="pain-figure"/><path d="M -1 -5 L -1 5 L -3 12 L -2 12 L 0 6 L 2 12 L 3 12 L 1 5 L 1 -5 Z" class="pain-figure"/><path d="M -3 -7 q -2 -2 -1 -4" stroke="var(--text)" stroke-width="0.8" fill="none"/><path d="M 3 -7 q 2 -2 1 -4" stroke="var(--text)" stroke-width="0.8" fill="none"/></g>{wind_lines(60, 120)}{wind_lines(220, 100)}<path d="M 200 90 q 5 -3 10 0 q 5 -3 10 0" class="pain-bird"/></svg>',
        # 帧 3 · 录音 标在山头 (私人锁)
        f'<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">{env_summit(33)}{figure_squat(140, 175)}{vibrate_phone(155, 165)}{stone_cairn(220, 172, "pain-stone-self")}{lock_icon(240, 152)}{perm_chip(220, 215, "私人", "var(--persona-c)")}</svg>',
        # 帧 4 · 时间过去 笑声还在
        f'<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">{env_summit(34)}<g transform="translate(180 180)" opacity="0.85"><ellipse cx="0" cy="2" rx="9" ry="2" class="pain-stone-shadow"/><path d="M -8 -1 Q -7 -5 0 -4 Q 8 -5 8 -1 Q 6 2 0 2 Q -6 2 -8 -1 Z" class="pain-stone-self"/><path d="M -6 -7 Q -4 -10 0 -9 Q 5 -10 6 -7 Q 4 -5 0 -5 Q -4 -5 -6 -7 Z" class="pain-stone-self"/><path d="M -3 -12 Q -2 -14 0 -14 Q 3 -14 3 -12 Q 2 -11 0 -11 Q -2 -11 -3 -12 Z" class="pain-stone-self"/></g><g transform="translate(180 158)" opacity="0.7"><circle cx="0" cy="0" r="14" fill="none" stroke="var(--persona-c)" stroke-width="1" stroke-dasharray="2 2"/><path d="M -3 -3 q 6 -3 6 6" stroke="var(--persona-c)" stroke-width="1" fill="none"/></g><text x="180" y="210" text-anchor="middle" class="pain-figure-name" style="font-size:9px">3 年后</text></svg>',
    ],
    "pc-sarah": [
        # 帧 1 · Sarah 在登山口 (准备齐全)
        f'<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">{env_mountains(41)}{car(80, 195)}{figure_standing(170, 180)}<g transform="translate(220 130)"><rect x="0" y="0" width="60" height="80" rx="6" class="pain-phone-frame"/><rect x="4" y="10" width="52" height="64" rx="3" class="pain-phone-screen"/><text x="30" y="30" text-anchor="middle" class="pain-icon-cap" style="font-size:8px">AllTrails</text><g transform="translate(30 50)"><text text-anchor="middle" fill="var(--persona-a)" style="font-size:14px">★★★★</text></g></g><text x="170" y="220" text-anchor="middle" class="pain-figure-name">Sarah</text></svg>',
        # 帧 2 · 下午山里变天
        f'<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg"><defs><linearGradient id="bg-42" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--surface3)"/><stop offset="100%" stop-color="var(--surface)"/></linearGradient></defs><rect width="320" height="240" fill="url(#bg-42)"/><path d="M 0 95 L 60 70 L 130 85 L 200 60 L 280 80 L 320 75 L 320 240 L 0 240 Z" class="pain-shape-far" opacity="0.7"/><path d="M 0 175 L 80 165 L 160 175 L 240 160 L 320 170 L 320 240 L 0 240 Z" class="pain-shape-near"/>{rain(0, 4)}<g transform="translate(60 50)" opacity="0.7"><ellipse cx="0" cy="0" rx="40" ry="12" fill="var(--text2)" opacity="0.5"/><ellipse cx="-15" cy="-5" rx="20" ry="10" fill="var(--text2)" opacity="0.6"/></g><path d="M 50 230 Q 100 200 140 195 T 220 170" class="pain-trail-walked"/>{figure_small(150, 178)}</svg>',
        # 帧 3 · 雨里站岔路口 + 看见 mark
        f'<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg"><defs><linearGradient id="bg-43" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--surface3)"/><stop offset="100%" stop-color="var(--surface)"/></linearGradient></defs><rect width="320" height="240" fill="url(#bg-43)"/><path d="M 0 100 L 60 80 L 130 95 L 200 70 L 280 90 L 320 85 L 320 240 L 0 240 Z" class="pain-shape-mid"/><path d="M 0 175 L 80 165 L 160 175 L 240 160 L 320 170 L 320 240 L 0 240 Z" class="pain-shape-near"/>{rain(0, 5)}<path d="M 30 230 Q 100 195 130 188" class="pain-trail-walked"/><path d="M 130 188 Q 170 170 210 145" class="pain-trail-walked" opacity="0.6" stroke-dasharray="4 3"/><path d="M 130 188 Q 180 195 240 195" class="pain-trail-walked" opacity="0.6"/>{figure_squat(125, 180)}{vibrate_phone(140, 170)}{stone_cairn(200, 175)}{bubble(170, 95, 130, 22, "雨季是河 走左边")}</svg>',
        # 帧 4 · 回到车里 留下 mark
        f'<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">{env_mountains(44)}{car(180, 195)}{figure_standing(120, 180)}<g transform="translate(180 145)"><rect x="-15" y="-30" width="30" height="50" rx="4" class="pain-phone-frame"/><rect x="-12" y="-26" width="24" height="42" rx="2" class="pain-phone-screen"/><text x="0" y="-12" text-anchor="middle" class="pain-icon-cap" style="font-size:7px">下午 3 点</text><text x="0" y="-2" text-anchor="middle" class="pain-icon-cap" style="font-size:7px">开始下雨</text></g>{perm_chip(180, 220, "公开", "var(--persona-a)")}</svg>',
    ],
}

# 输出 JS 字典字符串
out = "  const PAIN_ART = {\n"
for cid, frames in ART.items():
    out += f"    \"{cid}\": [\n"
    for f in frames:
        # 转义反引号并放入模板字符串
        safe = f.replace("`", "\\`").replace("${", "\\${")
        out += f"      `{safe}`,\n"
    out += "    ],\n"
out += "  };\n"

with open('C:/ClaudeCodeProjects/Cairn/research/pain_art.js', 'w', encoding='utf-8') as f:
    f.write(out)
print('OK', len(ART), 'cards')
