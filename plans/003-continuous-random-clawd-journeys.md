# 003 — Continuous randomized Clawd journeys

- **Status**: DONE
- **Commit**: 97549e8
- **Severity**: HIGH
- **Category**: Cohesion, physicality, and choreography
- **Supersedes**: plan 002's isolated one-shot / fixed-vignette scheduler
- **Estimated scope**: 7 files, 3 normalized GIF assets, about 450 lines

## Problem

The first execution of plan 002 randomized isolated actions, but it still clears
the animated source after an on-screen timeout. That makes Clawd disappear in
the middle of the timetable instead of behaving like a character inhabiting
the space. A shuffled list of predefined vignettes also remains legible as a
set of repeated procedures.

The desired behavior is continuous while visible: Clawd exits through a real
screen edge, remains absent only while already off-screen, then peeks in from a
different place with Lurking. Direction, action count, action choice, farewell,
and departure mode must be composed at runtime. Racing Car and the exact
Persona rowing sequence must join the vocabulary.

## Source audit

- `Clawd-RacingCar.gif`: 1189×800, 48 frames, 4010ms, identical first/last
  composited frame.
- Persona rowing transition:
  - `ac0fa108.gif`: 1189×800. Frames before 2170ms form the intro.
  - At exactly 2170ms, its next visible frame matches frame 0 of
    `7bbe5052.gif` on the same canvas.
  - `7bbe5052.gif`: 1189×800, 11 frames, 1760ms rowing loop.
- The 1189:800 ratio matches the normalized 275:185 stage ratio. Normalize all
  three timetable copies to 275×185 with nearest-neighbor resampling, retained
  GIF timing/transparency, and standardized names:
  - `/assets/images/timetable-theme-clawd-racing-car.gif`
  - `/assets/images/timetable-theme-clawd-rowing-intro.gif`
  - `/assets/images/timetable-theme-clawd-rowing.gif`
- The rowing-intro copy contains only the frames before the exact 2170ms
  Persona handoff; do not retain the unused tail. Save it without a Netscape
  loop extension so callback drift holds the last intro frame instead of
  flashing back to its standing first frame.
- Shift both normalized rowing canvases left by one pixel. The intro first
  frame then has alpha bounds `(74,105)–(194,185)`, exactly matching normalized
  Walking, while Persona intro frame 26 still matches Rowing frame 0
  pixel-for-pixel after normalization.

## Target choreography

Build each journey at runtime rather than choosing from a fixed sequence:

1. Pick a left/right entry edge and a vertical anchor from shuffled bags. The
   new entry may not repeat the previous edge+anchor combination.
2. Lurking completes its native peek / greeting / retract loop at that edge.
   It is the one source that must not be treated as a shared standing-baseline
   handoff. Only after the visible character has retracted outside the viewport
   may the source change.
3. Walking then emerges from outside at the exact same vertical height. The
   stage remains outside during the walking GIF's 330ms lead frame, so the
   Lurking → Walking swap is invisible and cannot flash. Its 80ms baseline
   handoff from plan 001 remains intact. Mirroring is applied only to the inner
   media when entering from the opposite direction.
4. Draw one action, with a bounded random chance of a second different action,
   from a shuffled action bag containing waving, jumping, dancing, laptop, and
   magnifier. All on-screen source changes happen at the same fixed stage and
   baseline; never fade to zero between actions.
5. Optionally wave goodbye when the last action is not already waving. The
   choice is random and bounded, not an every-journey ritual.
6. Draw a departure mode from a shuffled weighted bag containing two walking
   entries, one Racing Car entry, and one rowing entry. Walking may naturally
   occur twice in a row but never three times; Racing Car and rowing may not
   repeat across a refill boundary.
   - walking: face the chosen exit and walk fully beyond that edge;
   - Racing Car: start at the activity anchor on its baseline frame, animate
     the outer stage through the chosen edge during its 4010ms loop, and clear
     only after the stage is fully off-screen;
   - rowing: play the 2170ms intro without moving the stage, switch directly to
     its matching rowing frame at the same anchor/facing, then move the boat
     fully beyond the chosen edge during the 1760ms loop. Rowing is terminal:
     no action or farewell may follow it.
7. Only after the final departure step is off-screen and opacity 0 may the
   source be cleared. Resolve a `900–2800ms` off-screen quiet interval at
   runtime, then start the next journey from a newly drawn Lurking anchor.

Entry points are drawn from one shuffled six-value bag (left/right ×
upper/middle/lower), with only the exact edge+anchor combination guarded across
refills. Exit directions allow one or two consecutive journeys on the same
side and force a change only after a run of two; a two-value no-adjacent bag is
forbidden because it degenerates into a visible L/R/L/R pattern. Left-facing
art uses `scaleX(-1)` only on `.clawd-scene-media`; route transforms remain on
`.clawd-scene-stage`.

## Motion rules

- Keep the fixed 360rpx × 242rpx stage from plan 001 for every source.
- No on-screen step ends by merely setting `src` to empty or fading in place.
- Shared-baseline GIFs change source only after a complete loop on their common
  standing frame. Lurking instead completes its native retract before the
  off-screen swap to Walking. Rowing intro and rowing use their audited exact
  2170ms matching-frame transition.
- No scale animation. Route and appearance keyframes animate transform and
  opacity only; static anchor classes may set layout positions.
- Walking route remains linear and retains 18.97% / 95.4% handoff markers.
- Lurking uses its complete 5580ms native peek/retract loop. Any outer-stage
  reveal is subtle and must not hide the greeting or fade out the retraction.
- Racing uses a strong on-screen movement curve. Its 4090ms stage must finish
  beyond the chosen edge by `89.73%` (3670ms), before the GIF changes from car
  back to standing Clawd, and then hold off-screen through the handoff margin.
  Rowing uses a calm linear 1840ms stage, finishes beyond the edge by `95.65%`
  (1760ms), and holds off-screen for the final 80ms. Both directions exist.
- Keep opacity in the existing 0.34–0.46 range and all motion under the course
  layer with `pointer-events: none`.
- Reduced motion renders only the existing idle SVG and never starts a journey
  scheduler.

## Scheduler design

- Replace `CLAWD_SCENE_VIGNETTES` and its fixed definitions with a journey
  builder and small Fisher–Yates draw bags for actions, departure modes, and
  the six entry edge+anchor combinations. Exit direction uses an independent
  random draw with a maximum same-side run of two.
- Do not use `sort(() => Math.random() - 0.5)`, `setInterval`, or more than one
  live timer/GIF.
- A deterministic random source in the regression check must be able to build
  at least 40 journeys and prove:
  - both directions and several anchors occur;
  - an exact entry edge+anchor does not repeat adjacently, both exit directions
    occur, no exit-direction run exceeds two, and directions do not collapse
    into strict L/R alternation;
  - each action bag is exhausted before refill and adjacent actions differ;
  - Racing Car and rowing each occur in every complete departure-mode bag,
    special modes do not repeat adjacently, and walking runs never exceed two;
  - each journey begins with Lurking, contains an emerge step, and ends in a
    declared off-screen exit;
  - no journey contains a null/blank on-screen step;
  - Lurking is followed by Walking outside the viewport at the same vertical
    height, never by an on-screen source swap;
  - rowing intro is followed directly by rowing at one anchor/direction, rowing
    is the final step, and the final rowing route is off-screen.
- Theme changes, page hide/unload, and reduced-motion changes still cancel the
  revision and the single timeout immediately.

## Boundaries

- Do not modify course layout/colors, menu motion, companion animation, or the
  login page.
- Do not use Persona files under hashed names at runtime; only the normalized,
  standardized timetable copies are allowed.
- Do not introduce MOV/WebM or additional simultaneous media layers.
- Do not move a visible stage between unrelated anchors without first exiting
  the viewport.
- Do not preserve the now-superseded solo fade-out keyframes or their tests as
  dead code.

## Execution notes

- Replaced the fixed vignette list with a runtime journey builder. A seeded
  96-journey regression exhausts complete entry, action, and weighted
  departure bags while proving every visible phrase begins with Lurking,
  emerges at the same height, and ends through a declared off-screen route.
- Preserved one cancellable timeout and one GIF. Shared-baseline source changes
  receive an 80ms scheduling margin; Lurking and rowing intro retain their
  exact audited handoff timing.
- Added bidirectional Walking, Racing Car, and rowing exits. Racing is hidden
  before its standing tail; rowing intro stays anchored and non-looping before
  its direct same-anchor/same-facing rowing traverse.
- Added normalized 275×185 Racing Car, rowing-intro, and rowing assets with
  exact 4010ms / 2170ms / 1760ms source timing, transparency, and checks for
  the intro loop metadata and optical center.

## Verification

- Run typecheck, `check:timetable`, `check:wxml`, `check:schedule`, the full
  Skyline WXSS check, and `git diff --check`.
- Verify the three new GIFs are 275×185 and preserve 4010ms / 2170ms / 1760ms
  timing respectively.
- Review every source handoff in the journey builder: visible-to-visible at one
  stable anchor, or source clearing only after an off-screen exit.
- Confirm the WXML still renders exactly one GIF and reduced motion shows only
  the static idle SVG.
- **Done when**: Clawd never vanishes while visible, entries/exits and facing
  feel spatially continuous, Racing Car and rowing appear naturally, and 40+
  deterministic journeys show no fixed action or direction cycle.
