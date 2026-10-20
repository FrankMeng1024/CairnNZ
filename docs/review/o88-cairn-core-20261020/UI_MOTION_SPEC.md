# UI and motion specification

## Shared visual language

O88 reuses the locked visual system (`useVisualTheme`, forest/cream/warm-stone palette, canonical type scale, `PrimaryButton`, `Icon`, `ContentSurface`) and adds two code-native primitives:

| Primitive | Purpose | Visual behavior |
|---|---|---|
| `CairnStoneMark` | Identity/status anchor | Three restrained warm/neutral stones; not a new Home icon |
| `CairnPaper` | Create/read/update surface | Warm paper, small fold corner, theme-aware border/shadow; content remains selectable/readable |
| `CairnPlaceAnchor` | Location confidence | Plain place label plus accuracy, age, and simulator disclosure |
| `CairnStatusPill` | Audience/version state | Compact non-gamified status, not a reward badge |

The implementation lives in `app/src/features/cairns/components/CairnPaper.tsx`; terminology, audience semantics, and timings live in `app/src/features/cairns/cairnExperience.ts`.

## Layout

- The note body is the primary field (148 px minimum); optional title is supporting metadata.
- The editor does not autofocus on mount.
- Place context sits above the note; audience and its consequences sit adjacent to the submit action.
- Submit labels are semantic: `Save privately`, `Leave for friends`, or `Submit for review`.
- Public is visibly blocked without an eligible Activity or useful text rather than silently failing later.
- Verified Web viewports: 360×780, 390×844, and 430×932; themes: Day, Sunset, Night.

## Five motions

| Moment | Duration | Start → finish | Interruption/failure | Reduce Motion |
|---|---:|---|---|---|
| Leave | 620 ms | persisted-success stone pieces settle and paper confirmation appears | No success animation before store/server result; failure preserves draft and pin | Immediate final state |
| Encounter | 760 ms | stone glow/settle then folded note card at map bottom | Dismissal/Later never removes acquired item; no camera move | Immediate card, no transform sequence |
| Read | 360 ms | paper rises/fades into readable state | Navigation can leave immediately | Immediate final state |
| Update | 360 ms | new paper/version remounts with restrained reveal | failed save leaves edit state | Immediate final state |
| Close/delete | platform dialog, target 260–550 ms | consequence sheet settles over current detail | destructive action remains explicit; no optimistic disappearance | OS/component final state |

The shared durations are bounded by `CAIRN_MOTION`. Animations use opacity/transform and are finite—no looping sparkle, reward burst, or camera takeover. `useReduceMotion()` suppresses decorative transitions. Haptic encounter feedback is deduplicated once per viewer/presentation/event in the running process.

## Content and accessibility review

- Short English, short Chinese, and long-note rendering use the same paper hierarchy; arbitrary fixed line counts were not introduced.
- Buttons retain canonical hit targets and labels; state is communicated with text, not color alone.
- Night paper and secondary text were visually checked in Web capture.
- Native large Dynamic Type, keyboard avoidance, screen-reader traversal, and 60-fps instrumentation are **NATIVE PENDING**. The candidate does not claim them from Web screenshots.
