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
        [SerializeField] GameObject _ribbonsRoot;          // SilkRibbonV2 cluster parent
        [SerializeField] TypeParticleController _typeParticles;
        [SerializeField] CanvasGroup _labelCanvas;          // 3D world-space label

        // Current ceremony time normalized 0..1; -1 = not playing
        float _t = -1f;

        public bool IsPlaying => _t >= 0f && _t < 1f;
        public bool IsComplete => _t >= 1f;

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
                _outerRingRenderer.GetPropertyBlock(_mpb);
                if (_outerRingRenderer.sharedMaterial != null && _outerRingRenderer.sharedMaterial.HasProperty("_SweepAngle"))
                    _mpb.SetFloat("_SweepAngle", angle);
                if (_outerRingRenderer.sharedMaterial != null && _outerRingRenderer.sharedMaterial.HasProperty("_Opacity"))
                    _mpb.SetFloat("_Opacity", opacity);
                // Fallback: alpha via _BaseColor
                if (_outerRingRenderer.sharedMaterial != null && _outerRingRenderer.sharedMaterial.HasProperty("_BaseColor"))
                {
                    var c = _outerRingRenderer.sharedMaterial.GetColor("_BaseColor");
                    c.a = opacity;
                    _mpb.SetColor("_BaseColor", c);
                }
                _outerRingRenderer.SetPropertyBlock(_mpb);
            }
            if (_innerRingRenderer != null)
            {
                float sweepT = _ringSweepEndT > 0f ? Mathf.Clamp01(t / _ringSweepEndT) : 1f;
                float angle = sweepT * Mathf.PI * 2f;
                float opacity = sweepT > 0.01f ? 0.50f : 0f;
                _innerRingRenderer.GetPropertyBlock(_mpb);
                if (_innerRingRenderer.sharedMaterial != null && _innerRingRenderer.sharedMaterial.HasProperty("_SweepAngle"))
                    _mpb.SetFloat("_SweepAngle", angle);
                if (_innerRingRenderer.sharedMaterial != null && _innerRingRenderer.sharedMaterial.HasProperty("_BaseColor"))
                {
                    var c = _innerRingRenderer.sharedMaterial.GetColor("_BaseColor");
                    c.a = opacity;
                    _mpb.SetColor("_BaseColor", c);
                }
                _innerRingRenderer.SetPropertyBlock(_mpb);
            }

            // ---- Rune reveal (runeStartT → runeEndT) ----
            float runeT = 0f;
            if (_runeEndT > _runeStartT)
                runeT = Mathf.Clamp01((t - _runeStartT) / (_runeEndT - _runeStartT));
            if (_runeRenderer != null)
            {
                float runeOpacity = runeT * 0.95f;
                _runeRenderer.GetPropertyBlock(_mpb);
                if (_runeRenderer.sharedMaterial != null && _runeRenderer.sharedMaterial.HasProperty("_Reveal"))
                    _mpb.SetFloat("_Reveal", runeT);
                if (_runeRenderer.sharedMaterial != null && _runeRenderer.sharedMaterial.HasProperty("_BaseColor"))
                {
                    var c = _runeRenderer.sharedMaterial.GetColor("_BaseColor");
                    c.a = runeOpacity;
                    _mpb.SetColor("_BaseColor", c);
                }
                _runeRenderer.SetPropertyBlock(_mpb);
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
