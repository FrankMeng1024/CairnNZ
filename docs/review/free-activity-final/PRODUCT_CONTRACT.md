# Free Hike / Free Run product contract

## Free Hike

Free Hike starts without a Route. The map is the main environment. Start is the single primary action. While recording, time, real recorded distance, and elevation gain are primary. The user may explore the map and can always Recenter. Pause exposes Resume and Finish; it never becomes Start.

## Free Run

Free Run starts without a Route. The screen stays follow-first and low-interaction. Time, real recorded distance, and pace are primary. Finish freezes GPS, time, and metrics before naming. A saved Run opens Activity Detail; an ineligible discarded Run never shows “Run Complete.”

## One unfinished Activity

CairnNZ allows zero or one unfinished Activity across Hike and Run. It does not interrupt app launch. Home Latest may show one Unfinished Activity card. Selecting it resumes that exact Activity.

Trying to start another Activity opens one resolution surface: Resume the previous Activity; Save its already recorded eligible portion; or Discard the Activity. Save uses the same eligibility and completion behavior as normal Finish and does not automatically start the newly requested Activity. Discard leaves committed Cairns and Memory intact.

## Offline and recovery

Recording, Pause/Resume, Finish/Save, Full Plant, Quick Cairn, and Memory evidence work without a network. A completed offline Activity is complete—not unfinished—and appears in Trails with “Waiting to sync” or “Sync issue · Retrying.” Its local Activity Detail remains available until verified server handoff.

After process interruption, CairnNZ restores the exact local identity and begins a new recorded segment. No line, distance, elevation, pace, active time, Route geometry, or Memory unlock is fabricated across the gap.

Logging out stops and hides any live Activity without deleting it. Another account cannot see or upload it; the original account can recover it after signing in again.

## Cairns

Hike uses Full Plant; Run uses Quick Cairn. An uncommitted Plant draft may be lost on process death. A committed Cairn is durable user data. Its final accepted (possibly corrected within the existing placement limit) coordinate contributes valid Memory evidence. A Cairn committed during an Activity records that Activity’s client identity immediately. Deleting either object does not delete the other.

## Memory

Every accepted Activity location incrementally records explored-place evidence, regardless of the passive setting. “Record exploration outside activities” controls only non-Activity observation and defaults off. Overlapping Activity, passive, Cairn, recovery, and reconciliation evidence resolves to the same explored place rather than multiplying Fog. Only Reset Memory or account deletion reduces personal Memory.

## Activity Detail

Every successful Save opens Activity Detail. Hike shows time, distance, elevation, real segments, gaps, authoritative Cairns, and sync state. Run substitutes pace for elevation emphasis. Back returns to Trails → Activities. Once server handoff and cleanup finish, reopening historical detail can require network.
