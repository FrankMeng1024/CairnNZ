/**
 * mapboxPrewarm — kick off a viewport-level tile download during AuthScreen
 * so Hike / Memory map opens with tiles already cached.
 *
 * Strategy: create (or skip if already exists) a small offline pack covering
 * the Auckland / Wellington / Christchurch corridor at zoom 10-13. This
 * complements the broader NZ bbox pack (zoom 5-10) already seeded by
 * initMapbox() in config/mapbox.ts — together they cover both overview and
 * street-level tiles before the user reaches the map.
 *
 * Rules:
 *  - web: no-op (Mapbox GL JS handles its own tile cache natively)
 *  - native only: uses @rnmapbox/maps offlineManager
 *  - silent failure — any exception is swallowed, auth flow is never blocked
 */
import { Platform } from 'react-native';

const PACK_NAME = 'cairn-nz-viewport-warmup';

export function prewarmMapTiles(): void {
  if (Platform.OS === 'web') return;

  // Defer to next tick so we don't block the JS thread during AuthScreen
  // initial render / animation startup.
  setTimeout(() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Mapbox = require('@rnmapbox/maps').default;
      const offline = Mapbox?.offlineManager;
      if (!offline || typeof offline.getPack !== 'function') return;

      const styleURL =
        process.env.EXPO_PUBLIC_CAIRN_TOPO_STYLE_URL ??
        'mapbox://styles/mapbox/streets-v12';

      offline.getPack(PACK_NAME).then((pack: unknown) => {
        if (pack) return; // already cached from a previous session

        void offline.createPack(
          {
            name: PACK_NAME,
            styleURL,
            // Tight NZ urban corridor: Auckland–Wellington–Christchurch.
            // At zoom 13 this is ~800 tiles — well within Mapbox free tier.
            bounds: [[172.5, -43.7], [175.0, -36.7]] as [
              [number, number],
              [number, number],
            ],
            minZoom: 10,
            maxZoom: 13,
          },
          () => { /* progress — silent */ },
          () => { /* error — silent */ },
        );
      }).catch(() => { /* silent — offline API unavailable or pack DB busy */ });
    } catch {
      // Native bridge not yet ready or module missing — silent skip.
    }
  }, 0);
}
