"""v2 太阳 + SVG 升级
重点: 太阳用多层渐变 + 山脊剪影后面冒出 / 沉下去, 而不是简单 circle
"""

JAMIE_ART_V2 = []

# 帧 1: 朝阳 - 在山脊后面冒出来 (剪影感)
JAMIE_ART_V2.append('''<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">
<defs>
  <linearGradient id="j1v2-bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#3a3344"/>
    <stop offset="35%" stop-color="#5a4555"/>
    <stop offset="65%" stop-color="#8a6555"/>
    <stop offset="100%" stop-color="#1f1d28"/>
  </linearGradient>
  <radialGradient id="j1v2-sun" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0%" stop-color="#ffd28a" stop-opacity="1"/>
    <stop offset="30%" stop-color="#ffb068" stop-opacity="0.85"/>
    <stop offset="60%" stop-color="#f08555" stop-opacity="0.4"/>
    <stop offset="100%" stop-color="#f08555" stop-opacity="0"/>
  </radialGradient>
  <clipPath id="j1v2-clip-sun">
    <rect x="0" y="0" width="320" height="115"/>
  </clipPath>
</defs>
<rect width="320" height="240" fill="url(#j1v2-bg)"/>

<!-- 太阳光晕(大范围) -->
<ellipse cx="220" cy="100" rx="120" ry="80" fill="url(#j1v2-sun)" opacity="0.7"/>

<!-- 太阳 (在远山后面冒出来,只露上半 - 用 clip 切) -->
<g clip-path="url(#j1v2-clip-sun)">
  <circle cx="220" cy="115" r="22" fill="#ffd28a" opacity="0.95"/>
  <circle cx="220" cy="115" r="30" fill="none" stroke="#ffd28a" stroke-width="0.5" opacity="0.4"/>
  <circle cx="220" cy="115" r="40" fill="none" stroke="#ffb068" stroke-width="0.4" opacity="0.25"/>
</g>

<!-- 远山(深色,吃住太阳) -->
<path d="M 0 115 L 50 95 L 130 105 L 200 88 L 260 100 L 320 95 L 320 240 L 0 240 Z" fill="#2a2435" opacity="0.92"/>
<!-- 中山 -->
<path d="M 0 155 L 70 135 L 140 148 L 210 125 L 280 140 L 320 135 L 320 240 L 0 240 Z" fill="#3a3344" opacity="0.9"/>
<!-- 近山 -->
<path d="M 0 195 L 80 185 L 160 195 L 240 180 L 320 190 L 320 240 L 0 240 Z" fill="#4a3d4f"/>

<!-- 步道 -->
<path d="M 100 240 Q 130 220 145 200 T 170 165" stroke="#d4a575" stroke-width="1.4" fill="none" opacity="0.6" stroke-linecap="round"/>
<path d="M 130 240 Q 155 220 170 200 T 195 165" stroke="#d4a575" stroke-width="1.2" fill="none" opacity="0.4" stroke-linecap="round"/>

<!-- Jamie -->
<g>
  <ellipse cx="115" cy="218" rx="9" ry="2" fill="#000" opacity="0.4"/>
  <circle cx="115" cy="180" r="6" fill="#1a1714"/>
  <path d="M 114 186 L 114 203 L 110 215 L 112 215 L 115 204 L 118 215 L 120 215 L 116 203 L 116 186 Z" fill="#1a1714"/>
  <path d="M 114 192 L 107 199 L 108 200 L 115 194" fill="#1a1714"/>
  <path d="M 116 192 L 123 199 L 122 200 L 115 194" fill="#1a1714"/>
  <rect x="108" y="190" width="6" height="10" rx="2" fill="#3d3830"/>
  <text x="115" y="170" text-anchor="middle" fill="#e4e8f4" font-size="9px" font-family="'Inter', 'PingFang SC', sans-serif" letter-spacing="0.04em" font-weight="500">Jamie</text>
</g>
</svg>''')

# 帧 2: 落日 - 一个人在山脊上, 太阳要落下了
JAMIE_ART_V2.append('''<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">
<defs>
  <linearGradient id="j2v2-bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#5a4565"/>
    <stop offset="30%" stop-color="#8a5d65"/>
    <stop offset="55%" stop-color="#c97f5a"/>
    <stop offset="80%" stop-color="#7a5550"/>
    <stop offset="100%" stop-color="#2a2535"/>
  </linearGradient>
  <radialGradient id="j2v2-glow" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0%" stop-color="#ffc888" stop-opacity="0.95"/>
    <stop offset="40%" stop-color="#f08555" stop-opacity="0.55"/>
    <stop offset="100%" stop-color="#c95535" stop-opacity="0"/>
  </radialGradient>
  <clipPath id="j2v2-clip-sun">
    <rect x="0" y="0" width="320" height="155"/>
  </clipPath>
</defs>
<rect width="320" height="240" fill="url(#j2v2-bg)"/>

<!-- 落日光晕 -->
<ellipse cx="120" cy="155" rx="200" ry="100" fill="url(#j2v2-glow)" opacity="0.8"/>

<!-- 落日(被山脊吃住下半) -->
<g clip-path="url(#j2v2-clip-sun)">
  <circle cx="120" cy="155" r="28" fill="#ffc080"/>
  <circle cx="120" cy="155" r="38" fill="none" stroke="#ffc080" stroke-width="0.6" opacity="0.5"/>
  <circle cx="120" cy="155" r="50" fill="none" stroke="#f5a060" stroke-width="0.4" opacity="0.3"/>
</g>

<!-- 远山深色剪影 -->
<path d="M 0 100 L 60 75 L 130 90 L 200 65 L 280 85 L 320 80 L 320 240 L 0 240 Z" fill="#2a1f30" opacity="0.7"/>

<!-- 山脊路 (Jamie 走在脊上) -->
<path d="M 0 155 Q 80 145 160 155 T 320 150" fill="#1a1525"/>
<path d="M 0 155 Q 80 145 160 155 T 320 150 L 320 240 L 0 240 Z" fill="#0e0818" opacity="0.85"/>

<!-- 山脊轮廓线 -->
<path d="M 0 155 Q 80 145 160 155 T 320 150" stroke="#ffb068" stroke-width="0.6" fill="none" opacity="0.5"/>

<!-- Jamie 很小, 走在山脊上 -->
<g>
  <circle cx="200" cy="143" r="3" fill="#000"/>
  <path d="M 199.5 146 L 199.5 154 L 198 159 L 198.5 159 L 200 154.5 L 201.5 159 L 202 159 L 200.5 154 L 200.5 146 Z" fill="#000"/>
  <rect x="197.5" y="148" width="2.5" height="5" rx="0.8" fill="#000"/>
</g>

<!-- 飞鸟 -->
<path d="M 60 50 q 5 -3 10 0 q 5 -3 10 0" stroke="#000" stroke-width="1.2" fill="none" opacity="0.6" stroke-linecap="round"/>
<path d="M 240 60 q 4 -2 8 0 q 4 -2 8 0" stroke="#000" stroke-width="1.2" fill="none" opacity="0.6" stroke-linecap="round"/>
</svg>''')

# 帧 3: 落日 + 蹲下看 mark
JAMIE_ART_V2.append('''<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">
<defs>
  <linearGradient id="j3v2-bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#4a3a55"/>
    <stop offset="35%" stop-color="#9c6358"/>
    <stop offset="65%" stop-color="#d49568"/>
    <stop offset="100%" stop-color="#3a2530"/>
  </linearGradient>
  <radialGradient id="j3v2-mark-glow" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0%" stop-color="#ffc888" stop-opacity="0.85"/>
    <stop offset="100%" stop-color="#ffc888" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="j3v2-sun" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0%" stop-color="#ffd0a0" stop-opacity="0.9"/>
    <stop offset="60%" stop-color="#ffa060" stop-opacity="0.4"/>
    <stop offset="100%" stop-color="#ffa060" stop-opacity="0"/>
  </radialGradient>
  <clipPath id="j3v2-clip-sun">
    <rect x="0" y="0" width="320" height="135"/>
  </clipPath>
</defs>
<rect width="320" height="240" fill="url(#j3v2-bg)"/>

<!-- 远处太阳光晕 -->
<ellipse cx="265" cy="130" rx="100" ry="60" fill="url(#j3v2-sun)" opacity="0.85"/>
<g clip-path="url(#j3v2-clip-sun)">
  <circle cx="265" cy="125" r="16" fill="#ffd0a0"/>
  <circle cx="265" cy="125" r="22" fill="none" stroke="#ffc080" stroke-width="0.5" opacity="0.5"/>
</g>

<!-- 远山 -->
<path d="M 0 130 L 60 105 L 130 120 L 200 95 L 280 115 L 320 110 L 320 240 L 0 240 Z" fill="#3a2c40" opacity="0.85"/>
<!-- 近山 -->
<path d="M 0 175 L 80 165 L 160 175 L 240 160 L 320 170 L 320 240 L 0 240 Z" fill="#2a1d28"/>

<!-- 步道 -->
<path d="M 30 230 Q 100 195 170 175 T 280 145" stroke="#d4a575" stroke-width="1.4" fill="none" opacity="0.7" stroke-linecap="round"/>

<!-- Jamie 蹲下 -->
<g transform="translate(135 175)">
  <ellipse cx="0" cy="15" rx="10" ry="2" fill="#000" opacity="0.4"/>
  <circle cx="0" cy="-10" r="6" fill="#1a1714"/>
  <path d="M -1 -4 L -1 4 L -6 12 L -4 13 L 0 5 L 4 13 L 6 12 L 1 4 L 1 -4 Z" fill="#1a1714"/>
  <path d="M 1 0 L 12 -2 L 12 0 L 0 1" fill="#1a1714"/>
  <path d="M -1 0 L -8 -1 L -8 1 L 0 1" fill="#1a1714"/>
  <rect x="-7" y="-3" width="6" height="8" rx="2" fill="#3d3830"/>
</g>

<!-- AR 石堆 (温暖橘色) -->
<ellipse cx="220" cy="170" rx="40" ry="13" fill="url(#j3v2-mark-glow)"/>
<g transform="translate(220 170)">
  <ellipse cx="0" cy="2" rx="14" ry="3" fill="#000" opacity="0.4"/>
  <path d="M -13 -1 Q -11 -7 0 -6 Q 13 -7 14 -1 Q 11 4 0 4 Q -10 4 -13 -1 Z" fill="#ffb068" opacity="0.92"/>
  <path d="M -10 -10 Q -8 -15 0 -14 Q 9 -15 10 -10 Q 7 -6 0 -6 Q -7 -6 -10 -10 Z" fill="#ffc080" opacity="0.9"/>
  <path d="M -7 -19 Q -5 -23 0 -22 Q 6 -23 7 -19 Q 5 -16 0 -15 Q -5 -16 -7 -19 Z" fill="#ffc888" opacity="0.88"/>
  <path d="M -4 -26 Q -3 -28 0 -28 Q 3 -28 4 -26 Q 3 -24 0 -24 Q -3 -24 -4 -26 Z" fill="#ffd28a" opacity="0.85"/>
</g>

<!-- 文字气泡 -->
<g transform="translate(178 102)">
  <rect x="0" y="0" width="124" height="32" rx="6" fill="#1a1714" stroke="#ffb068" stroke-width="1.2"/>
  <text x="62" y="14" text-anchor="middle" fill="#e4e8f4" font-size="11px" font-family="'Inter', 'PingFang SC', sans-serif">这里很安全</text>
  <text x="62" y="27" text-anchor="middle" fill="#e4e8f4" font-size="11px" font-family="'Inter', 'PingFang SC', sans-serif">日落很美</text>
  <path d="M 35 32 L 32 40 L 42 32 Z" fill="#1a1714" stroke="#ffb068" stroke-width="1.2"/>
</g>

<!-- 振动手机 -->
<g transform="translate(150 162)">
  <rect x="-4" y="-8" width="10" height="16" rx="2" fill="#212638" stroke="#b0b6cc" stroke-width="0.8"/>
  <path d="M 8 -4 Q 11 0 8 4" stroke="#ffb068" stroke-width="1" fill="none"/>
  <path d="M 11 -7 Q 16 0 11 7" stroke="#ffb068" stroke-width="1" fill="none"/>
</g>
</svg>''')

# 帧 4: 海岸 + 看海 + 录温暖的话
JAMIE_ART_V2.append('''<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">
<defs>
  <linearGradient id="j4v2-bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#403458"/>
    <stop offset="40%" stop-color="#6a4f5a"/>
    <stop offset="70%" stop-color="#a08570"/>
    <stop offset="100%" stop-color="#2a2535"/>
  </linearGradient>
  <linearGradient id="j4v2-sea" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#5d7990"/>
    <stop offset="50%" stop-color="#8aa0b0"/>
    <stop offset="100%" stop-color="#3a4858"/>
  </linearGradient>
  <radialGradient id="j4v2-mark-glow" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0%" stop-color="#4ade80" stop-opacity="0.55"/>
    <stop offset="100%" stop-color="#4ade80" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="j4v2-sun" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0%" stop-color="#ffd0a0" stop-opacity="0.95"/>
    <stop offset="40%" stop-color="#ffa060" stop-opacity="0.5"/>
    <stop offset="100%" stop-color="#c95535" stop-opacity="0"/>
  </radialGradient>
  <clipPath id="j4v2-clip-sun">
    <rect x="0" y="0" width="320" height="115"/>
  </clipPath>
</defs>
<rect width="320" height="240" fill="url(#j4v2-bg)"/>

<!-- 落日光晕 (远海边) -->
<ellipse cx="245" cy="115" rx="120" ry="70" fill="url(#j4v2-sun)" opacity="0.85"/>
<g clip-path="url(#j4v2-clip-sun)">
  <circle cx="245" cy="115" r="22" fill="#ffd0a0"/>
  <circle cx="245" cy="115" r="32" fill="none" stroke="#ffc080" stroke-width="0.5" opacity="0.5"/>
</g>

<!-- 海 -->
<rect x="0" y="115" width="320" height="60" fill="url(#j4v2-sea)"/>
<!-- 海平面落日反光路 -->
<ellipse cx="245" cy="118" rx="60" ry="3" fill="#ffd0a0" opacity="0.55"/>
<ellipse cx="245" cy="125" rx="40" ry="2" fill="#ffd0a0" opacity="0.4"/>
<ellipse cx="245" cy="132" rx="28" ry="1.5" fill="#ffd0a0" opacity="0.3"/>
<!-- 海浪 -->
<path d="M 0 130 q 30 -2 60 0 t 120 0 t 120 0" stroke="#cbd5e1" stroke-width="0.5" fill="none" opacity="0.4"/>
<path d="M 0 145 q 25 -2 50 0 t 100 0 t 100 0 t 100 0" stroke="#cbd5e1" stroke-width="0.5" fill="none" opacity="0.3"/>

<!-- 远岸 -->
<path d="M 0 110 L 80 105 L 160 112 L 240 100 L 320 108 L 320 130 L 0 130 Z" fill="#3a2c40" opacity="0.9"/>
<!-- 海岸悬崖 -->
<path d="M 0 175 L 80 168 L 160 178 L 240 165 L 320 175 L 320 240 L 0 240 Z" fill="#2a1d28"/>

<!-- Jamie 站在悬崖边看海 -->
<g>
  <ellipse cx="125" cy="208" rx="9" ry="2" fill="#000" opacity="0.4"/>
  <circle cx="125" cy="170" r="6" fill="#1a1714"/>
  <path d="M 124 176 L 124 193 L 120 205 L 122 205 L 125 194 L 128 205 L 130 205 L 126 193 L 126 176 Z" fill="#1a1714"/>
  <path d="M 124 182 L 117 189 L 118 190 L 125 184" fill="#1a1714"/>
  <path d="M 126 182 L 133 189 L 132 190 L 125 184" fill="#1a1714"/>
  <rect x="118" y="180" width="6" height="10" rx="2" fill="#3d3830"/>
</g>

<!-- 自己留的 mark (绿色) -->
<ellipse cx="185" cy="185" rx="32" ry="10" fill="url(#j4v2-mark-glow)"/>
<g transform="translate(185 185)">
  <ellipse cx="0" cy="2" rx="11" ry="2.5" fill="#000" opacity="0.4"/>
  <path d="M -10 -1 Q -8 -6 0 -5 Q 10 -6 11 -1 Q 8 3 0 3 Q -8 3 -10 -1 Z" fill="#4ade80" opacity="0.85"/>
  <path d="M -8 -8 Q -6 -12 0 -11 Q 7 -12 8 -8 Q 5 -5 0 -5 Q -5 -5 -8 -8 Z" fill="#4ade80" opacity="0.82"/>
  <path d="M -5 -15 Q -4 -18 0 -17 Q 5 -18 5 -15 Q 4 -13 0 -12 Q -4 -13 -5 -15 Z" fill="#4ade80" opacity="0.78"/>
</g>

<!-- 飞鸟 -->
<path d="M 80 65 q 4 -3 8 0 q 4 -3 8 0" stroke="#000" stroke-width="1.2" fill="none" opacity="0.5" stroke-linecap="round"/>
<path d="M 280 80 q 3 -2 6 0 q 3 -2 6 0" stroke="#000" stroke-width="1.2" fill="none" opacity="0.5" stroke-linecap="round"/>

<!-- 权限 chip -->
<g transform="translate(180 220)">
  <rect x="-44" y="-8" width="88" height="16" rx="8" fill="#1a1714" stroke="#3d3830" stroke-width="0.8"/>
  <text x="-30" y="3" text-anchor="middle" fill="#9a9080" font-size="8px" font-family="'Inter', 'PingFang SC', sans-serif">自己</text>
  <text x="0" y="3" text-anchor="middle" fill="#9a9080" font-size="8px" font-family="'Inter', 'PingFang SC', sans-serif">朋友</text>
  <rect x="14" y="-7" width="36" height="14" rx="7" fill="#4ade80" opacity="0.9"/>
  <text x="32" y="3" text-anchor="middle" fill="#1a1714" font-size="8px" font-family="'Inter', 'PingFang SC', sans-serif" font-weight="600">路过的人</text>
</g>
</svg>''')

# 输出
with open('C:/ClaudeCodeProjects/Cairn/research/jamie_v2.js','w',encoding='utf-8') as f:
    out = []
    for s in JAMIE_ART_V2:
        safe = s.replace("`", "\\`").replace("${", "\\${")
        out.append(f"      `{safe}`,")
    f.write("\n".join(out))
print('OK 4 frames')
