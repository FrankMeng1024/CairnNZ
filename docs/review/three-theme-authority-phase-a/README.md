# Three-theme authority — Phase A

Focused 390×844 Expo Web evidence for the Home Day/Sunset/Night authority. Production Home was rendered before and after the Phase A change with the same Sunny assets, state, viewport, and account fixture.

- `home-before-after-board.jpg`: complete Home comparison; Day and Night are regression references and Sunset is the only intended visual change.
- `home-material-comparison.jpg`: actual post-change Home crops for card material, navigation/control material, primary and secondary text, primary and secondary icons, and material edge treatment across all three states.
- `before/` and `after/`: exact full-frame source captures.
- `pixel-regression.json`: pixel comparison. Day's 0.89/255 mean channel delta is attributable to its active ambient layer; Night's browser-render variance is 0.13/255. Source tokens for both are separately regression-locked in the focused test. Sunset has the intentional material change.
- `protected-asset-hashes-before.json` and `protected-asset-hashes-after.json`: SHA-256 manifests for the twelve active Home weather files. The manifests are byte-identical.
- `runtime-errors-before.txt` and `runtime-errors-after.txt`: no runtime errors were observed.

The Sunset surface ladder uses warm illuminated mineral material with grounded spruce/graphite content. It remains translucent enough to retain scenery and uses a light-catching edge rather than shadow or glow. No image, crop, layout, navigation, weather mapping, or weather-selection behavior changed.
