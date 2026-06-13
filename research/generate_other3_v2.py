"""v3 - Murray, Lin, Sarah 全部升级到电影感渐变背景 + 山脊剪影 + 不丑的太阳/光"""

# Murray: 偏暮色,稳重,温柔 - 蓝紫到深棕色 (老人,黄昏)
MURRAY_ART = []

# 帧 1: Murray 30 年走过 - hut 在远处的暮色里
MURRAY_ART.append('''<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">
<defs>
  <linearGradient id="m1-bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#3a4055"/>
    <stop offset="40%" stop-color="#5a5868"/>
    <stop offset="80%" stop-color="#48424a"/>
    <stop offset="100%" stop-color="#1f1d28"/>
  </linearGradient>
  <radialGradient id="m1-glow" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0%" stop-color="#d4a575" stop-opacity="0.45"/>
    <stop offset="100%" stop-color="#d4a575" stop-opacity="0"/>
  </radialGradient>
</defs>
<rect width="320" height="240" fill="url(#m1-bg)"/>
<!-- 远处暮色光晕 -->
<ellipse cx="180" cy="130" rx="180" ry="60" fill="url(#m1-glow)" opacity="0.7"/>
<!-- 远山深色剪影 -->
<path d="M 0 110 L 60 85 L 130 100 L 200 75 L 280 95 L 320 90 L 320 240 L 0 240 Z" fill="#2a2c38" opacity="0.85"/>
<path d="M 0 145 L 70 125 L 140 138 L 210 115 L 280 130 L 320 125 L 320 240 L 0 240 Z" fill="#3a3c48" opacity="0.85"/>
<!-- hut 在远处中山上 -->
<g transform="translate(220 145)">
  <path d="M -18 0 L -18 -10 L 0 -22 L 18 -10 L 18 0 Z" fill="#2a2530" stroke="#7a6555" stroke-width="0.8"/>
  <rect x="-7" y="-7" width="5" height="7" fill="#d4a575" opacity="0.55"/>
  <rect x="-15" y="-1" width="30" height="1.5" fill="#5a4a3a" opacity="0.7"/>
</g>
<!-- 近山 -->
<path d="M 0 195 L 80 185 L 160 195 L 240 180 L 320 190 L 320 240 L 0 240 Z" fill="#1a1d28"/>
<!-- Murray (高一点, 老人感) -->
<g>
  <ellipse cx="115" cy="218" rx="9" ry="2" fill="#000" opacity="0.4"/>
  <circle cx="115" cy="180" r="6" fill="#1a1714"/>
  <path d="M 114 186 L 114 203 L 110 215 L 112 215 L 115 204 L 118 215 L 120 215 L 116 203 L 116 186 Z" fill="#1a1714"/>
  <path d="M 114 192 L 107 199 L 108 200 L 115 194" fill="#1a1714"/>
  <path d="M 116 192 L 123 199 L 122 200 L 115 194" fill="#1a1714"/>
  <rect x="108" y="190" width="6" height="10" rx="2" fill="#3d3830"/>
  <text x="115" y="170" text-anchor="middle" fill="#e4e8f4" font-size="9px" font-family="'Inter', 'PingFang SC', sans-serif" letter-spacing="0.04em" font-weight="500">Murray</text>
</g>
<!-- 飞鸟 -->
<path d="M 50 60 q 4 -3 8 0 q 4 -3 8 0" stroke="#000" stroke-width="1.2" fill="none" opacity="0.5" stroke-linecap="round"/>
</svg>''')

# 帧 2: 岔路口 - 他停下来看左右两条路
MURRAY_ART.append('''<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">
<defs>
  <linearGradient id="m2-bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#383a4c"/>
    <stop offset="50%" stop-color="#5a4a52"/>
    <stop offset="100%" stop-color="#1f1d28"/>
  </linearGradient>
  <radialGradient id="m2-glow" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0%" stop-color="#a78bfa" stop-opacity="0.4"/>
    <stop offset="100%" stop-color="#a78bfa" stop-opacity="0"/>
  </radialGradient>
</defs>
<rect width="320" height="240" fill="url(#m2-bg)"/>
<!-- 暮色光晕 -->
<ellipse cx="160" cy="100" rx="180" ry="60" fill="url(#m2-glow)" opacity="0.7"/>
<!-- 远山 -->
<path d="M 0 130 L 60 105 L 130 120 L 200 95 L 280 115 L 320 110 L 320 240 L 0 240 Z" fill="#2a2c38" opacity="0.8"/>
<!-- 近山 -->
<path d="M 0 175 L 80 165 L 160 175 L 240 160 L 320 170 L 320 240 L 0 240 Z" fill="#1a1d28"/>
<!-- 岔路: 主路过来到分叉 -->
<path d="M 30 230 Q 80 200 140 195 L 165 188" stroke="#a78bfa" stroke-width="1.6" fill="none" opacity="0.85" stroke-linecap="round"/>
<!-- 左路 (虚线 - 错的) -->
<path d="M 165 188 Q 200 175 240 145" stroke="#7a6580" stroke-width="1.2" fill="none" opacity="0.6" stroke-linecap="round" stroke-dasharray="4 3"/>
<!-- 右路 (正路) -->
<path d="M 165 188 Q 215 195 275 200" stroke="#a78bfa" stroke-width="1.4" fill="none" opacity="0.85" stroke-linecap="round"/>
<!-- 岔路口标记圆 -->
<g transform="translate(165 188)">
  <circle cx="0" cy="0" r="4" fill="#a78bfa"/>
  <circle cx="0" cy="0" r="9" fill="none" stroke="#a78bfa" stroke-width="1" opacity="0.5"/>
  <circle cx="0" cy="0" r="14" fill="none" stroke="#a78bfa" stroke-width="0.6" opacity="0.3"/>
</g>
<!-- Murray 站在路口 -->
<g>
  <ellipse cx="120" cy="208" rx="9" ry="2" fill="#000" opacity="0.4"/>
  <circle cx="120" cy="170" r="6" fill="#1a1714"/>
  <path d="M 119 176 L 119 193 L 115 205 L 117 205 L 120 194 L 123 205 L 125 205 L 121 193 L 121 176 Z" fill="#1a1714"/>
  <path d="M 119 182 L 112 189 L 113 190 L 120 184" fill="#1a1714"/>
  <path d="M 121 182 L 128 189 L 127 190 L 120 184" fill="#1a1714"/>
  <rect x="113" y="180" width="6" height="10" rx="2" fill="#3d3830"/>
</g>
</svg>''')

# 帧 3: Murray 蹲下留 mark
MURRAY_ART.append('''<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">
<defs>
  <linearGradient id="m3-bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#3a3a4f"/>
    <stop offset="50%" stop-color="#5a4a5a"/>
    <stop offset="100%" stop-color="#1f1d28"/>
  </linearGradient>
  <radialGradient id="m3-mark-glow" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0%" stop-color="#a78bfa" stop-opacity="0.55"/>
    <stop offset="100%" stop-color="#a78bfa" stop-opacity="0"/>
  </radialGradient>
</defs>
<rect width="320" height="240" fill="url(#m3-bg)"/>
<path d="M 0 130 L 60 105 L 130 120 L 200 95 L 280 115 L 320 110 L 320 240 L 0 240 Z" fill="#2a2c38" opacity="0.85"/>
<path d="M 0 175 L 80 165 L 160 175 L 240 160 L 320 170 L 320 240 L 0 240 Z" fill="#1a1d28"/>
<path d="M 30 230 Q 100 195 170 175 T 280 130" stroke="#a78bfa" stroke-width="1.4" fill="none" opacity="0.7" stroke-linecap="round"/>

<!-- Murray 蹲下 -->
<g transform="translate(140 175)">
  <ellipse cx="0" cy="15" rx="10" ry="2" fill="#000" opacity="0.4"/>
  <circle cx="0" cy="-10" r="6" fill="#1a1714"/>
  <path d="M -1 -4 L -1 4 L -6 12 L -4 13 L 0 5 L 4 13 L 6 12 L 1 4 L 1 -4 Z" fill="#1a1714"/>
  <path d="M 1 0 L 12 -2 L 12 0 L 0 1" fill="#1a1714"/>
  <rect x="-7" y="-3" width="6" height="8" rx="2" fill="#3d3830"/>
</g>

<!-- Mark (紫色, Murray 留的) -->
<ellipse cx="200" cy="172" rx="40" ry="13" fill="url(#m3-mark-glow)"/>
<g transform="translate(200 172)">
  <ellipse cx="0" cy="2" rx="14" ry="3" fill="#000" opacity="0.4"/>
  <path d="M -13 -1 Q -11 -7 0 -6 Q 13 -7 14 -1 Q 11 4 0 4 Q -10 4 -13 -1 Z" fill="#a78bfa" opacity="0.92"/>
  <path d="M -10 -10 Q -8 -15 0 -14 Q 9 -15 10 -10 Q 7 -6 0 -6 Q -7 -6 -10 -10 Z" fill="#a78bfa" opacity="0.88"/>
  <path d="M -7 -19 Q -5 -23 0 -22 Q 6 -23 7 -19 Q 5 -16 0 -15 Q -5 -16 -7 -19 Z" fill="#a78bfa" opacity="0.85"/>
  <path d="M -4 -26 Q -3 -28 0 -28 Q 3 -28 4 -26 Q 3 -24 0 -24 Q -3 -24 -4 -26 Z" fill="#a78bfa" opacity="0.82"/>
</g>

<!-- 气泡 -->
<g transform="translate(165 102)">
  <rect x="0" y="0" width="120" height="26" rx="6" fill="#1a1714" stroke="#a78bfa" stroke-width="1.2"/>
  <text x="60" y="17" text-anchor="middle" fill="#e4e8f4" font-size="11px" font-family="'Inter', 'PingFang SC', sans-serif">右边才是正道</text>
  <path d="M 38 26 L 35 34 L 45 26 Z" fill="#1a1714" stroke="#a78bfa" stroke-width="1.2"/>
</g>

<!-- 权限 chip (公开) -->
<g transform="translate(200 218)">
  <rect x="-44" y="-8" width="88" height="16" rx="8" fill="#1a1714" stroke="#3d3830" stroke-width="0.8"/>
  <text x="-30" y="3" text-anchor="middle" fill="#9a9080" font-size="8px" font-family="'Inter', 'PingFang SC', sans-serif">自己</text>
  <text x="0" y="3" text-anchor="middle" fill="#9a9080" font-size="8px" font-family="'Inter', 'PingFang SC', sans-serif">朋友</text>
  <rect x="14" y="-7" width="36" height="14" rx="7" fill="#a78bfa" opacity="0.9"/>
  <text x="32" y="3" text-anchor="middle" fill="#1a1714" font-size="8px" font-family="'Inter', 'PingFang SC', sans-serif" font-weight="600">公开</text>
</g>
</svg>''')

# 帧 4: Murray 走开, 远处石堆变小但还在
MURRAY_ART.append('''<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">
<defs>
  <linearGradient id="m4-bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#3a3a4f"/>
    <stop offset="60%" stop-color="#5a4858"/>
    <stop offset="100%" stop-color="#1f1d28"/>
  </linearGradient>
  <radialGradient id="m4-glow" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0%" stop-color="#a78bfa" stop-opacity="0.3"/>
    <stop offset="100%" stop-color="#a78bfa" stop-opacity="0"/>
  </radialGradient>
</defs>
<rect width="320" height="240" fill="url(#m4-bg)"/>
<path d="M 0 100 L 60 75 L 130 90 L 200 65 L 280 85 L 320 80 L 320 240 L 0 240 Z" fill="#2a2c38" opacity="0.8"/>
<path d="M 0 145 L 70 125 L 140 138 L 210 115 L 280 130 L 320 125 L 320 240 L 0 240 Z" fill="#3a3c48" opacity="0.85"/>
<path d="M 0 175 L 80 165 L 160 175 L 240 160 L 320 170 L 320 240 L 0 240 Z" fill="#1a1d28"/>
<path d="M 30 230 Q 100 200 160 180 T 280 130" stroke="#a78bfa" stroke-width="1.4" fill="none" opacity="0.7" stroke-linecap="round"/>

<!-- 远处的 mark (变小, 暗些) -->
<ellipse cx="100" cy="200" rx="18" ry="6" fill="url(#m4-glow)"/>
<g transform="translate(100 200)" opacity="0.7">
  <ellipse cx="0" cy="2" rx="8" ry="2" fill="#000" opacity="0.4"/>
  <path d="M -7 -1 Q -6 -4 0 -3 Q 7 -4 7 -1 Q 5 2 0 2 Q -5 2 -7 -1 Z" fill="#a78bfa"/>
  <path d="M -5 -6 Q -4 -8 0 -8 Q 5 -8 5 -6 Q 3 -4 0 -4 Q -4 -4 -5 -6 Z" fill="#a78bfa"/>
  <path d="M -3 -11 Q -2 -13 0 -12 Q 3 -13 3 -11 Q 2 -10 0 -10 Q -2 -10 -3 -11 Z" fill="#a78bfa"/>
</g>

<!-- Murray 往前走 -->
<g>
  <ellipse cx="220" cy="208" rx="9" ry="2" fill="#000" opacity="0.4"/>
  <circle cx="220" cy="170" r="6" fill="#1a1714"/>
  <path d="M 219 176 L 219 193 L 215 205 L 217 205 L 220 194 L 223 205 L 225 205 L 221 193 L 221 176 Z" fill="#1a1714"/>
  <path d="M 219 182 L 212 189 L 213 190 L 220 184" fill="#1a1714"/>
  <path d="M 221 182 L 228 189 L 227 190 L 220 184" fill="#1a1714"/>
  <rect x="213" y="180" width="6" height="10" rx="2" fill="#3d3830"/>
</g>
<path d="M 30 50 Q 50 40 70 50" stroke="#000" stroke-width="1.2" fill="none" opacity="0.5" stroke-linecap="round"/>
</svg>''')

# Lin: 温暖, 妈妈, 风, 山顶 - 黄昏粉绿,暖
LIN_ART = []

# 帧 1: Lin 和女儿在登山口
LIN_ART.append('''<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">
<defs>
  <linearGradient id="l1-bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#5a8a7a"/>
    <stop offset="40%" stop-color="#a4b88a"/>
    <stop offset="80%" stop-color="#7a8055"/>
    <stop offset="100%" stop-color="#2a2528"/>
  </linearGradient>
  <radialGradient id="l1-glow" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0%" stop-color="#fff5d0" stop-opacity="0.6"/>
    <stop offset="100%" stop-color="#fff5d0" stop-opacity="0"/>
  </radialGradient>
</defs>
<rect width="320" height="240" fill="url(#l1-bg)"/>
<ellipse cx="160" cy="80" rx="200" ry="80" fill="url(#l1-glow)" opacity="0.5"/>

<!-- 远山 (友善的圆山) -->
<path d="M 0 130 L 50 110 L 110 120 L 170 105 L 230 115 L 290 105 L 320 110 L 320 240 L 0 240 Z" fill="#5a6a52" opacity="0.7"/>
<!-- 中山 -->
<path d="M 0 165 L 60 150 L 130 158 L 200 145 L 270 155 L 320 150 L 320 240 L 0 240 Z" fill="#3a4530" opacity="0.85"/>
<!-- 草地 -->
<path d="M 0 200 L 80 195 L 160 200 L 240 195 L 320 198 L 320 240 L 0 240 Z" fill="#2a3525"/>

<!-- Lin (大人) -->
<g>
  <ellipse cx="135" cy="218" rx="9" ry="2" fill="#000" opacity="0.4"/>
  <circle cx="135" cy="180" r="6" fill="#1a1714"/>
  <path d="M 134 186 L 134 203 L 130 215 L 132 215 L 135 204 L 138 215 L 140 215 L 136 203 L 136 186 Z" fill="#1a1714"/>
  <path d="M 134 192 L 127 199 L 128 200 L 135 194" fill="#1a1714"/>
  <path d="M 136 192 L 143 199 L 142 200 L 135 194" fill="#1a1714"/>
  <rect x="128" y="190" width="6" height="10" rx="2" fill="#3d3830"/>
  <text x="135" y="170" text-anchor="middle" fill="#1a1714" font-size="9px" font-family="'Inter', 'PingFang SC', sans-serif" font-weight="500">Lin</text>
</g>
<!-- 女儿 (小一点) -->
<g>
  <ellipse cx="158" cy="218" rx="6" ry="1.5" fill="#000" opacity="0.35"/>
  <circle cx="158" cy="192" r="4" fill="#1a1714"/>
  <path d="M 157.5 196 L 157.5 207 L 155 215 L 156 215 L 158 207.5 L 160 215 L 161 215 L 159 207 L 158.5 196 Z" fill="#1a1714"/>
  <text x="158" y="186" text-anchor="middle" fill="#1a1714" font-size="7px" font-family="'Inter', 'PingFang SC', sans-serif">女儿</text>
</g>
<!-- 飞鸟 -->
<path d="M 50 60 q 4 -3 8 0 q 4 -3 8 0" stroke="#1a1714" stroke-width="1.2" fill="none" opacity="0.5" stroke-linecap="round"/>
<path d="M 240 70 q 3 -2 6 0 q 3 -2 6 0" stroke="#1a1714" stroke-width="1.2" fill="none" opacity="0.5" stroke-linecap="round"/>
</svg>''')

# 帧 2: 山顶, 风, 笑
LIN_ART.append('''<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">
<defs>
  <linearGradient id="l2-bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#7aa090"/>
    <stop offset="40%" stop-color="#c8d8a8"/>
    <stop offset="80%" stop-color="#9aa078"/>
    <stop offset="100%" stop-color="#3a3530"/>
  </linearGradient>
  <radialGradient id="l2-sun" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0%" stop-color="#fff8e0" stop-opacity="0.85"/>
    <stop offset="100%" stop-color="#fff8e0" stop-opacity="0"/>
  </radialGradient>
</defs>
<rect width="320" height="240" fill="url(#l2-bg)"/>
<ellipse cx="240" cy="80" rx="150" ry="60" fill="url(#l2-sun)" opacity="0.6"/>
<circle cx="240" cy="80" r="18" fill="#fff5d0" opacity="0.85"/>
<circle cx="240" cy="80" r="26" fill="none" stroke="#fff5d0" stroke-width="0.5" opacity="0.4"/>

<!-- 远山 -->
<path d="M 0 100 L 50 75 L 110 90 L 170 70 L 230 85 L 290 75 L 320 80 L 320 240 L 0 240 Z" fill="#5a6a52" opacity="0.7"/>
<!-- 风线 -->
<g opacity="0.55" stroke="#e8e8c8" stroke-width="1" fill="none" stroke-linecap="round">
  <path d="M 30 130 q 18 -3 30 0 q -8 1 -14 2"/>
  <path d="M 40 145 q 22 -3 35 0"/>
  <path d="M 25 115 q 14 -2 24 0"/>
  <path d="M 200 110 q 18 -3 30 0"/>
</g>
<!-- 山顶平台 -->
<path d="M 0 200 Q 60 195 130 198 T 280 200 L 320 200 L 320 240 L 0 240 Z" fill="#2a3525"/>

<!-- Lin -->
<g>
  <ellipse cx="135" cy="208" rx="9" ry="2" fill="#000" opacity="0.4"/>
  <circle cx="135" cy="170" r="6" fill="#1a1714"/>
  <path d="M 134 176 L 134 193 L 130 205 L 132 205 L 135 194 L 138 205 L 140 205 L 136 193 L 136 176 Z" fill="#1a1714"/>
  <path d="M 134 182 L 127 189 L 128 190 L 135 184" fill="#1a1714"/>
  <path d="M 136 182 L 143 189 L 142 190 L 135 184" fill="#1a1714"/>
  <rect x="128" y="180" width="6" height="10" rx="2" fill="#3d3830"/>
</g>
<!-- 女儿 (笑, 张开手) -->
<g>
  <ellipse cx="170" cy="208" rx="6" ry="1.5" fill="#000" opacity="0.35"/>
  <circle cx="170" cy="186" r="4" fill="#1a1714"/>
  <path d="M 169.5 190 L 169.5 200 L 167 207 L 168 207 L 170 200.5 L 172 207 L 173 207 L 171 200 L 170.5 190 Z" fill="#1a1714"/>
  <!-- 张开的手 -->
  <path d="M 168 192 L 162 188 L 163 189 L 169 192" fill="#1a1714"/>
  <path d="M 172 192 L 178 188 L 177 189 L 171 192" fill="#1a1714"/>
  <!-- 开心的脸 -->
  <path d="M 168 184 q 2 1.5 4 0" stroke="#fff" stroke-width="0.6" fill="none"/>
</g>
</svg>''')

# 帧 3: Lin 录音 + AR mark + 私人锁
LIN_ART.append('''<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">
<defs>
  <linearGradient id="l3-bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#7aa090"/>
    <stop offset="50%" stop-color="#c0d0a0"/>
    <stop offset="100%" stop-color="#3a3530"/>
  </linearGradient>
  <radialGradient id="l3-mark" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0%" stop-color="#4ade80" stop-opacity="0.55"/>
    <stop offset="100%" stop-color="#4ade80" stop-opacity="0"/>
  </radialGradient>
</defs>
<rect width="320" height="240" fill="url(#l3-bg)"/>
<path d="M 0 100 L 50 75 L 110 90 L 170 70 L 230 85 L 290 75 L 320 80 L 320 240 L 0 240 Z" fill="#5a6a52" opacity="0.7"/>
<path d="M 0 200 Q 60 195 130 198 T 280 200 L 320 200 L 320 240 L 0 240 Z" fill="#2a3525"/>

<!-- Lin 蹲下录音 -->
<g transform="translate(140 195)">
  <ellipse cx="0" cy="15" rx="10" ry="2" fill="#000" opacity="0.4"/>
  <circle cx="0" cy="-10" r="6" fill="#1a1714"/>
  <path d="M -1 -4 L -1 4 L -6 12 L -4 13 L 0 5 L 4 13 L 6 12 L 1 4 L 1 -4 Z" fill="#1a1714"/>
  <path d="M 1 0 L 12 -2 L 12 0 L 0 1" fill="#1a1714"/>
  <rect x="-7" y="-3" width="6" height="8" rx="2" fill="#3d3830"/>
</g>
<!-- 手机 (录音) -->
<g transform="translate(155 185)">
  <rect x="-4" y="-8" width="10" height="16" rx="2" fill="#212638" stroke="#b0b6cc" stroke-width="0.8"/>
  <circle cx="1" cy="-2" r="1.5" fill="#4ade80"/>
  <path d="M 8 -4 Q 11 0 8 4" stroke="#4ade80" stroke-width="1" fill="none"/>
  <path d="M 11 -7 Q 16 0 11 7" stroke="#4ade80" stroke-width="1" fill="none"/>
</g>

<!-- AR Mark (绿色,私人) -->
<ellipse cx="220" cy="195" rx="34" ry="11" fill="url(#l3-mark)"/>
<g transform="translate(220 195)">
  <ellipse cx="0" cy="2" rx="11" ry="2.5" fill="#000" opacity="0.4"/>
  <path d="M -10 -1 Q -8 -6 0 -5 Q 10 -6 11 -1 Q 8 3 0 3 Q -8 3 -10 -1 Z" fill="#4ade80" opacity="0.85"/>
  <path d="M -8 -8 Q -6 -12 0 -11 Q 7 -12 8 -8 Q 5 -5 0 -5 Q -5 -5 -8 -8 Z" fill="#4ade80" opacity="0.82"/>
  <path d="M -5 -15 Q -4 -18 0 -17 Q 5 -18 5 -15 Q 4 -13 0 -12 Q -4 -13 -5 -15 Z" fill="#4ade80" opacity="0.78"/>
</g>
<!-- 私人锁 -->
<g transform="translate(245 175)">
  <rect x="-6" y="-2" width="12" height="9" rx="1.5" fill="#4ade80" opacity="0.9"/>
  <path d="M -3 -2 L -3 -5 a 3 3 0 0 1 6 0 L 3 -2" fill="none" stroke="#4ade80" stroke-width="1.5"/>
</g>
<!-- 权限 chip -->
<g transform="translate(220 222)">
  <rect x="-44" y="-8" width="88" height="16" rx="8" fill="#1a1714" stroke="#3d3830" stroke-width="0.8"/>
  <text x="-30" y="3" text-anchor="middle" fill="#9a9080" font-size="8px" font-family="'Inter', 'PingFang SC', sans-serif">自己</text>
  <text x="0" y="3" text-anchor="middle" fill="#9a9080" font-size="8px" font-family="'Inter', 'PingFang SC', sans-serif">朋友</text>
  <rect x="14" y="-7" width="36" height="14" rx="7" fill="#4ade80" opacity="0.9"/>
  <text x="32" y="3" text-anchor="middle" fill="#1a1714" font-size="8px" font-family="'Inter', 'PingFang SC', sans-serif" font-weight="600">私人</text>
</g>
</svg>''')

# 帧 4: 3 年后 - mark 还在
LIN_ART.append('''<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">
<defs>
  <linearGradient id="l4-bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#5a8a90"/>
    <stop offset="40%" stop-color="#a8c8b8"/>
    <stop offset="80%" stop-color="#9aa088"/>
    <stop offset="100%" stop-color="#3a3530"/>
  </linearGradient>
  <radialGradient id="l4-mark" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0%" stop-color="#4ade80" stop-opacity="0.5"/>
    <stop offset="100%" stop-color="#4ade80" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="l4-pulse" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0%" stop-color="#4ade80" stop-opacity="0"/>
    <stop offset="80%" stop-color="#4ade80" stop-opacity="0.3"/>
    <stop offset="100%" stop-color="#4ade80" stop-opacity="0"/>
  </radialGradient>
</defs>
<rect width="320" height="240" fill="url(#l4-bg)"/>
<path d="M 0 100 L 50 75 L 110 90 L 170 70 L 230 85 L 290 75 L 320 80 L 320 240 L 0 240 Z" fill="#5a6a52" opacity="0.7"/>
<path d="M 0 200 Q 60 195 130 198 T 280 200 L 320 200 L 320 240 L 0 240 Z" fill="#2a3525"/>

<!-- mark 在原地 (有脉冲动感) -->
<ellipse cx="160" cy="195" rx="60" ry="20" fill="url(#l4-pulse)"/>
<ellipse cx="160" cy="195" rx="34" ry="11" fill="url(#l4-mark)"/>
<g transform="translate(160 195)">
  <ellipse cx="0" cy="2" rx="11" ry="2.5" fill="#000" opacity="0.4"/>
  <path d="M -10 -1 Q -8 -6 0 -5 Q 10 -6 11 -1 Q 8 3 0 3 Q -8 3 -10 -1 Z" fill="#4ade80" opacity="0.9"/>
  <path d="M -8 -8 Q -6 -12 0 -11 Q 7 -12 8 -8 Q 5 -5 0 -5 Q -5 -5 -8 -8 Z" fill="#4ade80" opacity="0.85"/>
  <path d="M -5 -15 Q -4 -18 0 -17 Q 5 -18 5 -15 Q 4 -13 0 -12 Q -4 -13 -5 -15 Z" fill="#4ade80" opacity="0.8"/>
</g>
<!-- 笑脸图标 (mark 上方) -->
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

# Sarah: 雨, 第一次, 紧张感 - 蓝灰冷调
SARAH_ART = []

# 帧 1: Sarah 在车前看 AllTrails 4 星
SARAH_ART.append('''<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">
<defs>
  <linearGradient id="s1-bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#3a4555"/>
    <stop offset="50%" stop-color="#5a6878"/>
    <stop offset="100%" stop-color="#1f1d28"/>
  </linearGradient>
</defs>
<rect width="320" height="240" fill="url(#s1-bg)"/>
<!-- 远山 -->
<path d="M 0 100 L 50 75 L 110 90 L 170 70 L 230 85 L 290 75 L 320 80 L 320 240 L 0 240 Z" fill="#2a3545" opacity="0.85"/>
<path d="M 0 145 L 70 125 L 140 138 L 210 115 L 280 130 L 320 125 L 320 240 L 0 240 Z" fill="#3a4555" opacity="0.8"/>
<path d="M 0 195 L 80 185 L 160 195 L 240 180 L 320 190 L 320 240 L 0 240 Z" fill="#1a1d28"/>

<!-- 车 -->
<g transform="translate(80 195)">
  <ellipse cx="0" cy="14" rx="25" ry="2" fill="#000" opacity="0.4"/>
  <path d="M -22 5 L -16 -4 L 16 -4 L 22 5 L 22 12 L -22 12 Z" fill="#5a6878" opacity="0.85"/>
  <path d="M -14 -4 L -10 -10 L 10 -10 L 14 -4 Z" fill="#3a4555" opacity="0.85"/>
  <circle cx="-13" cy="12" r="3" fill="#1a1714"/>
  <circle cx="13" cy="12" r="3" fill="#1a1714"/>
</g>
<!-- Sarah 站着拿着手机 -->
<g>
  <ellipse cx="170" cy="218" rx="9" ry="2" fill="#000" opacity="0.4"/>
  <circle cx="170" cy="180" r="6" fill="#1a1714"/>
  <path d="M 169 186 L 169 203 L 165 215 L 167 215 L 170 204 L 173 215 L 175 215 L 171 203 L 171 186 Z" fill="#1a1714"/>
  <path d="M 169 192 L 162 199 L 163 200 L 170 194" fill="#1a1714"/>
  <path d="M 171 192 L 178 199 L 177 200 L 170 194" fill="#1a1714"/>
  <rect x="163" y="190" width="6" height="10" rx="2" fill="#3d3830"/>
  <text x="170" y="170" text-anchor="middle" fill="#e4e8f4" font-size="9px" font-family="'Inter', 'PingFang SC', sans-serif" font-weight="500">Sarah</text>
</g>
<!-- 手机界面 (AllTrails 4星) -->
<g transform="translate(225 145)">
  <rect x="-15" y="-30" width="50" height="80" rx="6" fill="#212638" stroke="#b0b6cc" stroke-width="0.8"/>
  <rect x="-12" y="-25" width="44" height="70" rx="3" fill="#1a1d28" stroke="#3d3830" stroke-width="0.5"/>
  <text x="10" y="-12" text-anchor="middle" fill="#38bdf8" font-size="7px" font-family="'Inter', sans-serif" font-weight="600">AllTrails</text>
  <text x="10" y="6" text-anchor="middle" fill="#fbbf24" font-size="13px">★★★★</text>
  <text x="10" y="22" text-anchor="middle" fill="#9a9080" font-size="6px">中等难度</text>
  <text x="10" y="36" text-anchor="middle" fill="#4ade80" font-size="6px">已 lookup</text>
</g>
</svg>''')

# 帧 2: Tararua 雨变天 (Sarah 还在路上 远小)
SARAH_ART.append('''<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">
<defs>
  <linearGradient id="s2-bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#252835"/>
    <stop offset="40%" stop-color="#3a4055"/>
    <stop offset="80%" stop-color="#5a6075"/>
    <stop offset="100%" stop-color="#1a1d28"/>
  </linearGradient>
</defs>
<rect width="320" height="240" fill="url(#s2-bg)"/>
<!-- 乌云 (用模糊深色) -->
<g opacity="0.85">
  <ellipse cx="80" cy="55" rx="55" ry="18" fill="#2a2c38"/>
  <ellipse cx="180" cy="50" rx="65" ry="20" fill="#1a1d28"/>
  <ellipse cx="260" cy="60" rx="50" ry="16" fill="#2a2c38"/>
</g>
<!-- 远山 -->
<path d="M 0 105 L 60 80 L 130 95 L 200 70 L 280 90 L 320 85 L 320 240 L 0 240 Z" fill="#3a3a48" opacity="0.85"/>
<path d="M 0 175 L 80 165 L 160 175 L 240 160 L 320 170 L 320 240 L 0 240 Z" fill="#1a1d28"/>

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

<!-- 步道 -->
<path d="M 50 230 Q 100 200 140 195 T 220 170" stroke="#a0b8d0" stroke-width="1.4" fill="none" opacity="0.6" stroke-linecap="round"/>
<!-- Sarah 很小 在路上 -->
<g>
  <ellipse cx="150" cy="190" rx="4" ry="1.5" fill="#000" opacity="0.4"/>
  <circle cx="150" cy="178" r="3" fill="#1a1714"/>
  <path d="M 149.5 181 L 149.5 188 L 148 192 L 148.5 192 L 150 188.5 L 151.5 192 L 152 192 L 150.5 188 L 150.5 181 Z" fill="#1a1714"/>
  <rect x="147.5" y="183" width="2.5" height="5" rx="0.8" fill="#3d3830"/>
</g>
</svg>''')

# 帧 3: 雨 + 岔路口 + 看 mark
SARAH_ART.append('''<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">
<defs>
  <linearGradient id="s3-bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#2a2c35"/>
    <stop offset="50%" stop-color="#4a5260"/>
    <stop offset="100%" stop-color="#1a1d28"/>
  </linearGradient>
  <radialGradient id="s3-mark" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.55"/>
    <stop offset="100%" stop-color="#38bdf8" stop-opacity="0"/>
  </radialGradient>
</defs>
<rect width="320" height="240" fill="url(#s3-bg)"/>
<path d="M 0 100 L 60 80 L 130 95 L 200 70 L 280 90 L 320 85 L 320 240 L 0 240 Z" fill="#3a3a48" opacity="0.85"/>
<path d="M 0 175 L 80 165 L 160 175 L 240 160 L 320 170 L 320 240 L 0 240 Z" fill="#1a1d28"/>

<!-- 雨 -->
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

<!-- 岔路 -->
<path d="M 30 230 Q 100 195 130 188" stroke="#38bdf8" stroke-width="1.4" fill="none" opacity="0.7" stroke-linecap="round"/>
<path d="M 130 188 Q 170 170 210 145" stroke="#3d3830" stroke-width="1.2" fill="none" opacity="0.5" stroke-linecap="round" stroke-dasharray="4 3"/>
<path d="M 130 188 Q 180 195 240 195" stroke="#38bdf8" stroke-width="1.2" fill="none" opacity="0.65" stroke-linecap="round"/>

<!-- Sarah 蹲下看 mark -->
<g transform="translate(130 188)">
  <ellipse cx="0" cy="15" rx="10" ry="2" fill="#000" opacity="0.4"/>
  <circle cx="0" cy="-10" r="6" fill="#1a1714"/>
  <path d="M -1 -4 L -1 4 L -6 12 L -4 13 L 0 5 L 4 13 L 6 12 L 1 4 L 1 -4 Z" fill="#1a1714"/>
  <path d="M 1 0 L 12 -2 L 12 0 L 0 1" fill="#1a1714"/>
  <rect x="-7" y="-3" width="6" height="8" rx="2" fill="#3d3830"/>
</g>

<!-- AR mark (前人留的, 蓝色) -->
<ellipse cx="200" cy="175" rx="40" ry="13" fill="url(#s3-mark)"/>
<g transform="translate(200 175)">
  <ellipse cx="0" cy="2" rx="14" ry="3" fill="#000" opacity="0.4"/>
  <path d="M -13 -1 Q -11 -7 0 -6 Q 13 -7 14 -1 Q 11 4 0 4 Q -10 4 -13 -1 Z" fill="#38bdf8" opacity="0.92"/>
  <path d="M -10 -10 Q -8 -15 0 -14 Q 9 -15 10 -10 Q 7 -6 0 -6 Q -7 -6 -10 -10 Z" fill="#38bdf8" opacity="0.88"/>
  <path d="M -7 -19 Q -5 -23 0 -22 Q 6 -23 7 -19 Q 5 -16 0 -15 Q -5 -16 -7 -19 Z" fill="#38bdf8" opacity="0.85"/>
  <path d="M -4 -26 Q -3 -28 0 -28 Q 3 -28 4 -26 Q 3 -24 0 -24 Q -3 -24 -4 -26 Z" fill="#38bdf8" opacity="0.82"/>
</g>

<!-- 气泡 -->
<g transform="translate(160 105)">
  <rect x="0" y="0" width="130" height="26" rx="6" fill="#1a1714" stroke="#38bdf8" stroke-width="1.2"/>
  <text x="65" y="17" text-anchor="middle" fill="#e4e8f4" font-size="11px" font-family="'Inter', 'PingFang SC', sans-serif">雨季是河 走左边</text>
  <path d="M 38 26 L 35 34 L 45 26 Z" fill="#1a1714" stroke="#38bdf8" stroke-width="1.2"/>
</g>
</svg>''')

# 帧 4: 回到车 留 mark
SARAH_ART.append('''<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">
<defs>
  <linearGradient id="s4-bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#3a4555"/>
    <stop offset="50%" stop-color="#6a7a8a"/>
    <stop offset="100%" stop-color="#1f1d28"/>
  </linearGradient>
</defs>
<rect width="320" height="240" fill="url(#s4-bg)"/>
<path d="M 0 100 L 60 75 L 130 90 L 200 65 L 280 85 L 320 80 L 320 240 L 0 240 Z" fill="#3a3a48" opacity="0.85"/>
<path d="M 0 175 L 80 165 L 160 175 L 240 160 L 320 170 L 320 240 L 0 240 Z" fill="#1a1d28"/>

<!-- 车 -->
<g transform="translate(180 195)">
  <ellipse cx="0" cy="14" rx="25" ry="2" fill="#000" opacity="0.4"/>
  <path d="M -22 5 L -16 -4 L 16 -4 L 22 5 L 22 12 L -22 12 Z" fill="#5a6878" opacity="0.85"/>
  <path d="M -14 -4 L -10 -10 L 10 -10 L 14 -4 Z" fill="#3a4555" opacity="0.85"/>
  <circle cx="-13" cy="12" r="3" fill="#1a1714"/>
  <circle cx="13" cy="12" r="3" fill="#1a1714"/>
</g>

<!-- Sarah 站着 -->
<g>
  <ellipse cx="100" cy="218" rx="9" ry="2" fill="#000" opacity="0.4"/>
  <circle cx="100" cy="180" r="6" fill="#1a1714"/>
  <path d="M 99 186 L 99 203 L 95 215 L 97 215 L 100 204 L 103 215 L 105 215 L 101 203 L 101 186 Z" fill="#1a1714"/>
  <path d="M 99 192 L 92 199 L 93 200 L 100 194" fill="#1a1714"/>
  <path d="M 101 192 L 108 199 L 107 200 L 100 194" fill="#1a1714"/>
  <rect x="93" y="190" width="6" height="10" rx="2" fill="#3d3830"/>
</g>

<!-- 大手机 显示她留的 mark -->
<g transform="translate(170 145)">
  <rect x="-18" y="-32" width="36" height="56" rx="6" fill="#212638" stroke="#b0b6cc" stroke-width="1"/>
  <rect x="-15" y="-28" width="30" height="48" rx="3" fill="#1a1d28"/>
  <text x="0" y="-15" text-anchor="middle" fill="#38bdf8" font-size="7px" font-family="'Inter', sans-serif" font-weight="600">公开</text>
  <text x="0" y="-2" text-anchor="middle" fill="#e4e8f4" font-size="7px" font-family="'Inter', 'PingFang SC', sans-serif">下午 3 点</text>
  <text x="0" y="9" text-anchor="middle" fill="#e4e8f4" font-size="7px" font-family="'Inter', 'PingFang SC', sans-serif">开始下雨</text>
  <text x="0" y="20" text-anchor="middle" fill="#9a9080" font-size="6px" font-family="'Inter', 'PingFang SC', sans-serif">1 点前下来</text>
</g>

<!-- 权限 chip -->
<g transform="translate(180 220)">
  <rect x="-44" y="-8" width="88" height="16" rx="8" fill="#1a1714" stroke="#3d3830" stroke-width="0.8"/>
  <text x="-30" y="3" text-anchor="middle" fill="#9a9080" font-size="8px" font-family="'Inter', 'PingFang SC', sans-serif">自己</text>
  <text x="0" y="3" text-anchor="middle" fill="#9a9080" font-size="8px" font-family="'Inter', 'PingFang SC', sans-serif">朋友</text>
  <rect x="14" y="-7" width="36" height="14" rx="7" fill="#38bdf8" opacity="0.9"/>
  <text x="32" y="3" text-anchor="middle" fill="#1a1714" font-size="8px" font-family="'Inter', 'PingFang SC', sans-serif" font-weight="600">公开</text>
</g>
</svg>''')


def to_js(arr):
    out = []
    for s in arr:
        safe = s.replace("`", "\\`").replace("${", "\\${")
        out.append(f"      `{safe}`,")
    return "\n".join(out)

with open('C:/ClaudeCodeProjects/Cairn/research/murray_v2.js','w',encoding='utf-8') as f:
    f.write(to_js(MURRAY_ART))
with open('C:/ClaudeCodeProjects/Cairn/research/lin_v2.js','w',encoding='utf-8') as f:
    f.write(to_js(LIN_ART))
with open('C:/ClaudeCodeProjects/Cairn/research/sarah_v2.js','w',encoding='utf-8') as f:
    f.write(to_js(SARAH_ART))
print('OK 3 cards')
