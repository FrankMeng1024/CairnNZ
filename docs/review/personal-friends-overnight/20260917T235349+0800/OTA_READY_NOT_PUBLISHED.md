# OTA ready — not published

**Status: prepared for manual owner review; not published.**

- Marker: O60, incremented exactly once from O59 after the combined client/database gates.
- App version/runtime: 0.2.6; runtime policy is `appVersion`.
- No build number, version code, native dependency, runtime version, EAS channel mapping, or App Store setting was changed.
- Review API: `https://api.yiiling.cn/pf-review-o60` (synthetic isolated realm).
- Backend source: `9b92be3efef3a355d71491ec250cb6df62878a23`.
- Client fingerprint and patches are in `SOURCE_FINGERPRINTS.json` and `evidence/`.
- Owner credentials are in the separate private mode-600 handoff file and are intentionally absent from this archive.

Before publication, verify the owner phone has a compatible 0.2.6 runtime and that the established owner environment supplies the public Mapbox configuration. The repository's remote production EAS environment names the production API, so this isolated review command deliberately uses explicit local public variables and omits `--environment production`:

```sh
cd /Users/mzm/Desktop/cairn/CairnNZ/app
EXPO_PUBLIC_API_BASE_URL=https://api.yiiling.cn/pf-review-o60 \
EXPO_PUBLIC_PLAYWRIGHT_BYPASS=false \
EXPO_PUBLIC_ACTIVITY_SIMULATOR_ENABLED=false \
npx eas update --branch production --platform ios \
  --message "O60 Personal Journal and Friends owner review"
```

Run it only where the existing public Mapbox variable is already available, and inspect the CLI's resolved environment before confirming upload. The command is documentation only and was not run. Publication does not prove device download or acceptance.

Rollback after a future manual review publication is a new EAS update on the same branch from the last accepted source/runtime, following `docs/EAS_BUILD_GUIDE.md`; do not roll back the backend to an unsafe raw-friend endpoint. The isolated review service can instead be stopped and its proxy location removed using the operations receipt.
