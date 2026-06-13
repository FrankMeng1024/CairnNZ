      `<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">
<defs>
  <linearGradient id="j1-bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#d3c1a8" stop-opacity="0.4"/>
    <stop offset="60%" stop-color="var(--surface2)"/>
    <stop offset="100%" stop-color="var(--surface)"/>
  </linearGradient>
  <radialGradient id="j1-sun" cx="0.5" cy="0.5">
    <stop offset="0%" stop-color="#f0c089" stop-opacity="0.9"/>
    <stop offset="100%" stop-color="#f0c089" stop-opacity="0"/>
  </radialGradient>
</defs>
<rect width="320" height="240" fill="url(#j1-bg)"/>
<!-- 远山三层 -->
<path d="M 0 100 L 60 70 L 130 88 L 200 60 L 280 80 L 320 75 L 320 240 L 0 240 Z" class="pain-shape-far"/>
<path d="M 0 145 L 70 125 L 140 138 L 210 115 L 280 130 L 320 125 L 320 240 L 0 240 Z" class="pain-shape-mid"/>
<path d="M 0 185 L 80 175 L 160 185 L 240 170 L 320 180 L 320 240 L 0 240 Z" class="pain-shape-near"/>
<!-- 朝阳光晕 -->
<circle cx="260" cy="60" r="50" fill="url(#j1-sun)"/>
<circle cx="260" cy="60" r="14" fill="#f0c089" opacity="0.85"/>
<!-- 路 (蜿蜒进山) -->
<path d="M 100 240 Q 130 220 145 200 T 170 165 T 200 130" class="pain-trail-walked" stroke-width="1.6"/>
<path d="M 130 240 Q 155 220 170 200 T 195 165 T 220 130" class="pain-trail-walked" stroke-width="1.6" opacity="0.5"/>
<!-- 飞鸟 -->
<path d="M 50 50 q 4 -3 8 0 q 4 -3 8 0" class="pain-bird"/>
<path d="M 90 65 q 3 -2 6 0 q 3 -2 6 0" class="pain-bird"/>
<!-- Jamie (脚下, 朝阳里出发) -->
<g>
  <ellipse cx="115" cy="218" rx="9" ry="2" class="pain-shadow"/>
  <circle cx="115" cy="180" r="6" class="pain-figure"/>
  <path d="M 114 186 L 114 203 L 110 215 L 112 215 L 115 204 L 118 215 L 120 215 L 116 203 L 116 186 Z" class="pain-figure"/>
  <path d="M 114 192 L 107 199 L 108 200 L 115 194" class="pain-figure"/>
  <path d="M 116 192 L 123 199 L 122 200 L 115 194" class="pain-figure"/>
  <rect x="108" y="190" width="6" height="10" rx="2" class="pain-pack"/>
  <text x="115" y="170" text-anchor="middle" class="pain-figure-name">Jamie</text>
</g>
</svg>`,
      `<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">
<defs>
  <linearGradient id="j2-bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#9c8068" stop-opacity="0.5"/>
    <stop offset="40%" stop-color="#d4a575" stop-opacity="0.45"/>
    <stop offset="100%" stop-color="var(--surface)"/>
  </linearGradient>
  <radialGradient id="j2-sun" cx="0.5" cy="0.5">
    <stop offset="0%" stop-color="#f5a35c" stop-opacity="0.9"/>
    <stop offset="100%" stop-color="#f5a35c" stop-opacity="0"/>
  </radialGradient>
</defs>
<rect width="320" height="240" fill="url(#j2-bg)"/>
<!-- 远山 (深些) -->
<path d="M 0 95 L 60 65 L 130 85 L 200 55 L 280 75 L 320 70 L 320 240 L 0 240 Z" class="pain-shape-far" opacity="0.65"/>
<path d="M 0 140 L 70 115 L 140 130 L 210 105 L 280 125 L 320 120 L 320 240 L 0 240 Z" class="pain-shape-mid" opacity="0.85"/>
<!-- 山脊路 (在山脊线上) -->
<path d="M 0 175 Q 80 165 160 175 T 320 170" class="pain-shape-near"/>
<!-- 落日 -->
<circle cx="130" cy="130" r="55" fill="url(#j2-sun)"/>
<circle cx="130" cy="130" r="16" fill="#f0a55c" opacity="0.95"/>
<!-- Jamie 很小, 走在山脊上 (远) -->
<g>
  <ellipse cx="200" cy="180" rx="4" ry="1.5" class="pain-shadow"/>
  <circle cx="200" cy="167" r="3" class="pain-figure"/>
  <path d="M 199.5 170 L 199.5 178 L 198 183 L 198.5 183 L 200 178.5 L 201.5 183 L 202 183 L 200.5 178 L 200.5 170 Z" class="pain-figure"/>
  <rect x="197" y="172" width="2.5" height="5" rx="0.8" class="pain-pack"/>
</g>
<!-- 飞鸟 -->
<path d="M 60 50 q 4 -3 8 0 q 4 -3 8 0" class="pain-bird" opacity="0.7"/>
<path d="M 230 60 q 3 -2 6 0 q 3 -2 6 0" class="pain-bird" opacity="0.7"/>
</svg>`,
      `<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">
<defs>
  <linearGradient id="j3-bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#9c7558" stop-opacity="0.5"/>
    <stop offset="50%" stop-color="#e6b380" stop-opacity="0.4"/>
    <stop offset="100%" stop-color="var(--surface)"/>
  </linearGradient>
  <radialGradient id="j3-glow" cx="0.5" cy="0.5">
    <stop offset="0%" stop-color="#f0a55c" stop-opacity="0.6"/>
    <stop offset="100%" stop-color="#f0a55c" stop-opacity="0"/>
  </radialGradient>
</defs>
<rect width="320" height="240" fill="url(#j3-bg)"/>
<!-- 远山 -->
<path d="M 0 100 L 60 70 L 130 90 L 200 60 L 280 80 L 320 75 L 320 240 L 0 240 Z" class="pain-shape-mid"/>
<path d="M 0 175 L 80 165 L 160 175 L 240 160 L 320 170 L 320 240 L 0 240 Z" class="pain-shape-near"/>
<!-- 落日 (远处) -->
<circle cx="270" cy="100" r="40" fill="url(#j3-glow)"/>
<circle cx="270" cy="100" r="13" fill="#f0a55c" opacity="0.85"/>
<!-- 步道 -->
<path d="M 30 230 Q 100 195 170 175 T 280 145" class="pain-trail-walked"/>
<!-- Jamie 蹲下来 -->
<g transform="translate(135 175)">
  <ellipse cx="0" cy="15" rx="10" ry="2" class="pain-shadow"/>
  <circle cx="0" cy="-10" r="6" class="pain-figure"/>
  <path d="M -1 -4 L -1 4 L -6 12 L -4 13 L 0 5 L 4 13 L 6 12 L 1 4 L 1 -4 Z" class="pain-figure"/>
  <path d="M 1 0 L 12 -2 L 12 0 L 0 1" class="pain-figure"/>
  <path d="M -1 0 L -8 -1 L -8 1 L 0 1" class="pain-figure"/>
  <rect x="-7" y="-3" width="6" height="8" rx="2" class="pain-pack"/>
</g>
<!-- AR 石堆 (温暖橘色调) -->
<ellipse cx="220" cy="170" rx="40" ry="13" fill="url(#j3-glow)"/>
<g transform="translate(220 170)">
  <ellipse cx="0" cy="2" rx="14" ry="3" class="pain-stone-shadow"/>
  <path d="M -13 -1 Q -11 -7 0 -6 Q 13 -7 14 -1 Q 11 4 0 4 Q -10 4 -13 -1 Z" fill="#f0a55c" opacity="0.85"/>
  <path d="M -10 -10 Q -8 -15 0 -14 Q 9 -15 10 -10 Q 7 -6 0 -6 Q -7 -6 -10 -10 Z" fill="#f0a55c" opacity="0.85"/>
  <path d="M -7 -19 Q -5 -23 0 -22 Q 6 -23 7 -19 Q 5 -16 0 -15 Q -5 -16 -7 -19 Z" fill="#f0a55c" opacity="0.85"/>
  <path d="M -4 -26 Q -3 -28 0 -28 Q 3 -28 4 -26 Q 3 -24 0 -24 Q -3 -24 -4 -26 Z" fill="#f0a55c" opacity="0.85"/>
</g>
<!-- 文字气泡 (暖橘色) -->
<g transform="translate(178 102)">
  <rect x="0" y="0" width="124" height="32" rx="5" fill="var(--surface)" stroke="#f0a55c" stroke-width="1.2"/>
  <text x="62" y="13" text-anchor="middle" class="pain-bubble-text">这里很安全</text>
  <text x="62" y="26" text-anchor="middle" class="pain-bubble-text">日落很美</text>
  <path d="M 35 32 L 32 40 L 42 32 Z" fill="var(--surface)" stroke="#f0a55c" stroke-width="1.2"/>
</g>
<!-- 振动手机 -->
<g transform="translate(150 162)">
  <rect x="-4" y="-8" width="10" height="16" rx="2" class="pain-phone-mini"/>
  <path d="M 8 -4 Q 11 0 8 4" stroke="#f0a55c" stroke-width="1" fill="none"/>
  <path d="M 11 -7 Q 16 0 11 7" stroke="#f0a55c" stroke-width="1" fill="none"/>
</g>
</svg>`,
      `<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet" class="pain-svg">
<defs>
  <linearGradient id="j4-bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#a08570" stop-opacity="0.5"/>
    <stop offset="50%" stop-color="#cda47e" stop-opacity="0.35"/>
    <stop offset="100%" stop-color="var(--surface)"/>
  </linearGradient>
  <linearGradient id="j4-sea" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#7a9caa" stop-opacity="0.55"/>
    <stop offset="100%" stop-color="#a8bcc6" stop-opacity="0.35"/>
  </linearGradient>
  <radialGradient id="j4-glow" cx="0.5" cy="0.5">
    <stop offset="0%" stop-color="var(--persona-c)" stop-opacity="0.5"/>
    <stop offset="100%" stop-color="var(--persona-c)" stop-opacity="0"/>
  </radialGradient>
</defs>
<rect width="320" height="240" fill="url(#j4-bg)"/>
<!-- 海 -->
<rect x="0" y="115" width="320" height="60" fill="url(#j4-sea)"/>
<!-- 海平面波纹 -->
<path d="M 0 130 q 30 -2 60 0 t 120 0 t 120 0" class="pain-trail-walked" stroke-width="0.6" opacity="0.5"/>
<path d="M 0 145 q 25 -2 50 0 t 100 0 t 100 0 t 100 0" class="pain-trail-walked" stroke-width="0.6" opacity="0.4"/>
<!-- 远岸 -->
<path d="M 0 110 L 80 105 L 160 112 L 240 100 L 320 108 L 320 130 L 0 130 Z" class="pain-shape-far"/>
<!-- 海岸悬崖 -->
<path d="M 0 175 L 80 168 L 160 178 L 240 165 L 320 175 L 320 240 L 0 240 Z" class="pain-shape-near"/>
<!-- 落日光路 -->
<circle cx="240" cy="105" r="30" fill="#f0a55c" opacity="0.4"/>
<circle cx="240" cy="105" r="9" fill="#f0a55c" opacity="0.85"/>
<path d="M 220 130 L 230 140 L 250 140 L 260 130 Z" fill="#f0a55c" opacity="0.25"/>
<!-- Jamie 站在悬崖边看海 -->
<g>
  <ellipse cx="125" cy="208" rx="9" ry="2" class="pain-shadow"/>
  <circle cx="125" cy="170" r="6" class="pain-figure"/>
  <path d="M 124 176 L 124 193 L 120 205 L 122 205 L 125 194 L 128 205 L 130 205 L 126 193 L 126 176 Z" class="pain-figure"/>
  <path d="M 124 182 L 117 189 L 118 190 L 125 184" class="pain-figure"/>
  <path d="M 126 182 L 133 189 L 132 190 L 125 184" class="pain-figure"/>
  <rect x="118" y="180" width="6" height="10" rx="2" class="pain-pack"/>
</g>
<!-- 自己留的 mark (绿色调, 给后人) -->
<ellipse cx="185" cy="185" rx="32" ry="10" fill="url(#j4-glow)"/>
<g transform="translate(185 185)">
  <ellipse cx="0" cy="2" rx="11" ry="2.5" class="pain-stone-shadow"/>
  <path d="M -10 -1 Q -8 -6 0 -5 Q 10 -6 11 -1 Q 8 3 0 3 Q -8 3 -10 -1 Z" class="pain-stone-self"/>
  <path d="M -8 -8 Q -6 -12 0 -11 Q 7 -12 8 -8 Q 5 -5 0 -5 Q -5 -5 -8 -8 Z" class="pain-stone-self"/>
  <path d="M -5 -15 Q -4 -18 0 -17 Q 5 -18 5 -15 Q 4 -13 0 -12 Q -4 -13 -5 -15 Z" class="pain-stone-self"/>
</g>
<!-- 飞鸟 -->
<path d="M 80 65 q 4 -3 8 0 q 4 -3 8 0" class="pain-bird"/>
<path d="M 280 80 q 3 -2 6 0 q 3 -2 6 0" class="pain-bird"/>
<!-- 权限 chip (右下) -->
<g transform="translate(180 220)">
  <rect x="-44" y="-8" width="88" height="16" rx="8" class="pain-perm-bg"/>
  <text x="-30" y="3" text-anchor="middle" class="pain-perm-label">自己</text>
  <text x="0" y="3" text-anchor="middle" class="pain-perm-label">朋友</text>
  <rect x="14" y="-7" width="36" height="14" rx="7" class="pain-perm-active" fill="var(--persona-c)"/>
  <text x="32" y="3" text-anchor="middle" class="pain-perm-label-active">路过的人</text>
</g>
</svg>`,