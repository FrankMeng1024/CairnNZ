# UI state matrix

Expo Web was validated at 390×844, `en-NZ`, `Pacific/Auckland`, in Day, Sunset, and Night. The capture set contains 61 PNGs plus two current boards; `qa/personal-friends/runtime-errors.txt` is empty. Map surfaces intentionally exercise the unavailable state because no local public Mapbox token was supplied. This is browser evidence, not native/device evidence.

| # | Surface | Current states exercised | Three themes | Evidence / limitation |
|---:|---|---|---|---|
| 1 | Home | signed-in navigation, O60 identity | Yes | `*-home-390x844.png` |
| 2 | Auth | signed-out entry | Yes | `*-auth-390x844.png` |
| 3 | Hike | ready/start surface, map unavailable | Yes | `*-hike-ready-390x844.png` |
| 4 | Run | ready/start surface, map unavailable | Yes | `*-run-ready-390x844.png` |
| 5 | Plant | text-only Cairn form; no photo/voice | Yes | `*-plant-text-only-390x844.png` |
| 6 | Activity Detail | owned durable Activity and links | Yes | `*-activity-detail-own-390x844.png` |
| 7 | Own Cairn | authored identity/context/actions | Yes | `*-cairn-detail-own-390x844.png` |
| 8 | All Cairns | own-only list and fallback context | Yes | `*-all-cairns-own-only-390x844.png` |
| 9 | Trails | Route list | Yes | `*-trails-routes-390x844.png` |
| 10 | Own Route | owned origin/read/write actions | Yes | `*-route-detail-own-390x844.png` |
| 11 | Memory | Personal and map unavailable/context | Yes | `*-memory-personal-390x844.png` |
| 12 | Friends | list and relationship entry | Yes | `*-friends-list-390x844.png` |
| 13 | Friend Detail | profile, source/content entry, remove control | Yes | `*-friend-profile-390x844.png` |
| 14 | Friend Memory | combined, single friend, sharing sheet | Yes | `*-memory-combined*`, `*-memory-single-friend*`, `*-memory-sharing*` |
| 15 | Non-owner Cairn | permitted read-only content | Yes | `*-nonowner-cairn-readonly-390x844.png` |
| 16 | Non-owner Route | permitted read-only preview/use | Yes | `*-nonowner-route-readonly-390x844.png` |
| 17 | Settings | current account/settings surface | Yes | `*-settings-390x844.png` |
| 18 | Shared mutations | owner author controls; viewer hide/remove/error handling | Yes | Profile/content/sharing surfaces plus client/backend mutation tests |

Additional meaningful state: `day-friend-content-unavailable-390x844.png` covers calm authorization/network unavailability. The board `full-surface-three-theme-board.jpg` compares the full surface inventory; `personal-friends-three-theme-board.jpg` focuses on new Personal/Friends states.

Not covered here: native safe areas, software keyboard, OS larger-text rendering, native Mapbox, native GPS/background behavior, or a loaded owner build. Those remain in PJ-10, FR-14, and REL-02 as NOT_RUN native portions.
