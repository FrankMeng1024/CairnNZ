// Phase 2B (round-2 fix #2B-2.A) — Placeholder type-icon textures.
//
// Per ADR-005 (revised 2026-06-17): Phase 4 EAS build #1 replaces these with
// designer-authored SDFs. Until then, runtime-build 5 simple alpha shapes
// per CairnType so Editor playground + EAS build #1 dry-runs can render
// SOMETHING in each icon slot.
//
// All shapes are 128×128 alpha-only textures, drawn into a single Texture2D
// per CairnType, cached in static dict. Caller must release if needed.

using System.Collections.Generic;
using UnityEngine;

namespace Cairn.AR.V025.Visual
{
    public static class PlaceholderTextures
    {
        private const int Size = 128;
        private static readonly Dictionary<CairnType, Texture2D> _cache = new Dictionary<CairnType, Texture2D>();

        public static Texture2D Get(CairnType type)
        {
            if (_cache.TryGetValue(type, out var cached) && cached != null) return cached;
            var tex = Build(type);
            _cache[type] = tex;
            return tex;
        }

        private static Texture2D Build(CairnType type)
        {
            var tex = new Texture2D(Size, Size, TextureFormat.RGBA32, mipChain: false);
            tex.name = $"v025_placeholder_{type}";
            tex.filterMode = FilterMode.Bilinear;
            tex.wrapMode = TextureWrapMode.Clamp;
            var pixels = new Color32[Size * Size];

            for (int y = 0; y < Size; y++)
            {
                for (int x = 0; x < Size; x++)
                {
                    float nx = (x + 0.5f) / Size * 2.0f - 1.0f; // -1..1
                    float ny = (y + 0.5f) / Size * 2.0f - 1.0f;
                    byte alpha = AlphaForShape(type, nx, ny);
                    pixels[y * Size + x] = new Color32(255, 255, 255, alpha);
                }
            }
            tex.SetPixels32(pixels);
            tex.Apply(updateMipmaps: false);
            return tex;
        }

        private static byte AlphaForShape(CairnType type, float nx, float ny)
        {
            float dist = Mathf.Sqrt(nx * nx + ny * ny);
            switch (type)
            {
                case CairnType.Image:
                    // filled circle radius ~0.7
                    return AlphaFromSdf(dist - 0.7f);
                case CairnType.Voice:
                    // ring: |r - 0.65| < 0.08
                    return AlphaFromSdf(Mathf.Abs(dist - 0.65f) - 0.08f);
                case CairnType.Video:
                    // triangle pointing up
                    {
                        float yTop = 0.7f, yBot = -0.5f;
                        if (ny > yTop || ny < yBot) return 0;
                        float t = (yTop - ny) / (yTop - yBot);
                        float halfWidth = 0.7f * t;
                        return AlphaFromSdf(Mathf.Abs(nx) - halfWidth);
                    }
                case CairnType.Text:
                    // square radius 0.6
                    return AlphaFromSdf(Mathf.Max(Mathf.Abs(nx), Mathf.Abs(ny)) - 0.6f);
                case CairnType.Route:
                    // diagonal stripe ↘
                    return AlphaFromSdf(Mathf.Abs(nx + ny) - 0.25f) > 0
                        ? AlphaFromSdf(Mathf.Abs(nx + ny) - 0.25f)
                        : (byte)0;
                default:
                    return AlphaFromSdf(dist - 0.7f);
            }
        }

        private static byte AlphaFromSdf(float d)
        {
            // SDF: d < 0 inside (alpha 1), d > 0 outside (alpha 0), with smooth edge.
            const float edge = 0.04f;
            float t = Mathf.Clamp01(0.5f - d / (2 * edge));
            return (byte)(t * 255);
        }
    }
}
