      `<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">
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
</svg>`,
      `<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">
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
</svg>`,
      `<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">
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
</svg>`,
      `<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">
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
</svg>`,