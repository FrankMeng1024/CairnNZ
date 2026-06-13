"""v4 - 4 张卡 16 帧重做.
约束:
1. 不动文字
2. 权限 chip 统一: 自己 / 朋友 / 公开
3. 每张卡内人物连贯 (背包颜色一致 + 体型一致)
4. 故事衔接: 帧 1 出发 -> 帧 2 走 -> 帧 3 看 mark -> 帧 4 留 mark
5. 石头棱角清晰 (6 点多边形)
6. 太阳/光晕用渐变
7. 修 Murray 帧 1 (改成山+老人, 不是 hut)
8. 修 Lin 帧 3 (chip 选"自己"+ 笑声波)
9. 修 Sarah 帧 4 (停车场)
"""
import json

# ============== 共用函数 ==============

def grad_bg(id_, top_color, mid_color, bot_color):
    return f'''<defs><linearGradient id="{id_}" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="{top_color}"/>
<stop offset="50%" stop-color="{mid_color}"/>
<stop offset="100%" stop-color="{bot_color}"/>
</linearGradient></defs>'''

def sun(cx, cy, color, big_r=22, halo_r=110, clip_y=None):
    """半隐藏在山后的太阳"""
    if clip_y is None: clip_y = cy + 5
    return f'''<defs>
<radialGradient id="sun-{cx}-{cy}" cx="0.5" cy="0.5" r="0.5">
<stop offset="0%" stop-color="{color}" stop-opacity="0.85"/>
<stop offset="100%" stop-color="{color}" stop-opacity="0"/>
</radialGradient>
<clipPath id="sunclip-{cx}-{cy}"><rect x="0" y="0" width="320" height="{clip_y}"/></clipPath>
</defs>
<ellipse cx="{cx}" cy="{cy}" rx="{halo_r}" ry="{halo_r*0.6}" fill="url(#sun-{cx}-{cy})" opacity="0.85"/>
<g clip-path="url(#sunclip-{cx}-{cy})">
<circle cx="{cx}" cy="{cy}" r="{big_r}" fill="{color}" opacity="0.95"/>
<circle cx="{cx}" cy="{cy}" r="{big_r+8}" fill="none" stroke="{color}" stroke-width="0.5" opacity="0.5"/>
<circle cx="{cx}" cy="{cy}" r="{big_r+18}" fill="none" stroke="{color}" stroke-width="0.4" opacity="0.3"/>
</g>'''

def mountain_layers(layers):
    """layers = [(y_path, fill, opacity)]"""
    out = []
    for path, fill, op in layers:
        out.append(f'<path d="{path}" fill="{fill}" opacity="{op}"/>')
    return '\n'.join(out)

def figure_full(x, y, scale=1.0, pack_color='#3d3830', skin_color='#1a1714', name=None):
    """完整人物剪影 (站立)"""
    s = scale
    name_text = f'<text x="{x}" y="{y-29*s}" text-anchor="middle" fill="#e4e8f4" font-size="{9*s}px" font-family="\'Inter\', \'PingFang SC\', sans-serif" letter-spacing="0.04em" font-weight="500">{name}</text>' if name else ''
    return f'''<g>
<ellipse cx="{x}" cy="{y+22*s}" rx="{9*s}" ry="2" fill="#000" opacity="0.4"/>
<circle cx="{x}" cy="{y-15*s}" r="{6*s}" fill="{skin_color}"/>
<path d="M {x-1*s} {y-9*s} L {x-1*s} {y+8*s} L {x-5*s} {y+20*s} L {x-3*s} {y+20*s} L {x} {y+9*s} L {x+3*s} {y+20*s} L {x+5*s} {y+20*s} L {x+1*s} {y+8*s} L {x+1*s} {y-9*s} Z" fill="{skin_color}"/>
<path d="M {x-1*s} {y-3*s} L {x-8*s} {y+4*s} L {x-7*s} {y+5*s} L {x} {y-1*s}" fill="{skin_color}"/>
<path d="M {x+1*s} {y-3*s} L {x+8*s} {y+4*s} L {x+7*s} {y+5*s} L {x} {y-1*s}" fill="{skin_color}"/>
<rect x="{x-7*s}" y="{y-5*s}" width="{6*s}" height="{10*s}" rx="2" fill="{pack_color}"/>
{name_text}
</g>'''

def figure_squat(x, y, scale=1.0, pack_color='#3d3830'):
    """蹲下"""
    s = scale
    return f'''<g transform="translate({x} {y})">
<ellipse cx="0" cy="{15*s}" rx="{10*s}" ry="2" fill="#000" opacity="0.4"/>
<circle cx="0" cy="{-10*s}" r="{6*s}" fill="#1a1714"/>
<path d="M {-1*s} {-4*s} L {-1*s} {4*s} L {-6*s} {12*s} L {-4*s} {13*s} L 0 {5*s} L {4*s} {13*s} L {6*s} {12*s} L {1*s} {4*s} L {1*s} {-4*s} Z" fill="#1a1714"/>
<path d="M {1*s} 0 L {12*s} {-2*s} L {12*s} 0 L 0 {1*s}" fill="#1a1714"/>
<path d="M {-1*s} 0 L {-7*s} {1*s} L {-7*s} {-1*s} L 0 {-1*s}" fill="#1a1714"/>
<rect x="{-7*s}" y="{-3*s}" width="{6*s}" height="{8*s}" rx="2" fill="{pack_color}"/>
</g>'''

def figure_small(x, y, pack_color='#3d3830'):
    """远处小人"""
    return f'''<g>
<ellipse cx="{x}" cy="{y+10}" rx="4" ry="1.5" fill="#000" opacity="0.4"/>
<circle cx="{x}" cy="{y-9}" r="3" fill="#1a1714"/>
<path d="M {x-0.5} {y-6} L {x-0.5} {y+4} L {x-2.5} {y+9} L {x-1.5} {y+9} L {x} {y+4.5} L {x+1.5} {y+9} L {x+2.5} {y+9} L {x+0.5} {y+4} L {x+0.5} {y-6} Z" fill="#1a1714"/>
<rect x="{x-3}" y="{y-3}" width="2.5" height="5" rx="0.8" fill="{pack_color}"/>
</g>'''

def stone_polygon(cx, cy, w, h, variant=0, color='#a78bfa', opacity=0.92):
    """6 点锐角石头"""
    x, y = cx, cy
    if variant == 0:
        pts = (f'{x-w*0.55},{y-h*0.05} {x-w*0.3},{y-h*0.9} {x+w*0.4},{y-h*1.0} '
               f'{x+w*0.6},{y-h*0.2} {x+w*0.35},{y+h*0.65} {x-w*0.45},{y+h*0.6}')
    elif variant == 1:
        pts = (f'{x-w*0.45},{y-h*0.1} {x-w*0.5},{y-h*0.85} {x+w*0.15},{y-h*1.0} '
               f'{x+w*0.55},{y-h*0.5} {x+w*0.45},{y+h*0.55} {x-w*0.35},{y+h*0.65}')
    else:
        pts = (f'{x-w*0.5},{y-h*0.0} {x-w*0.15},{y-h*1.0} {x+w*0.4},{y-h*0.85} '
               f'{x+w*0.5},{y-h*0.1} {x+w*0.25},{y+h*0.6} {x-w*0.4},{y+h*0.55}')
    return f'<polygon points="{pts}" fill="{color}" opacity="{opacity}" stroke="{color}" stroke-width="1" stroke-linejoin="miter" stroke-opacity="0.7"/>'

def cairn_mark(cx, cy, scale, color, with_glow=True):
    """3 块叠石 cairn mark"""
    s = scale
    parts = []
    # 光晕
    if with_glow:
        glow_id = f'glow-{cx}-{cy}'
        parts.append(f'''<defs><radialGradient id="{glow_id}" cx="0.5" cy="0.5" r="0.5">
<stop offset="0%" stop-color="{color}" stop-opacity="0.55"/>
<stop offset="100%" stop-color="{color}" stop-opacity="0"/>
</radialGradient></defs>
<ellipse cx="{cx}" cy="{cy}" rx="{40*s}" ry="{14*s}" fill="url(#{glow_id})"/>''')
    parts.append(f'<g transform="translate({cx} {cy})">')
    # 阴影
    parts.append(f'<ellipse cx="0" cy="{8*s}" rx="{12*s}" ry="{1.6*s}" fill="#000" opacity="0.4"/>')
    # 下/中/上石 (位置错开)
    parts.append(f'<g transform="translate({-1.5*s} 0)">{stone_polygon(0, 4*s, 22*s, 7.5*s, 0, color, 0.94)}</g>')
    parts.append(f'<g transform="translate({2*s} 0)">{stone_polygon(0, -4*s, 16*s, 6.5*s, 1, color, 0.92)}</g>')
    parts.append(f'<g transform="translate({-2*s} 0)">{stone_polygon(0, -12*s, 10*s, 5.5*s, 2, color, 0.9)}</g>')
    parts.append('</g>')
    return ''.join(parts)

def perm_chip_unified(cx, cy, selected, color):
    """统一权限 chip: 自己 / 朋友 / 公开. selected = 0/1/2"""
    items = ['自己', '朋友', '公开']
    parts = [f'<g transform="translate({cx} {cy})">']
    parts.append(f'<rect x="-44" y="-8" width="88" height="16" rx="8" fill="#1a1714" stroke="#3d3830" stroke-width="0.8"/>')
    positions = [-30, 0, 30]
    for i, label in enumerate(items):
        if i == selected:
            x = positions[i]
            parts.append(f'<rect x="{x-14}" y="-7" width="28" height="14" rx="7" fill="{color}" opacity="0.92"/>')
            parts.append(f'<text x="{x}" y="3" text-anchor="middle" fill="#1a1714" font-size="8px" font-family="\'Inter\', \'PingFang SC\', sans-serif" font-weight="600">{label}</text>')
        else:
            parts.append(f'<text x="{positions[i]}" y="3" text-anchor="middle" fill="#9a9080" font-size="8px" font-family="\'Inter\', \'PingFang SC\', sans-serif">{label}</text>')
    parts.append('</g>')
    return ''.join(parts)

def vibrate_phone(cx, cy, color):
    """举起的手机 + 振动波"""
    return f'''<g transform="translate({cx} {cy})">
<rect x="-4" y="-8" width="10" height="16" rx="2" fill="#212638" stroke="#b0b6cc" stroke-width="0.8"/>
<path d="M 8 -4 Q 11 0 8 4" stroke="{color}" stroke-width="1" fill="none"/>
<path d="M 11 -7 Q 16 0 11 7" stroke="{color}" stroke-width="1" fill="none"/>
</g>'''

def bird(x, y, opacity=0.55):
    return f'<path d="M {x} {y} q 4 -3 8 0 q 4 -3 8 0" stroke="#000" stroke-width="1.2" fill="none" opacity="{opacity}" stroke-linecap="round"/>'

# 用品牌色作为人物背包色 - 串故事 (Jamie 用海蓝色, Murray 紫, Lin 绿, Sarah 蓝)
PACK_JAMIE = '#5a4d3a'   # 棕色背包
PACK_MURRAY = '#4a3d4a'  # 暗紫背包(老人)
PACK_LIN = '#5a6d3a'     # 绿色背包(妈妈)
PACK_SARAH = '#3a5a6a'   # 蓝色背包(游客)


# ============== Jamie 4 帧 ==============

JAMIE = []

# 帧 1: 周六一早 进山 - 朝阳, Jamie 在登山口往里走, 背棕色包
JAMIE.append(f'''<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">
{grad_bg('j1bg', '#3a3344', '#7a6555', '#1f1d28')}
<rect width="320" height="240" fill="url(#j1bg)"/>
{sun(250, 70, '#ffd28a', big_r=20, halo_r=130, clip_y=130)}
{mountain_layers([
  ('M 0 115 L 50 90 L 130 105 L 200 80 L 260 100 L 320 95 L 320 240 L 0 240 Z', '#2a2435', 0.92),
  ('M 0 155 L 70 135 L 140 150 L 210 125 L 280 145 L 320 140 L 320 240 L 0 240 Z', '#3a3344', 0.9),
  ('M 0 195 L 80 185 L 160 195 L 240 180 L 320 190 L 320 240 L 0 240 Z', '#4a3d4f', 1),
])}
<path d="M 100 240 Q 130 220 145 200 T 170 165" stroke="#d4a575" stroke-width="1.4" fill="none" opacity="0.6" stroke-linecap="round"/>
<path d="M 130 240 Q 155 220 170 200 T 195 165" stroke="#d4a575" stroke-width="1.2" fill="none" opacity="0.4" stroke-linecap="round"/>
{bird(50, 50)}
{bird(90, 65)}
{figure_full(115, 195, scale=1, pack_color=PACK_JAMIE, name='Jamie')}
</svg>''')

# 帧 2: 走了两小时 一个人 山脊上 (人小山大表现"心里有点空")
JAMIE.append(f'''<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">
{grad_bg('j2bg', '#5a4565', '#c97f5a', '#2a2535')}
<rect width="320" height="240" fill="url(#j2bg)"/>
{sun(120, 155, '#ffc080', big_r=26, halo_r=190, clip_y=170)}
{mountain_layers([
  ('M 0 100 L 60 75 L 130 90 L 200 65 L 280 85 L 320 80 L 320 240 L 0 240 Z', '#2a1f30', 0.7),
])}
<path d="M 0 175 Q 80 165 160 175 T 320 170" fill="#1a1525"/>
<path d="M 0 175 Q 80 165 160 175 T 320 170 L 320 240 L 0 240 Z" fill="#0e0818" opacity="0.85"/>
<path d="M 0 175 Q 80 165 160 175 T 320 170" stroke="#ffb068" stroke-width="0.6" fill="none" opacity="0.5"/>
{figure_small(200, 173, pack_color=PACK_JAMIE)}
{bird(60, 50, 0.7)}
{bird(240, 60, 0.7)}
</svg>''')

# 帧 3: 手机震 + 蹲下看 mark (落日, AR 石堆 + 气泡)
JAMIE.append(f'''<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">
{grad_bg('j3bg', '#4a3a55', '#d49568', '#3a2530')}
<rect width="320" height="240" fill="url(#j3bg)"/>
{sun(265, 125, '#ffd0a0', big_r=14, halo_r=100, clip_y=135)}
{mountain_layers([
  ('M 0 130 L 60 105 L 130 120 L 200 95 L 280 115 L 320 110 L 320 240 L 0 240 Z', '#3a2c40', 0.85),
  ('M 0 175 L 80 165 L 160 175 L 240 160 L 320 170 L 320 240 L 0 240 Z', '#2a1d28', 1),
])}
<path d="M 30 230 Q 100 195 170 175 T 280 145" stroke="#d4a575" stroke-width="1.4" fill="none" opacity="0.7" stroke-linecap="round"/>
{figure_squat(135, 175, pack_color=PACK_JAMIE)}
{vibrate_phone(150, 162, '#ffb068')}
{cairn_mark(220, 170, scale=1, color='#ffb068')}
<g transform="translate(178 102)">
<rect x="0" y="0" width="124" height="24" rx="6" fill="#1a1714" stroke="#ffb068" stroke-width="1.2"/>
<text x="62" y="16" text-anchor="middle" fill="#e4e8f4" font-size="11px" font-family="'Inter', 'PingFang SC', sans-serif">前人留的一句话</text>
<path d="M 35 24 L 32 32 L 42 24 Z" fill="#1a1714" stroke="#ffb068" stroke-width="1.2"/>
</g>
</svg>''')

# 帧 4: 看海, 录一句留给后人 (公开 mark)
JAMIE.append(f'''<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">
{grad_bg('j4bg', '#403458', '#a08570', '#2a2535')}
<defs>
<linearGradient id="j4sea" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="#5d7990"/>
<stop offset="100%" stop-color="#3a4858"/>
</linearGradient>
</defs>
<rect width="320" height="240" fill="url(#j4bg)"/>
{sun(245, 110, '#ffd0a0', big_r=16, halo_r=120, clip_y=120)}
<rect x="0" y="115" width="320" height="60" fill="url(#j4sea)"/>
<ellipse cx="245" cy="118" rx="60" ry="3" fill="#ffd0a0" opacity="0.55"/>
<ellipse cx="245" cy="125" rx="40" ry="2" fill="#ffd0a0" opacity="0.4"/>
<path d="M 0 130 q 30 -2 60 0 t 120 0 t 120 0" stroke="#cbd5e1" stroke-width="0.5" fill="none" opacity="0.4"/>
<path d="M 0 145 q 25 -2 50 0 t 100 0 t 100 0 t 100 0" stroke="#cbd5e1" stroke-width="0.5" fill="none" opacity="0.3"/>
{mountain_layers([
  ('M 0 110 L 80 105 L 160 112 L 240 100 L 320 108 L 320 130 L 0 130 Z', '#3a2c40', 0.9),
  ('M 0 175 L 80 168 L 160 178 L 240 165 L 320 175 L 320 240 L 0 240 Z', '#2a1d28', 1),
])}
{figure_full(125, 195, scale=1, pack_color=PACK_JAMIE)}
{cairn_mark(195, 185, scale=0.85, color='#4ade80')}
{bird(80, 65, 0.5)}
{bird(280, 80, 0.5)}
{perm_chip_unified(180, 220, selected=2, color='#4ade80')}
</svg>''')


# ============== Murray 4 帧 ==============

MURRAY = []

# 帧 1: 30 年走遍, 山+老人 (改了文案 "户外是他的家", 不再画 hut)
MURRAY.append(f'''<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">
{grad_bg('m1bg', '#3a4055', '#5a5868', '#1f1d28')}
<rect width="320" height="240" fill="url(#m1bg)"/>
<defs>
<radialGradient id="m1glow" cx="0.5" cy="0.5" r="0.5">
<stop offset="0%" stop-color="#d4a575" stop-opacity="0.45"/>
<stop offset="100%" stop-color="#d4a575" stop-opacity="0"/>
</radialGradient>
</defs>
<ellipse cx="180" cy="130" rx="180" ry="60" fill="url(#m1glow)" opacity="0.7"/>
{mountain_layers([
  ('M 0 110 L 60 85 L 130 100 L 200 75 L 280 95 L 320 90 L 320 240 L 0 240 Z', '#2a2c38', 0.85),
  ('M 0 145 L 70 125 L 140 138 L 210 115 L 280 130 L 320 125 L 320 240 L 0 240 Z', '#3a3c48', 0.85),
  ('M 0 195 L 80 185 L 160 195 L 240 180 L 320 190 L 320 240 L 0 240 Z', '#1a1d28', 1),
])}
<!-- 远处一个小石堆 (Cairn 痕迹), 暗示他走过的路上留过的 -->
<g transform="translate(220 175)" opacity="0.55">
{cairn_mark(0, 0, scale=0.4, color='#a78bfa', with_glow=False)}
</g>
{bird(50, 60)}
{figure_full(115, 200, scale=1, pack_color=PACK_MURRAY, name='Murray')}
</svg>''')

# 帧 2: 走到岔路口, 停下来
MURRAY.append(f'''<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">
{grad_bg('m2bg', '#383a4c', '#5a4a52', '#1f1d28')}
<rect width="320" height="240" fill="url(#m2bg)"/>
<defs>
<radialGradient id="m2glow" cx="0.5" cy="0.5" r="0.5">
<stop offset="0%" stop-color="#a78bfa" stop-opacity="0.4"/>
<stop offset="100%" stop-color="#a78bfa" stop-opacity="0"/>
</radialGradient>
</defs>
<ellipse cx="160" cy="100" rx="180" ry="60" fill="url(#m2glow)" opacity="0.7"/>
{mountain_layers([
  ('M 0 130 L 60 105 L 130 120 L 200 95 L 280 115 L 320 110 L 320 240 L 0 240 Z', '#2a2c38', 0.8),
  ('M 0 175 L 80 165 L 160 175 L 240 160 L 320 170 L 320 240 L 0 240 Z', '#1a1d28', 1),
])}
<!-- 主路 -->
<path d="M 30 230 Q 80 200 140 195 L 165 188" stroke="#a78bfa" stroke-width="1.6" fill="none" opacity="0.85" stroke-linecap="round"/>
<!-- 左路 (虚线 - 错的方向) -->
<path d="M 165 188 Q 200 175 240 145" stroke="#7a6580" stroke-width="1.2" fill="none" opacity="0.6" stroke-linecap="round" stroke-dasharray="4 3"/>
<!-- 右路 (正路) -->
<path d="M 165 188 Q 215 195 275 200" stroke="#a78bfa" stroke-width="1.4" fill="none" opacity="0.85" stroke-linecap="round"/>
<g transform="translate(165 188)">
<circle cx="0" cy="0" r="4" fill="#a78bfa"/>
<circle cx="0" cy="0" r="9" fill="none" stroke="#a78bfa" stroke-width="1" opacity="0.5"/>
<circle cx="0" cy="0" r="14" fill="none" stroke="#a78bfa" stroke-width="0.6" opacity="0.3"/>
</g>
{figure_full(120, 188, scale=1, pack_color=PACK_MURRAY)}
</svg>''')

# 帧 3: 蹲下留 mark
MURRAY.append(f'''<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">
{grad_bg('m3bg', '#3a3a4f', '#5a4a5a', '#1f1d28')}
<rect width="320" height="240" fill="url(#m3bg)"/>
{mountain_layers([
  ('M 0 130 L 60 105 L 130 120 L 200 95 L 280 115 L 320 110 L 320 240 L 0 240 Z', '#2a2c38', 0.85),
  ('M 0 175 L 80 165 L 160 175 L 240 160 L 320 170 L 320 240 L 0 240 Z', '#1a1d28', 1),
])}
<path d="M 30 230 Q 100 195 170 175 T 280 130" stroke="#a78bfa" stroke-width="1.4" fill="none" opacity="0.7" stroke-linecap="round"/>
{figure_squat(140, 175, pack_color=PACK_MURRAY)}
{vibrate_phone(155, 162, '#a78bfa')}
{cairn_mark(210, 170, scale=1, color='#a78bfa')}
<g transform="translate(165 102)">
<rect x="0" y="0" width="120" height="24" rx="6" fill="#1a1714" stroke="#a78bfa" stroke-width="1.2"/>
<text x="60" y="16" text-anchor="middle" fill="#e4e8f4" font-size="11px" font-family="'Inter', 'PingFang SC', sans-serif">右边才是正道</text>
<path d="M 38 24 L 35 32 L 45 24 Z" fill="#1a1714" stroke="#a78bfa" stroke-width="1.2"/>
</g>
{perm_chip_unified(210, 218, selected=2, color='#a78bfa')}
</svg>''')

# 帧 4: 他往前走, 远处石堆还在
MURRAY.append(f'''<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">
{grad_bg('m4bg', '#3a3a4f', '#5a4858', '#1f1d28')}
<rect width="320" height="240" fill="url(#m4bg)"/>
<defs>
<radialGradient id="m4glow" cx="0.5" cy="0.5" r="0.5">
<stop offset="0%" stop-color="#a78bfa" stop-opacity="0.3"/>
<stop offset="100%" stop-color="#a78bfa" stop-opacity="0"/>
</radialGradient>
</defs>
{mountain_layers([
  ('M 0 100 L 60 75 L 130 90 L 200 65 L 280 85 L 320 80 L 320 240 L 0 240 Z', '#2a2c38', 0.8),
  ('M 0 145 L 70 125 L 140 138 L 210 115 L 280 130 L 320 125 L 320 240 L 0 240 Z', '#3a3c48', 0.85),
  ('M 0 175 L 80 165 L 160 175 L 240 160 L 320 170 L 320 240 L 0 240 Z', '#1a1d28', 1),
])}
<path d="M 30 230 Q 100 200 160 180 T 280 130" stroke="#a78bfa" stroke-width="1.4" fill="none" opacity="0.7" stroke-linecap="round"/>
<g transform="translate(100 200)" opacity="0.65">
{cairn_mark(0, 0, scale=0.55, color='#a78bfa', with_glow=False)}
</g>
{figure_full(220, 188, scale=1, pack_color=PACK_MURRAY)}
{bird(30, 50)}
</svg>''')


# ============== Lin 4 帧 ==============

LIN = []

# 帧 1: 周末带女儿走 入门徒步
LIN.append(f'''<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">
{grad_bg('l1bg', '#5a8a7a', '#a4b88a', '#2a2528')}
<rect width="320" height="240" fill="url(#l1bg)"/>
<defs>
<radialGradient id="l1glow" cx="0.5" cy="0.5" r="0.5">
<stop offset="0%" stop-color="#fff5d0" stop-opacity="0.6"/>
<stop offset="100%" stop-color="#fff5d0" stop-opacity="0"/>
</radialGradient>
</defs>
<ellipse cx="160" cy="80" rx="200" ry="80" fill="url(#l1glow)" opacity="0.5"/>
{mountain_layers([
  ('M 0 130 L 50 110 L 110 120 L 170 105 L 230 115 L 290 105 L 320 110 L 320 240 L 0 240 Z', '#5a6a52', 0.7),
  ('M 0 165 L 60 150 L 130 158 L 200 145 L 270 155 L 320 150 L 320 240 L 0 240 Z', '#3a4530', 0.85),
  ('M 0 200 L 80 195 L 160 200 L 240 195 L 320 198 L 320 240 L 0 240 Z', '#2a3525', 1),
])}
{figure_full(135, 198, scale=1, pack_color=PACK_LIN, name='Lin')}
<!-- 女儿 (小一点, 在妈妈右边) -->
<g>
<ellipse cx="160" cy="218" rx="6" ry="1.5" fill="#000" opacity="0.4"/>
<circle cx="160" cy="192" r="4" fill="#1a1714"/>
<path d="M 159.5 196 L 159.5 207 L 157 215 L 158 215 L 160 207.5 L 162 215 L 163 215 L 161 207 L 160.5 196 Z" fill="#1a1714"/>
<path d="M 159 198 L 154 195 L 154.5 196.5 L 160 199" fill="#1a1714"/>
<path d="M 161 198 L 166 195 L 165.5 196.5 L 160 199" fill="#1a1714"/>
<text x="160" y="186" text-anchor="middle" fill="#1a1714" font-size="7px" font-family="'Inter', 'PingFang SC', sans-serif">女儿</text>
</g>
{bird(50, 60, 0.5)}
{bird(240, 70, 0.5)}
</svg>''')

# 帧 2: 走到山顶 风大 女儿笑
LIN.append(f'''<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">
{grad_bg('l2bg', '#7aa090', '#c8d8a8', '#3a3530')}
<rect width="320" height="240" fill="url(#l2bg)"/>
<defs>
<radialGradient id="l2sun" cx="0.5" cy="0.5" r="0.5">
<stop offset="0%" stop-color="#fff8e0" stop-opacity="0.85"/>
<stop offset="100%" stop-color="#fff8e0" stop-opacity="0"/>
</radialGradient>
</defs>
<ellipse cx="240" cy="80" rx="150" ry="60" fill="url(#l2sun)" opacity="0.6"/>
<circle cx="240" cy="80" r="18" fill="#fff5d0" opacity="0.85"/>
<circle cx="240" cy="80" r="26" fill="none" stroke="#fff5d0" stroke-width="0.5" opacity="0.4"/>
{mountain_layers([
  ('M 0 100 L 50 75 L 110 90 L 170 70 L 230 85 L 290 75 L 320 80 L 320 240 L 0 240 Z', '#5a6a52', 0.7),
])}
<!-- 风线 -->
<g opacity="0.55" stroke="#e8e8c8" stroke-width="1" fill="none" stroke-linecap="round">
<path d="M 30 130 q 18 -3 30 0 q -8 1 -14 2"/>
<path d="M 40 145 q 22 -3 35 0"/>
<path d="M 25 115 q 14 -2 24 0"/>
<path d="M 200 110 q 18 -3 30 0"/>
</g>
<path d="M 0 200 Q 60 195 130 198 T 280 200 L 320 200 L 320 240 L 0 240 Z" fill="#2a3525"/>
{figure_full(135, 195, scale=1, pack_color=PACK_LIN)}
<!-- 女儿 张开手 笑 -->
<g>
<ellipse cx="170" cy="218" rx="6" ry="1.5" fill="#000" opacity="0.4"/>
<circle cx="170" cy="192" r="4" fill="#1a1714"/>
<path d="M 169.5 196 L 169.5 207 L 167 215 L 168 215 L 170 207.5 L 172 215 L 173 215 L 171 207 L 170.5 196 Z" fill="#1a1714"/>
<path d="M 168 198 L 162 194 L 162 195.5 L 169 199" fill="#1a1714"/>
<path d="M 172 198 L 178 194 L 178 195.5 L 171 199" fill="#1a1714"/>
<path d="M 168 191 q 2 1.5 4 0" stroke="#fff" stroke-width="0.6" fill="none"/>
</g>
</svg>''')

# 帧 3: Lin 录笑声, mark 标在山头, 私人 (chip 选"自己"), 加笑声波
LIN.append(f'''<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">
{grad_bg('l3bg', '#7aa090', '#c0d0a0', '#3a3530')}
<rect width="320" height="240" fill="url(#l3bg)"/>
{mountain_layers([
  ('M 0 100 L 50 75 L 110 90 L 170 70 L 230 85 L 290 75 L 320 80 L 320 240 L 0 240 Z', '#5a6a52', 0.7),
])}
<path d="M 0 200 Q 60 195 130 198 T 280 200 L 320 200 L 320 240 L 0 240 Z" fill="#2a3525"/>
{figure_squat(140, 195, pack_color=PACK_LIN)}
{vibrate_phone(155, 185, '#4ade80')}
<!-- 笑声波形 (从手机出来, 飞向 mark) -->
<g opacity="0.7" stroke="#4ade80" stroke-width="1.4" fill="none" stroke-linecap="round">
<path d="M 165 175 q 8 -8 18 0"/>
<path d="M 175 168 q 12 -10 24 0"/>
<path d="M 188 162 q 8 -6 14 0"/>
</g>
{cairn_mark(220, 195, scale=0.85, color='#4ade80')}
<!-- 私人锁 -->
<g transform="translate(245 175)">
<rect x="-6" y="-2" width="12" height="9" rx="1.5" fill="#4ade80" opacity="0.9"/>
<path d="M -3 -2 L -3 -5 a 3 3 0 0 1 6 0 L 3 -2" fill="none" stroke="#4ade80" stroke-width="1.5"/>
</g>
{perm_chip_unified(220, 222, selected=0, color='#4ade80')}
</svg>''')

# 帧 4: 3 年后 笑声还在
LIN.append(f'''<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">
{grad_bg('l4bg', '#5a8a90', '#a8c8b8', '#3a3530')}
<rect width="320" height="240" fill="url(#l4bg)"/>
<defs>
<radialGradient id="l4pulse" cx="0.5" cy="0.5" r="0.5">
<stop offset="0%" stop-color="#4ade80" stop-opacity="0"/>
<stop offset="80%" stop-color="#4ade80" stop-opacity="0.3"/>
<stop offset="100%" stop-color="#4ade80" stop-opacity="0"/>
</radialGradient>
</defs>
{mountain_layers([
  ('M 0 100 L 50 75 L 110 90 L 170 70 L 230 85 L 290 75 L 320 80 L 320 240 L 0 240 Z', '#5a6a52', 0.7),
])}
<path d="M 0 200 Q 60 195 130 198 T 280 200 L 320 200 L 320 240 L 0 240 Z" fill="#2a3525"/>
<!-- mark 在原地 (脉冲动感) -->
<ellipse cx="160" cy="195" rx="60" ry="20" fill="url(#l4pulse)"/>
{cairn_mark(160, 195, scale=0.85, color='#4ade80')}
<!-- 笑脸 -->
<g transform="translate(160 168)" opacity="0.85">
<circle cx="0" cy="0" r="14" fill="none" stroke="#4ade80" stroke-width="1" stroke-dasharray="2 2"/>
<circle cx="-3" cy="-2" r="0.8" fill="#4ade80"/>
<circle cx="3" cy="-2" r="0.8" fill="#4ade80"/>
<path d="M -4 2 q 4 4 8 0" stroke="#4ade80" stroke-width="1" fill="none"/>
</g>
<!-- "3 年后" 标签 -->
<g transform="translate(160 220)">
<rect x="-26" y="-7" width="52" height="14" rx="7" fill="#1a1714" stroke="#4ade80" stroke-width="0.8"/>
<text x="0" y="3" text-anchor="middle" fill="#4ade80" font-size="9px" font-family="'Inter', 'PingFang SC', sans-serif" font-weight="500">3 年后</text>
</g>
</svg>''')


# ============== Sarah 4 帧 ==============

SARAH = []

# 帧 1: Sarah 在登山口 看手机攻略
SARAH.append(f'''<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">
{grad_bg('s1bg', '#3a4555', '#5a6878', '#1f1d28')}
<rect width="320" height="240" fill="url(#s1bg)"/>
{mountain_layers([
  ('M 0 100 L 50 75 L 110 90 L 170 70 L 230 85 L 290 75 L 320 80 L 320 240 L 0 240 Z', '#2a3545', 0.85),
  ('M 0 145 L 70 125 L 140 138 L 210 115 L 280 130 L 320 125 L 320 240 L 0 240 Z', '#3a4555', 0.8),
  ('M 0 195 L 80 185 L 160 195 L 240 180 L 320 190 L 320 240 L 0 240 Z', '#1a1d28', 1),
])}
<!-- 车 -->
<g transform="translate(80 195)">
<ellipse cx="0" cy="14" rx="25" ry="2" fill="#000" opacity="0.4"/>
<path d="M -22 5 L -16 -4 L 16 -4 L 22 5 L 22 12 L -22 12 Z" fill="#5a6878" opacity="0.85"/>
<path d="M -14 -4 L -10 -10 L 10 -10 L 14 -4 Z" fill="#3a4555" opacity="0.85"/>
<circle cx="-13" cy="12" r="3" fill="#1a1714"/>
<circle cx="13" cy="12" r="3" fill="#1a1714"/>
</g>
{figure_full(170, 198, scale=1, pack_color=PACK_SARAH, name='Sarah')}
<!-- 手机 (大, 显示户外攻略) -->
<g transform="translate(225 145)">
<rect x="-15" y="-30" width="50" height="80" rx="6" fill="#212638" stroke="#b0b6cc" stroke-width="0.8"/>
<rect x="-12" y="-25" width="44" height="70" rx="3" fill="#1a1d28" stroke="#3d3830" stroke-width="0.5"/>
<text x="10" y="-12" text-anchor="middle" fill="#38bdf8" font-size="7px" font-family="'Inter', 'PingFang SC', sans-serif" font-weight="600">户外攻略</text>
<text x="10" y="6" text-anchor="middle" fill="#fbbf24" font-size="13px">★★★★</text>
<text x="10" y="22" text-anchor="middle" fill="#9a9080" font-size="6px">中等难度</text>
<text x="10" y="36" text-anchor="middle" fill="#4ade80" font-size="6px">已查看</text>
</g>
</svg>''')

# 帧 2: 下午变天, Sarah 还在路上 (远小)
SARAH.append(f'''<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">
{grad_bg('s2bg', '#252835', '#5a6075', '#1a1d28')}
<rect width="320" height="240" fill="url(#s2bg)"/>
<g opacity="0.85">
<ellipse cx="80" cy="55" rx="55" ry="18" fill="#2a2c38"/>
<ellipse cx="180" cy="50" rx="65" ry="20" fill="#1a1d28"/>
<ellipse cx="260" cy="60" rx="50" ry="16" fill="#2a2c38"/>
</g>
{mountain_layers([
  ('M 0 105 L 60 80 L 130 95 L 200 70 L 280 90 L 320 85 L 320 240 L 0 240 Z', '#3a3a48', 0.85),
  ('M 0 175 L 80 165 L 160 175 L 240 160 L 320 170 L 320 240 L 0 240 Z', '#1a1d28', 1),
])}
<!-- 雨 -->
<g opacity="0.6" stroke="#a0b8d0" stroke-width="0.7" stroke-linecap="round">
<line x1="40" y1="80" x2="35" y2="100"/>
<line x1="80" y1="60" x2="75" y2="80"/>
<line x1="120" y1="80" x2="115" y2="100"/>
<line x1="160" y1="60" x2="155" y2="80"/>
<line x1="200" y1="80" x2="195" y2="100"/>
<line x1="240" y1="60" x2="235" y2="80"/>
<line x1="280" y1="80" x2="275" y2="100"/>
<line x1="60" y1="120" x2="55" y2="140"/>
<line x1="100" y1="100" x2="95" y2="120"/>
<line x1="180" y1="120" x2="175" y2="140"/>
<line x1="220" y1="100" x2="215" y2="120"/>
<line x1="260" y1="120" x2="255" y2="140"/>
<line x1="300" y1="100" x2="295" y2="120"/>
</g>
<path d="M 50 230 Q 100 200 140 195 T 220 170" stroke="#a0b8d0" stroke-width="1.4" fill="none" opacity="0.6" stroke-linecap="round"/>
{figure_small(150, 188, pack_color=PACK_SARAH)}
</svg>''')

# 帧 3: 雨里岔路口 看 mark
SARAH.append(f'''<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">
{grad_bg('s3bg', '#2a2c35', '#4a5260', '#1a1d28')}
<rect width="320" height="240" fill="url(#s3bg)"/>
{mountain_layers([
  ('M 0 100 L 60 80 L 130 95 L 200 70 L 280 90 L 320 85 L 320 240 L 0 240 Z', '#3a3a48', 0.85),
  ('M 0 175 L 80 165 L 160 175 L 240 160 L 320 170 L 320 240 L 0 240 Z', '#1a1d28', 1),
])}
<g opacity="0.55" stroke="#a0b8d0" stroke-width="0.7" stroke-linecap="round">
<line x1="40" y1="40" x2="35" y2="60"/>
<line x1="80" y1="20" x2="75" y2="40"/>
<line x1="120" y1="40" x2="115" y2="60"/>
<line x1="160" y1="20" x2="155" y2="40"/>
<line x1="200" y1="40" x2="195" y2="60"/>
<line x1="240" y1="20" x2="235" y2="40"/>
<line x1="280" y1="40" x2="275" y2="60"/>
<line x1="60" y1="80" x2="55" y2="100"/>
<line x1="180" y1="80" x2="175" y2="100"/>
<line x1="260" y1="80" x2="255" y2="100"/>
<line x1="100" y1="60" x2="95" y2="80"/>
<line x1="220" y1="60" x2="215" y2="80"/>
</g>
<path d="M 30 230 Q 100 195 130 188" stroke="#38bdf8" stroke-width="1.4" fill="none" opacity="0.7" stroke-linecap="round"/>
<path d="M 130 188 Q 170 170 210 145" stroke="#3d3830" stroke-width="1.2" fill="none" opacity="0.5" stroke-linecap="round" stroke-dasharray="4 3"/>
<path d="M 130 188 Q 180 195 240 195" stroke="#38bdf8" stroke-width="1.2" fill="none" opacity="0.65" stroke-linecap="round"/>
{figure_squat(130, 188, pack_color=PACK_SARAH)}
{cairn_mark(200, 175, scale=1, color='#38bdf8')}
<g transform="translate(160 105)">
<rect x="0" y="0" width="130" height="24" rx="6" fill="#1a1714" stroke="#38bdf8" stroke-width="1.2"/>
<text x="65" y="16" text-anchor="middle" fill="#e4e8f4" font-size="11px" font-family="'Inter', 'PingFang SC', sans-serif">雨季是河 走左边</text>
<path d="M 38 24 L 35 32 L 45 24 Z" fill="#1a1714" stroke="#38bdf8" stroke-width="1.2"/>
</g>
</svg>''')

# 帧 4: 停车场, 留 mark (公开)
SARAH.append(f'''<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">
{grad_bg('s4bg', '#3a4555', '#6a7a8a', '#1f1d28')}
<rect width="320" height="240" fill="url(#s4bg)"/>
{mountain_layers([
  ('M 0 100 L 60 75 L 130 90 L 200 65 L 280 85 L 320 80 L 320 240 L 0 240 Z', '#3a3a48', 0.85),
  ('M 0 175 L 80 165 L 160 175 L 240 160 L 320 170 L 320 240 L 0 240 Z', '#1a1d28', 1),
])}
<!-- 停车场: 多辆车 + 地面 -->
<rect x="0" y="195" width="320" height="45" fill="#2a2c38"/>
<g opacity="0.6" stroke="#9a9080" stroke-width="0.6" fill="none" stroke-dasharray="6 4">
<line x1="40" y1="220" x2="80" y2="220"/>
<line x1="140" y1="220" x2="180" y2="220"/>
<line x1="240" y1="220" x2="280" y2="220"/>
</g>
<!-- 远车 -->
<g transform="translate(60 200)" opacity="0.7">
<path d="M -18 4 L -13 -3 L 13 -3 L 18 4 L 18 10 L -18 10 Z" fill="#4a5060"/>
<circle cx="-10" cy="10" r="2.5" fill="#1a1714"/>
<circle cx="10" cy="10" r="2.5" fill="#1a1714"/>
</g>
<!-- Sarah 的车 -->
<g transform="translate(220 198)">
<ellipse cx="0" cy="14" rx="25" ry="2" fill="#000" opacity="0.4"/>
<path d="M -22 5 L -16 -4 L 16 -4 L 22 5 L 22 12 L -22 12 Z" fill="#5a6878"/>
<path d="M -14 -4 L -10 -10 L 10 -10 L 14 -4 Z" fill="#3a4555"/>
<circle cx="-13" cy="12" r="3" fill="#1a1714"/>
<circle cx="13" cy="12" r="3" fill="#1a1714"/>
</g>
<!-- Sarah (站车旁, 鞋还在滴水) -->
{figure_full(160, 200, scale=1, pack_color=PACK_SARAH)}
<!-- 大手机 显示她留的 mark -->
<g transform="translate(120 145)">
<rect x="-18" y="-32" width="36" height="56" rx="6" fill="#212638" stroke="#b0b6cc" stroke-width="1"/>
<rect x="-15" y="-28" width="30" height="48" rx="3" fill="#1a1d28"/>
<text x="0" y="-18" text-anchor="middle" fill="#38bdf8" font-size="6px" font-family="'Inter', sans-serif" font-weight="600">公开</text>
<text x="0" y="-6" text-anchor="middle" fill="#e4e8f4" font-size="5.5px" font-family="'Inter', 'PingFang SC', sans-serif">如果天气预报</text>
<text x="0" y="2" text-anchor="middle" fill="#e4e8f4" font-size="5.5px" font-family="'Inter', 'PingFang SC', sans-serif">说下午 3 点</text>
<text x="0" y="10" text-anchor="middle" fill="#e4e8f4" font-size="5.5px" font-family="'Inter', 'PingFang SC', sans-serif">开始下雨</text>
<text x="0" y="20" text-anchor="middle" fill="#9a9080" font-size="5.5px" font-family="'Inter', 'PingFang SC', sans-serif">1 点前下来</text>
</g>
{perm_chip_unified(180, 225, selected=2, color='#38bdf8')}
</svg>''')


# ============== 输出 ==============
def to_js(arr):
    out = []
    for s in arr:
        safe = s.replace("`", "\\`").replace("${", "\\${")
        out.append(f"      `{safe}`,")
    return "\n".join(out)

with open('C:/ClaudeCodeProjects/Cairn/research/jamie_v4.js','w',encoding='utf-8') as f:
    f.write(to_js(JAMIE))
with open('C:/ClaudeCodeProjects/Cairn/research/murray_v4.js','w',encoding='utf-8') as f:
    f.write(to_js(MURRAY))
with open('C:/ClaudeCodeProjects/Cairn/research/lin_v4.js','w',encoding='utf-8') as f:
    f.write(to_js(LIN))
with open('C:/ClaudeCodeProjects/Cairn/research/sarah_v4.js','w',encoding='utf-8') as f:
    f.write(to_js(SARAH))
print('OK 4 cards')
