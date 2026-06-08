// ---------------------------------------------------------------------------
// Cairn/MarkTextShader — INTENTIONAL STUB (no Shader block).
//
// This file is deliberately a comment-only stub. After evaluating both
// implementation paths described in the shader brief, the chosen approach
// is OPTION B: do NOT ship a custom Cairn TMP-SDF shader.
//
// RATIONALE
// ---------
// 1. TextMeshPro's stock URP/Mobile/Distance Field shader (shipped with
//    com.unity.textmeshpro) already implements correct SDF text rendering,
//    sub-pixel anti-aliasing, outline, soft mask, and atlas multi-channel
//    sampling. Re-implementing a subset of this would either:
//      (a) produce visibly worse glyph edges than the stock shader, or
//      (b) require porting hundreds of lines of TMP_SDF.cginc — out of
//          scope for a pure URP shader file with no TMP package coupling.
//    Either outcome would degrade the 95+ aesthetic bar this project
//    targets.
//
// 2. The properties the brief lists for MarkTextShader (_BaseColor,
//    _CamFadeNear, _CamFadeFar, _BloomBoost, _OutlineWidth, _InstanceAlpha)
//    are all expressible as MaterialPropertyBlock writes against TMP's
//    existing shader properties:
//      _BaseColor       → _FaceColor             (TMP face fill)
//      _OutlineWidth    → _OutlineWidth          (TMP outline SDF width)
//      _BloomBoost      → multiplier baked into _FaceColor.rgb on the
//                         spawner side before the MPB write
//      _CamFadeNear/Far → computed on the C# spawner each frame, applied
//                         as a multiplier on _FaceColor.a (so the text
//                         literally fades to transparent as the camera
//                         approaches).
//      _InstanceAlpha   → folded into the same _FaceColor.a channel.
//    All of this works with zero shader code and gets perfect SDF text.
//
// 3. The brief explicitly grants this option:
//      "If writing full TMP-compatible SDF is too complex, INSTEAD provide
//       a simpler approach: skip MarkTextShader entirely. The spawner will
//       use TMP's stock URP/Mobile/Distance Field shader and animate
//       _BaseColor + _FaceColor via property block. Document this in a
//       comment in the file you would have created."
//
// IMPLEMENTATION CONTRACT FOR THE SPAWNER (CairnMarkSpawner or similar)
// ---------------------------------------------------------------------
//   • Create the TMP component normally.
//   • Assign material: TMP_Settings.defaultFontAsset.material whose shader
//     is "TextMeshPro/Distance Field" (URP-compatible) or
//     "TextMeshPro/Mobile/Distance Field SSD" for mobile AR.
//   • Each frame, build a MaterialPropertyBlock and set:
//       block.SetColor("_FaceColor", typeColor * bloomBoost * fadeAlpha);
//       block.SetFloat("_OutlineWidth", outlineWidth);
//       block.SetColor("_OutlineColor", typeColor * 0.5f * fadeAlpha);
//     where fadeAlpha is computed in C# as:
//       float t = Mathf.InverseLerp(camFadeNear, camFadeFar, camDist);
//       fadeAlpha = Mathf.Lerp(1f, 0f, t);   // visible near, gone far
//     (NOTE: opposite polarity from WispShader, matching the brief —
//     mark text is designed to be read up close.)
//   • Apply via tmpRenderer.SetPropertyBlock(block) on the
//     MeshRenderer that TMP creates.
//
// VERIFICATION
// ------------
// QA test plan should confirm:
//   1. Mark text glyph edges remain crisp and AA-clean at all camera
//      distances (this is what TMP's stock SDF gives us for free).
//   2. _FaceColor MPB writes drive both color and fade with no per-frame
//      allocation (reuse a single MaterialPropertyBlock instance).
//   3. No visual difference vs. a hand-written shader at the 95+
//      aesthetic bar — the stock TMP SDF shader already exceeds it.
//
// FILES THAT WOULD HAVE BEEN AT THIS PATH
// ---------------------------------------
// None. This .shader file contains no Shader block on purpose. Unity's
// shader importer will treat it as an empty/invalid shader asset; that is
// acceptable because nothing in the project should reference
// "Cairn/MarkTextShader" by name. If a tools script complains about this
// file, delete it — its only purpose is documentation of the design
// decision recorded above.
// ---------------------------------------------------------------------------
