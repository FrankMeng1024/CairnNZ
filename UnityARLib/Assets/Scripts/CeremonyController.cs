// Cairn AR — Ceremony timeline controller (v0.2.4 Branch C)
//
// 1:1 port of design_v2026-06_variant_C_3D.html line 626-666 ceremony.
//
// Timeline (1.0s total):
//   0.00 - 0.50  outer ring + inner ring clockwise sweep stencil
//   0.50 - 0.85  rune fades in + scale 0.7 → 1.0
//   0.85 - 1.00  ribbons + type particles activate + label fades in
//
// Triggered by CairnAcquireController when three implementation
// conditions are all met (distance ≤10m + camera facing mark + plane
// converged) OR after 15s force-fallback.
//
// Once playing, timeline is monotonic — no rewind. After completion,
// cairn is IMMORTAL (永久 visible per user contract).

using System;
using System.Collections;
using UnityEngine;

namespace Cairn.AR
{
    public class CeremonyController : MonoBehaviour
    {
        [Header("Timeline")]
        [Tooltip("Total ceremony length in seconds (variant_C_3D.html = 1.0)")]
        [SerializeField] float _totalDuration = 1.0f;
        [Tooltip("Ring sweep ends at this normalized t (variant_C_3D.html = 0.50)")]
        [SerializeField] float _ringSweepEndT = 0.50f;
        [Tooltip("Rune reveal starts at this t (variant_C_3D.html = 0.50)")]
        [SerializeField] float _runeStartT = 0.50f;
        [Tooltip("Rune reveal ends at this t (variant_C_3D.html = 0.85)")]
        [SerializeField] float _runeEndT = 0.85f;
        [Tooltip("Ribbons + particles activate at this t (variant_C_3D.html = 0.85)")]
        [SerializeField] float _ribbonStartT = 0.85f;

        [Header("Wired sub-controllers")]
        [SerializeField] Renderer _outerRingRenderer;
        [SerializeField] Renderer _innerRingRenderer;
        [SerializeField] Renderer _runeRenderer;
        [SerializeField] Transform _runeTransform;
        [SerializeField] GameObject _ribbonsRoot;          // ribbon/strand cluster parent (cone-strand or future ribbon)
        [SerializeField] TypeParticleController _typeParticles;
        [SerializeField] CanvasGroup _labelCanvas;          // 3D world-space label

        // v0.2.4 Phase 2: V199 spawn flow runtime wire (无 prefab 项目里 SerializeField 永远 null)
        public void SetTypeParticles(TypeParticleController tp)
        {
            _typeParticles = tp;
            // v0.2.4 Phase 3 LOG: 接入时刻 emit 一次,真机看 ceremony 真有 wire 到 tp
            UnityLogger.ICritical("v22-PHASE3-PARTICLE-CEREMONY-WIRE",
                $"ceremony={(this != null)} tp_set={(tp != null)}");
        }

        // v0.2.4 Phase 3 LOG: SetSpawnEnabled 转换 latch (防每帧刷屏)
        bool _phase3LastSpawnEnabled = false;
        bool _phase3FirstTransition = true;

        // Current ceremony time normalized 0..1; -1 = not playing
        float _t = -1f;

        public bool IsPlaying => _t >= 0f && _t < 1f;
        public bool IsComplete => _t >= 1f;
        // Block C: 给 CairnAcquireController 算 ceremony 完成 emit 用
        public float TotalDuration => _totalDuration;

        // Per-frame property block reuse
        MaterialPropertyBlock _mpb;

        void Awake()
        {
            _mpb = new MaterialPropertyBlock();
            // Start hidden
            ApplyState(0f);
            if (_typeParticles != null) _typeParticles.SetSpawnEnabled(false);
            if (_ribbonsRoot != null) _ribbonsRoot.SetActive(false);
            if (_labelCanvas != null) _labelCanvas.alpha = 0f;
        }

        public void Play()
        {
            if (IsPlaying || IsComplete) return;
            StopAllCoroutines();
            StartCoroutine(PlayCo());
        }

        // v0.2.4 R2-followup Story C — public setter so PortalSpawner.cs:783 可以 wire
        // ring 的 Renderer 到 outer ring (RN spawn 时不挂 prefab,直接 AddComponent + 设)
        public void SetTargetRenderer(Renderer ringRenderer)
        {
            _outerRingRenderer = ringRenderer;
        }

        public void Reset()
        {
            StopAllCoroutines();
            _t = -1f;
            ApplyState(0f);
            if (_typeParticles != null) _typeParticles.SetSpawnEnabled(false);
            if (_ribbonsRoot != null) _ribbonsRoot.SetActive(false);
            if (_labelCanvas != null) _labelCanvas.alpha = 0f;
        }

        IEnumerator PlayCo()
        {
            _t = 0f;
            float startTime = Time.time;
            while (_t < 1f)
            {
                _t = Mathf.Clamp01((Time.time - startTime) / _totalDuration);
                ApplyState(_t);
                yield return null;
            }
            _t = 1f;
            ApplyState(1f);
        }

        void ApplyState(float t)
        {
            // ---- Ring clockwise sweep (0 → ringSweepEndT) ----
            if (_outerRingRenderer != null)
            {
                float sweepT = _ringSweepEndT > 0f ? Mathf.Clamp01(t / _ringSweepEndT) : 1f;
                float angle = sweepT * Mathf.PI * 2f;
                float opacity = sweepT > 0.01f ? 0.55f : 0f;
                // v0.2.4 Phase1 final review fix:
                // _SweepAngle/_Reveal 在 PortalRingShader CBUFFER_START(UnityPerMaterial) 里,
                // SRP Batcher 启用时 MPB 写 CBUFFER 字段被静默忽略 → ring 永远显示默认 (full)。
                // 改用 material.SetFloat 真生效。Sub#acf50fb 抓的真 BUG。
                var outerMat = _outerRingRenderer.material;  // material instance, not sharedMaterial
                if (outerMat != null && outerMat.HasProperty("_SweepAngle"))
                    outerMat.SetFloat("_SweepAngle", angle);
                if (outerMat != null && outerMat.HasProperty("_Opacity"))
                    outerMat.SetFloat("_Opacity", opacity);
                if (outerMat != null && outerMat.HasProperty("_BaseColor"))
                {
                    var c = outerMat.GetColor("_BaseColor");
                    c.a = opacity;
                    outerMat.SetColor("_BaseColor", c);
                }
            }
            if (_innerRingRenderer != null)
            {
                float sweepT = _ringSweepEndT > 0f ? Mathf.Clamp01(t / _ringSweepEndT) : 1f;
                float angle = sweepT * Mathf.PI * 2f;
                float opacity = sweepT > 0.01f ? 0.50f : 0f;
                var innerMat = _innerRingRenderer.material;
                if (innerMat != null && innerMat.HasProperty("_SweepAngle"))
                    innerMat.SetFloat("_SweepAngle", angle);
                if (innerMat != null && innerMat.HasProperty("_BaseColor"))
                {
                    var c = innerMat.GetColor("_BaseColor");
                    c.a = opacity;
                    innerMat.SetColor("_BaseColor", c);
                }
            }

            // ---- Rune reveal (runeStartT → runeEndT) ----
            float runeT = 0f;
            if (_runeEndT > _runeStartT)
                runeT = Mathf.Clamp01((t - _runeStartT) / (_runeEndT - _runeStartT));
            if (_runeRenderer != null)
            {
                float runeOpacity = runeT * 0.95f;
                var runeMat = _runeRenderer.material;
                if (runeMat != null && runeMat.HasProperty("_Reveal"))
                    runeMat.SetFloat("_Reveal", runeT);
                if (runeMat != null && runeMat.HasProperty("_BaseColor"))
                {
                    var c = runeMat.GetColor("_BaseColor");
                    c.a = runeOpacity;
                    runeMat.SetColor("_BaseColor", c);
                }
            }
            if (_runeTransform != null)
            {
                _runeTransform.localScale = Vector3.one * Mathf.Lerp(0.7f, 1.0f, runeT);
            }

            // ---- Ribbons + type particles + label (ribbonStartT → 1) ----
            bool ribbonsOn = t >= _ribbonStartT;
            if (_ribbonsRoot != null && _ribbonsRoot.activeSelf != ribbonsOn)
                _ribbonsRoot.SetActive(ribbonsOn);
            if (_typeParticles != null)
                _typeParticles.SetSpawnEnabled(ribbonsOn);
            // v0.2.4 Phase 3 LOG: 仅在 transition 时 emit,latch 防刷屏
            if (_phase3FirstTransition || ribbonsOn != _phase3LastSpawnEnabled)
            {
                UnityLogger.ICritical("v22-PHASE3-PARTICLE-SPAWN-ENABLED",
                    $"t={t:F2} ribbonStartT={_ribbonStartT:F2} ribbonsOn={ribbonsOn} " +
                    $"tp_attached={(_typeParticles != null)}");
                _phase3LastSpawnEnabled = ribbonsOn;
                _phase3FirstTransition = false;
            }
            if (_labelCanvas != null)
            {
                float labelT = ribbonsOn
                    ? Mathf.Clamp01((t - _ribbonStartT) / Mathf.Max(0.01f, 1f - _ribbonStartT))
                    : 0f;
                _labelCanvas.alpha = labelT;
            }
        }
    }
}
