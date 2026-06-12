using UnityEngine;
using UnityEngine.XR.ARFoundation;
using System;

namespace Cairn.AR
{
    /// <summary>
    /// v0.2.3 Branch C — day/night colour-temperature adapter.
    ///
    /// Drives shader global _CairnGlobalDayNightT (0..1, 0=night, 1=day).
    /// All Cairn ribbon shaders (CairnConeCore + CairnConeOutline) read this
    /// to blend between night palette (cool cyan/violet, additive-friendly)
    /// and day palette (warm peach/amber + dark outline rim).
    ///
    /// Two evidence sources:
    ///   1. DEVICE CLOCK (always available) — sun-elevation approximation
    ///      from local time + lat/lon. Hardcoded NZ default lat=-41.3 if
    ///      no GPS yet. Updates: every 30s.
    ///   2. ARCAMERA LUMA (preferred when available) — sample average
    ///      luminance of the AR camera background (CPU image avg). Updates:
    ///      every 1s. Pushed to _CairnGlobalAmbientLuma for finer per-scene
    ///      adapt (e.g. forest canopy = darker than open trail at the same
    ///      time of day → ribbons brighten).
    ///
    /// Final _CairnGlobalDayNightT = lerp(clockT, lumaT, 0.4) when luma
    /// available, else clockT alone. Smoothstepped 0.0..1.0 over a 30-min
    /// dawn/dusk transition so the visual never snaps.
    /// </summary>
    [DefaultExecutionOrder(-100)]
    public class CairnDayNightAdapter : MonoBehaviour
    {
        [Header("Wiring (optional)")]
        public ARCameraManager arCameraManager;   // for live luminance sample

        [Header("Location (NZ default)")]
        public double latitude = -41.286;          // NZ Wellington
        public double longitude = 174.776;
        public bool autoFromGPS = true;            // overridden by SetGPS()

        [Header("Tuning")]
        [Tooltip("Solar elevation (deg) below which dayNightT = 0 (full night).")]
        public float nightElevationDeg = -6f;       // civil twilight
        [Tooltip("Solar elevation (deg) above which dayNightT = 1 (full day).")]
        public float dayElevationDeg = 10f;         // ~30min after sunrise

        [Tooltip("Live AR luma weight (0=clock-only, 1=luma-only).")]
        [Range(0f, 1f)]
        public float lumaWeight = 0.4f;

        [Header("Sample rates")]
        public float clockUpdateInterval = 30f;
        public float lumaUpdateInterval = 1.0f;

        private static readonly int DayNightID    = Shader.PropertyToID("_CairnGlobalDayNightT");
        private static readonly int AmbientLumaID = Shader.PropertyToID("_CairnGlobalAmbientLuma");

        // v3-review-fix: auto-instantiate at first scene load so day/night
        // works on every device build without requiring the editor menu.
        // RuntimeInitializeLoadType.AfterSceneLoad ensures we run after the
        // scene's GameObjects are wired (so SceneSetup-attached singletons
        // already exist; we only create the adapter if it's missing).
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void AutoBootstrap()
        {
            if (Object.FindFirstObjectByType<CairnDayNightAdapter>() != null) return;
            var go = new GameObject("CairnDayNightAdapter (auto)");
            go.AddComponent<CairnDayNightAdapter>();
            Object.DontDestroyOnLoad(go);
        }

        private float _clockT = 0.5f;          // last clock-derived day/night value
        private float _lumaT  = -1f;           // last luma sample (-1 = unavailable)
        private float _lastClockUpdate = -100f;
        private float _lastLumaUpdate = -100f;

        public void SetGPS(double lat, double lon)
        {
            latitude = lat;
            longitude = lon;
        }

        void OnEnable()
        {
            if (arCameraManager == null) arCameraManager = Object.FindFirstObjectByType<ARCameraManager>();
            // Initialize globals so first frame is sane.
            UpdateClockT();
            PushGlobals();
        }

        void Update()
        {
            float t = Time.time;
            if (t - _lastClockUpdate >= clockUpdateInterval)
            {
                UpdateClockT();
                _lastClockUpdate = t;
            }
            if (arCameraManager != null && t - _lastLumaUpdate >= lumaUpdateInterval)
            {
                UpdateLumaT();
                _lastLumaUpdate = t;
            }
            PushGlobals();
        }

        private void UpdateClockT()
        {
            // Compute solar elevation from local time + lat/lon.
            // Algorithm: NREL solar position approximation (good to ~0.5°,
            // sufficient for visual day/night transitions).
            DateTime now = DateTime.UtcNow;
            double julianDay = ToJulianDay(now);
            double n = julianDay - 2451545.0;
            double L = (280.460 + 0.9856474 * n) % 360.0;
            double g = ((357.528 + 0.9856003 * n) % 360.0) * Math.PI / 180.0;
            double lambda = (L + 1.915 * Math.Sin(g) + 0.020 * Math.Sin(2 * g)) * Math.PI / 180.0;
            double epsilon = (23.439 - 0.0000004 * n) * Math.PI / 180.0;
            double alpha = Math.Atan2(Math.Cos(epsilon) * Math.Sin(lambda), Math.Cos(lambda));
            double delta = Math.Asin(Math.Sin(epsilon) * Math.Sin(lambda));
            // Greenwich mean sidereal time
            double GMST = (18.697374558 + 24.06570982441908 * n) % 24.0;
            double LST = (GMST + longitude / 15.0) % 24.0;
            double H = LST * 15.0 * Math.PI / 180.0 - alpha;
            double phi = latitude * Math.PI / 180.0;
            double sinAlt = Math.Sin(phi) * Math.Sin(delta) + Math.Cos(phi) * Math.Cos(delta) * Math.Cos(H);
            double altDeg = Math.Asin(Math.Max(-1, Math.Min(1, sinAlt))) * 180.0 / Math.PI;

            // Smoothstep between night and day elevation thresholds.
            float t = Mathf.InverseLerp(nightElevationDeg, dayElevationDeg, (float)altDeg);
            _clockT = Mathf.SmoothStep(0f, 1f, t);
        }

        private void UpdateLumaT()
        {
            // Try acquiring a CPU image and computing average luminance over a
            // tiny downsampled grid. ARFoundation 6.x: ARCameraManager.TryAcquireLatestCpuImage.
            if (!arCameraManager.TryAcquireLatestCpuImage(out var image))
            {
                return;
            }
            try
            {
                // Convert to RGBA32 for cheap luma read. 16x12 grid is enough.
                var conversionParams = new UnityEngine.XR.ARSubsystems.XRCpuImage.ConversionParams
                {
                    inputRect = new RectInt(0, 0, image.width, image.height),
                    outputDimensions = new Vector2Int(16, 12),
                    outputFormat = UnityEngine.TextureFormat.RGBA32,
                    transformation = UnityEngine.XR.ARSubsystems.XRCpuImage.Transformation.None,
                };
                int size = image.GetConvertedDataSize(conversionParams);
                var buffer = new Unity.Collections.NativeArray<byte>(size, Unity.Collections.Allocator.Temp);
                image.Convert(conversionParams, buffer);
                int n = 16 * 12;
                long sum = 0;
                for (int i = 0; i < n; i++)
                {
                    int idx = i * 4;
                    // Rec. 601 luma approximation
                    int r = buffer[idx + 0];
                    int g = buffer[idx + 1];
                    int b = buffer[idx + 2];
                    sum += (r * 299 + g * 587 + b * 114) / 1000;
                }
                buffer.Dispose();
                float avg = (float)sum / (n * 255f);
                // Smooth temporal — IIR with k=0.3 to avoid flicker on jitter.
                if (_lumaT < 0f) _lumaT = avg;
                else _lumaT = Mathf.Lerp(_lumaT, avg, 0.3f);
            }
            finally
            {
                image.Dispose();
            }
        }

        private void PushGlobals()
        {
            float t;
            if (_lumaT < 0f)
            {
                t = _clockT;
            }
            else
            {
                t = Mathf.Lerp(_clockT, _lumaT, lumaWeight);
            }
            Shader.SetGlobalFloat(DayNightID, t);
            Shader.SetGlobalFloat(AmbientLumaID, _lumaT < 0f ? 0.5f : _lumaT);
        }

        private static double ToJulianDay(DateTime dt)
        {
            // ISO 8601 day-of-year + standard JD epoch.
            int Y = dt.Year, M = dt.Month, D = dt.Day;
            if (M <= 2) { Y -= 1; M += 12; }
            int A = Y / 100;
            int B = 2 - A + A / 4;
            double JD = Math.Floor(365.25 * (Y + 4716)) + Math.Floor(30.6001 * (M + 1)) + D + B - 1524.5;
            JD += (dt.Hour + dt.Minute / 60.0 + dt.Second / 3600.0) / 24.0;
            return JD;
        }
    }
}
