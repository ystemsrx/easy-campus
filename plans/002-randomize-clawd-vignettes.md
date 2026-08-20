# 002 — Randomize and diversify Clawd vignettes

- **Status**: SUPERSEDED BY 003
- **Commit**: 97549e8
- **Severity**: HIGH
- **Category**: Cohesion & missed opportunities
- **Estimated scope**: 3 files, about 220 lines

## Problem

The current timetable always advances through the same five sequences in the
same order:

```ts
// miniprogram/pages/timetable/index.ts:779 — current
if (clawdSceneStepIndex >= sequence.length) {
  clawdSceneStepIndex = 0;
  clawdSequenceIndex = (clawdSequenceIndex + 1) % CLAWD_SCENE_SEQUENCES.length;
}
```

Each sequence is a fixed process followed by a fixed 2400–4200ms null step.
Users can quickly predict walking → action → walking → absence, so the ambient
character feels scheduled instead of alive.

The referenced gallery contains CrabWalking, Lurking, Waving, JumpingHappy,
Magnifier, RacingCar, Dancing, Laptop, Persona pairs, minigame sprites, and
static vector poses. For a timetable background, the appropriate set is
walking, lurking, waving, jumping, magnifier, dancing, and laptop. RacingCar,
Persona pairs, and minigame sprites are intentionally excluded because their
large props, file weight, or game semantics compete with timetable reading.

## Target

- Replace fixed sequential cycling with a shuffled draw bag. Every vignette
  appears once before refilling; the first vignette in a new bag may not equal
  the last vignette from the previous bag.
- Include at least 10 vignettes across three lengths:
  1. **One-shot**: lurking at left edge; waving at upper right; jumping at
     middle left; dancing at lower right; laptop at upper right; magnifier at
     upper left.
  2. **Short phrase**: wave → dance; jump → wave; laptop → magnifier.
  3. **Walking phrase**: left walk-in → wave or jump → right walk-out; mirrored
     right walk-in → dance or wave → left walk-out.
- At least 60% of vignettes are one-shot or two-action phrases, so the result
  does not feel like every appearance is a processional route.
- Quiet time is resolved at runtime from `1800–4800ms`, not stored as one fixed
  duration. Magnifier may use `3200–5600ms` afterward because its 9410ms action
  is already long.
- Use Fisher–Yates shuffle, not `sort(() => Math.random() - 0.5)`.
- Do not repeat the same scene at the same anchor in adjacent vignettes.
- Use the shared-baseline handoff values from plan 001:
  walking 1740ms, waving 1490ms, dancing 3410ms, jumping 1760ms, lurking
  5580ms, laptop 3580ms, magnifier 9410ms.
- Continue rendering only one GIF, behind the timetable, at opacity 0.34–0.46.
- Preserve interruptibility: switching theme or unloading invalidates the
  revision and clears every timer immediately.
- Preserve reduced motion: no draw-bag scheduler runs when motion is reduced.

## Repo conventions to follow

- Revision cancellation and timer cleanup already exist in
  `miniprogram/pages/timetable/index.ts:739–784`; extend them rather than adding
  a parallel scheduler.
- Scene definitions and source maps live at
  `miniprogram/pages/timetable/index.ts:98–130`.
- The login page demonstrates exact GIF-duration handoffs and source restart in
  `miniprogram/pages/login/index.ts:135–221`.
- Constant route movement stays linear. Translated arrivals use
  `cubic-bezier(0.23, 1, 0.32, 1)` and on-screen repositioning uses
  `cubic-bezier(0.77, 0, 0.175, 1)`.

## Steps

1. Complete plan 001 first; do not implement this plan against the current
   mismatched canvases.
2. Rename `CLAWD_SCENE_SEQUENCES` to `CLAWD_SCENE_VIGNETTES`. Define at least
   10 entries meeting the exact mix in Target. Each entry declares a stable
   anchor for all of its non-walking actions.
3. Add `laptop` and `magnifier` to `TimetableClawdSceneName`, sources, and exact
   duration constants. Do not add RacingCar, Persona, or game sprites.
4. Replace `clawdSequenceIndex` with a draw-bag array, last-vignette id, and a
   Fisher–Yates refill helper. On refill, swap the first drawable entry when it
   would immediately repeat the previous vignette.
5. Add a `quietRangeMs` field to vignettes, resolve it once when the vignette is
   selected, and schedule a null scene after completion. Use inclusive random
   integer selection. Default range is 1800–4800ms; magnifier vignettes use
   3200–5600ms.
6. Ensure `startClawdSceneSequence`, `stopClawdSceneSequence`, `onUnload`, and
   theme changes reset the active step and timer safely. A page re-entry may
   reshuffle, but it must not create two timers.
7. Update `scripts/check-timetable.js` to require laptop/magnifier, Fisher–Yates,
   no modulo sequence cycling, at least 10 vignette declarations, both walking
   directions, dynamic quiet ranges, no adjacent repeat guard, exact duration
   constants, one-GIF WXML, and reduced-motion gating.

## Boundaries

- Do not make Clawd consume taps or swipes; the timetable remains fully usable.
- Do not trigger animations from every week swipe or course tap. Ambient random
  timing is enough and avoids high-frequency motion.
- Do not run two GIFs concurrently or add crossfade layers.
- Do not use `setInterval`; retain one cancellable `setTimeout` chain.
- Do not use layout animation (`top`, `left`, width, height) during playback;
  animate only transform and opacity.
- Do not change login-page behavior or assets.

## Execution notes

- Implemented 13 vignettes: six one-shots, three two-action phrases, two
  left-to-right routes, and two mirrored right-to-left routes.
- Every vignette carries a `gesture`, `short`, `route`, or `prop` rhythm. Bag
  ordering rejects both route-to-route and prop-to-prop boundaries, including
  the boundary between refills.
- The regression check loads the production scheduler with a deterministic
  random source and verifies eight complete bags (104 selections), including
  bag completeness, rhythm boundaries, final-action departures, and inclusive
  quiet-time ranges.
- The user subsequently replaced isolated one-shots with continuous journeys
  that enter and leave through viewport edges. Plan 003 supersedes the fixed
  vignette scheduler and solo fade-out choreography before commit.

## Verification

- **Mechanical**: run `npm run typecheck`, `npm run check:timetable`,
  `npm run check:wxml`, `npm run check:schedule`, and `npm run check:wxss`.
- **Scheduler inspection**: with a deterministic random stub, select 30
  vignettes and confirm every bag contains every vignette exactly once, no
  boundary repeat occurs, and quiet durations stay inside their declared
  ranges.
- **Feel check**:
  - Observe at least two complete bags. Appearances must alternate between
    isolated gestures, short phrases, and occasional walking routes.
  - The same action must not repeatedly appear at the same anchor.
  - Laptop and magnifier are rare, calm moments rather than back-to-back props.
  - No action obscures course interaction; all motion remains beneath the grid.
  - Toggle reduced motion and confirm the scheduler stops and the idle SVG
    remains.
- **Done when**: Clawd no longer follows a recognizable fixed cycle, the full
  selected seven-action set appears over time, optical size remains stable, and
  all targeted checks pass.
