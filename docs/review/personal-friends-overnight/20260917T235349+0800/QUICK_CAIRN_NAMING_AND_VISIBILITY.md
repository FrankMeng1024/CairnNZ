# Quick Cairn naming and visibility

- Title and note may both be empty; the save is still valid.
- The local durable write precedes network acknowledgement.
- Successful one-tap creation briefly shows `Cairn saved` and leaves the current Activity running.
- Cairn creation itself is content, not movement evidence, and cannot reveal Fog.
- The display fallback for a blank title is exactly `A moment here`.
- The fallback is never persisted and does not replace title, note, creation time, location, Activity link, or provenance.
- An authored nonblank title, including Unicode/Māori text, always wins.
- Default audience is `Only me`; `Friends` is the only discovery expansion in v1.
- Cairn audience is independent of Memory-layer publication. A Friends-visible Cairn still requires a valid friend Encounter for viewer discovery.
- No per-person object selector, permission request workflow, public option, photo save/upload, or voice control exists in this candidate.
