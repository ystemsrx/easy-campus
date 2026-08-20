# 006 — Protect vehicle edge handoffs and add rowing arrivals

- **Status**: DONE
- **Commit**: 2eaf03a
- **Severity**: HIGH
- **Category**: Physicality, timing, and cohesion
- **Estimated scope**: 4 source/check files, 1 derived GIF asset, about 350 lines

## Problem

Plan 005 added direct Racing arrivals and Racing cross-edge bridges, but its
entry route treats the whole native Racing action as vehicle travel:

```css
/* miniprogram/pages/timetable/index.wxss:1697 — current */
@keyframes clawd-race-enter-left {
  0%,
  8.07% {
    transform: translateX(-560rpx);
    opacity: 0;
  }
  12.23% {
    transform: translateX(-430rpx);
    opacity: 0.44;
  }
  89.73%,
  100% {
    transform: translateX(0);
    opacity: 0.44;
  }
}
```

Frame-by-frame inspection of the normalized 275×185, 4010ms Racing source
shows three distinct physical phases:

- frame 0 is the shared standing baseline;
- frames beginning at 330ms build/board the car, but Clawd is not fully seated
  until the 1000ms frame;
- the last fully-driving frame begins at 3000ms;
- disembarking begins with the 3080ms frame and completes back to standing.

The 4090ms stage includes the source's 4010ms loop plus the existing 80ms
baseline margin. The current route begins exposing the stage around 500ms and
does not reach its anchor until 3670ms. Consequently direct/bridge entries can
show boarding at the screen edge and then stop near an edge while the native
GIF plays its disembark sequence. A bridge Racing exit uses the same final-exit
route, so it can also begin disembarking before it is safely invisible.

Final standalone Racing departure is deliberately allowed to keep its current
timing and look. Only Racing entry and intermediate bridge exit require the
stricter vehicle-only window.

The passage arrival bag also has Walking, Racing, and occasional Lurking, but
no rowing arrival. Rowing already has a boat loop and a standing→boat intro;
a natural arrival needs the inverse boat→standing transition after the boat
reaches the anchor.

## Target

### 1. Race only while fully boarded

Keep `CLAWD_RACING_SOURCE_DURATION_MS = 4010` and
`CLAWD_RACING_DURATION_MS = 4090`. Define these audited stage markers:

- fully boarded: `1000 / 4090 = 24.45%`;
- first safely visible travel frame: `1170 / 4090 = 28.61%`;
- last near-edge driving frame: `2920 / 4090 = 71.39%`;
- fully anchored/off-screen while still driving: `3000 / 4090 = 73.35%`;
- native disembark begins at 3080ms, after the stage is already safely at its
  destination.

Use a piecewise-linear distance profile for both Racing entry keyframes. The
car must enter at constant speed, then decelerate to rest; it must not
accelerate after becoming visible. Constant-speed travel is 320rpx/s from
1000–2500ms, followed by constant deceleration from 320rpx/s to zero during
2500–3000ms. Rounded rpx samples retain that physical profile:

```css
@keyframes clawd-race-enter-left {
  0%,
  24.45% {
    transform: translateX(-560rpx);
    opacity: 0;
  }
  28.61% {
    transform: translateX(-506rpx);
    opacity: 0.44;
  }
  61.12% {
    transform: translateX(-80rpx);
    opacity: 0.44;
  }
  63.57% {
    transform: translateX(-51rpx);
    opacity: 0.44;
  }
  66.01% {
    transform: translateX(-29rpx);
    opacity: 0.44;
  }
  68.46% {
    transform: translateX(-13rpx);
    opacity: 0.44;
  }
  70.9% {
    transform: translateX(-3rpx);
    opacity: 0.44;
  }
  73.35%,
  100% {
    transform: translateX(0);
    opacity: 0.44;
  }
}

@keyframes clawd-race-enter-right {
  0%,
  24.45% {
    transform: translateX(560rpx);
    opacity: 0;
  }
  28.61% {
    transform: translateX(506rpx);
    opacity: 0.44;
  }
  61.12% {
    transform: translateX(80rpx);
    opacity: 0.44;
  }
  63.57% {
    transform: translateX(51rpx);
    opacity: 0.44;
  }
  66.01% {
    transform: translateX(29rpx);
    opacity: 0.44;
  }
  68.46% {
    transform: translateX(13rpx);
    opacity: 0.44;
  }
  70.9% {
    transform: translateX(3rpx);
    opacity: 0.44;
  }
  73.35%,
  100% {
    transform: translateX(0);
    opacity: 0.44;
  }
}
```

Set these entry classes to `animation-timing-function: linear`. Boarding
therefore happens completely off-screen. The fully boarded car alone crosses
the edge at constant visible speed, decelerates only near the destination,
reaches the activity anchor by 3000ms, and only then plays its 3080ms+
disembark frames at the anchor before handing off on standing.

Add bridge-only classes with a piecewise-linear acceleration profile. From
1000–1500ms, approximate constant acceleration from rest to 320rpx/s using
100ms samples; from 1500–3000ms, preserve 320rpx/s until fully off-screen. The
car must never decelerate on its way out:

```css
@keyframes clawd-race-bridge-exit-left {
  0%,
  24.45% {
    transform: translateX(0);
    opacity: 0.44;
  }
  26.89% {
    transform: translateX(-3rpx);
    opacity: 0.44;
  }
  29.34% {
    transform: translateX(-13rpx);
    opacity: 0.44;
  }
  31.78% {
    transform: translateX(-29rpx);
    opacity: 0.44;
  }
  34.23% {
    transform: translateX(-51rpx);
    opacity: 0.44;
  }
  36.67% {
    transform: translateX(-80rpx);
    opacity: 0.44;
  }
  71.39% {
    transform: translateX(-534rpx);
    opacity: 0.44;
  }
  73.35%,
  100% {
    transform: translateX(-560rpx);
    opacity: 0;
  }
}

@keyframes clawd-race-bridge-exit-right {
  0%,
  24.45% {
    transform: translateX(0);
    opacity: 0.44;
  }
  26.89% {
    transform: translateX(3rpx);
    opacity: 0.44;
  }
  29.34% {
    transform: translateX(13rpx);
    opacity: 0.44;
  }
  31.78% {
    transform: translateX(29rpx);
    opacity: 0.44;
  }
  34.23% {
    transform: translateX(51rpx);
    opacity: 0.44;
  }
  36.67% {
    transform: translateX(80rpx);
    opacity: 0.44;
  }
  71.39% {
    transform: translateX(534rpx);
    opacity: 0.44;
  }
  73.35%,
  100% {
    transform: translateX(560rpx);
    opacity: 0;
  }
}
```

Set bridge-only exit classes to `animation-timing-function: linear`. Use
`clawd-scene-motion--race-bridge-exit-left/right` only when the step kind
is `bridge-exit` and the mode is Racing. This lets Clawd board at the activity
anchor, drive fully beyond the edge by 3000ms, and perform all disembark frames
off-screen. Its paired bridge entry then uses the corrected Racing entry route
from the opposite edge at the same height. The existing
`clawd-scene-motion--race-exit-left/right` and its 8.07% / 85.57% / 89.73%
keyframes remain byte-for-byte unchanged for final standalone Racing exits.

Keep the existing off-screen callback source restart between bridge exit and
entry. It guarantees the paired entry restarts at frame 0, boards outside,
enters only after 1000ms, disembarks at the center, and continues actions.

### 2. Add rowing arrival and boat→standing outro

Create
`miniprogram/assets/images/timetable-theme-clawd-rowing-outro.gif` from the
fully composited frames of
`miniprogram/assets/images/timetable-theme-clawd-rowing-intro.gif` in reverse
display order, with canonical endpoint substitution.

The execution audit found two real source discrepancies that the earlier
metadata-only audit could not see:

- normalized intro frame 13 is not the normalized rowing frame 0
  (`9,610` RGBA pixels differ; alpha bounds are `54,40,244,185` versus
  `48,35,239,185`);
- normalized intro frame 0 and standardized Walking frame 0 share the same
  bounds but differ by 60 RGBA pixels, including 40 alpha pixels;
- normalized original Persona `ac0fa108.gif` frame 26 does equal standardized
  rowing frame 0 pixel-for-pixel.

A literal 14-frame reversal would therefore preserve a visible jump at both
handoffs. Build the 14-frame outro as: canonical standardized rowing frame 0,
then reversed intro composited frames 12 through 1, then canonical
standardized Walking frame 0. This replaces only the two inaccurate endpoint
frames; the middle 12 frames retain the strict reverse transformation.

Asset requirements:

- 275×185, 14 frames, transparency retained, no Netscape loop extension;
- total duration remains exactly 2170ms;
- reverse the paired frame delays as well as the composited RGBA frames:
  `[90,80,80,90,80,80,170,170,500,160,90,160,90,330]` milliseconds;
- first composited RGBA frame is the canonical replacement and must equal
  frame 0 of
  `timetable-theme-clawd-rowing.gif` pixel-for-pixel;
- middle frames 1–12 must equal intro composited frames 12–1 respectively;
- final composited RGBA frame is the canonical replacement and must equal
  frame 0 of
  `timetable-theme-clawd-walking.gif` pixel-for-pixel;
- the final 330ms standing frame is the baseline handoff dwell; do not append
  another 80ms or loop the outro;
- use nearest-neighbor/no rescaling and do not modify the existing rowing intro
  or rowing loop assets.

Add the `"rowing-outro"` scene and exact 2170ms source/stage duration.

Add 1840ms linear bidirectional rowing-entry routes, mirroring only the inner
media:

```css
@keyframes clawd-row-enter-left {
  0% {
    transform: translateX(-560rpx);
    opacity: 0;
  }
  7.65% {
    transform: translateX(-460rpx);
    opacity: 0.44;
  }
  95.65%,
  100% {
    transform: translateX(0);
    opacity: 0.44;
  }
}

@keyframes clawd-row-enter-right {
  0% {
    transform: translateX(560rpx);
    opacity: 0;
  }
  7.65% {
    transform: translateX(460rpx);
    opacity: 0.44;
  }
  95.65%,
  100% {
    transform: translateX(0);
    opacity: 0.44;
  }
}
```

The row loop completes at 1760ms (`95.65%`) and holds the matching boat frame
for the existing 80ms margin. Then switch directly, without clearing, to the
non-looping reversed outro at the same anchor and facing. The outro transforms
the boat into the shared standing baseline and is immediately followed by the
normal 1–3 action block.

Expand the shuffled arrival bag to:

```ts
const CLAWD_WEIGHTED_ARRIVALS = [
  "lurking",
  "walking",
  "walking",
  "racing",
  "rowing",
] as const;
```

Every complete five-arrival bag contains one Lurking, two Walking, one Racing,
and one Rowing arrival. Direct arrivals remain 80%; Lurking stays occasional.
Rowing is an arrival option but not a bridge mode. Existing terminal rowing
departure remains unchanged.

Rowing arrival step grammar:

```text
rowing entry from selected edge (1840ms)
→ rowing-outro anchored at same height/facing (2170ms, no loop)
→ 1–3 anchored actions
```

## Repo conventions to follow

- Keep the fixed 360×242 stage, one GIF, one cancellable timeout, one runtime
  journey, and the existing 80ms margins where specified.
- Route motion remains CSS keyframes on `.clawd-scene-stage`; direction
  mirroring remains only on `.clawd-scene-media--mirrored`.
- Animate only `transform` and `opacity`.
- Final standalone Racing departure retains the existing strong
  `cubic-bezier(0.77, 0, 0.175, 1)`. Racing entry and bridge-only exit use
  linear timing plus the exact distance samples above to express respectively
  constant-speed→deceleration and acceleration→constant-speed motion. Rowing
  travel remains linear.
- All media changes occur either on a shared exact frame at the same anchor or
  while the previous stage is fully off-screen.
- Reduced motion renders only the static idle SVG and never schedules these
  routes.

## Steps

1. Decode/composite the 14 normalized rowing-intro frames, reverse their paired
   delays, construct the RGBA sequence as canonical rowing frame 0 + reversed
   intro frames 12–1 + canonical Walking frame 0, and save the standardized
   non-looping rowing-outro asset with the exact requirements above. Do not
   install a package; use the already available image runtime. If a Python
   package is unexpectedly required, follow AGENTS.md and use `uv` in an
   isolated venv.
2. Update `miniprogram/pages/timetable/index.ts` scene/arrival types, arrival
   bag, exact outro duration/source, and arrival construction. A Rowing arrival
   must append row-enter then rowing-outro at one position/media class before
   its action block.
3. Make `clawdTravelJourneyStep` (or a narrow replacement helper) choose the
   new Racing bridge-exit motion prefix only for Racing `bridge-exit` steps.
   Keep Racing final `exit` on the original prefix. Do not add Rowing to the
   bridge travel mode.
4. Update `miniprogram/pages/timetable/index.wxss`: replace Racing entry
   markers with the constant-speed/deceleration samples, add two bridge-only
   acceleration/constant-speed exit routes, and add two Rowing entry routes.
   Racing entry/bridge classes must be linear; final Racing remains on its
   existing curve. Leave final Racing exit, Rowing final exit, Lurking,
   Walking, action, and anchor keyframes unchanged.
5. Extend `scripts/check-timetable.js`:
   - require the Racing source frame starts to include 1000ms, 3000ms, and
     3080ms and bind CSS markers to 24.45%, 28.61%, 71.39%, and 73.35%;
   - require both corrected Racing entries and both bridge-only exits with the
     exact transforms/opacity samples above and linear class timing;
   - calculate segment velocities from the exact keyframes and require Racing
     entry to remain constant before monotonically decelerating to zero, while
     bridge Racing monotonically accelerates before remaining constant and
     never decelerating before it is off-screen;
   - retain exact assertions proving final Racing exit still uses
     8.07% / 85.57% / 89.73% and never uses a bridge-only class;
   - require bridge Racing steps to use `race-bridge-exit-*`, followed by an
     opposite-edge `race-enter-*` at the same anchor and off-screen restart;
   - require direct Racing arrivals to use the corrected `race-enter-*`;
   - require the rowing-outro dimensions, 14 frames, exact reversed delays,
     2170ms, transparency, and no loop extension;
   - decode composited RGBA frames (or use the existing equivalent decoder)
     and prove outro frame 0 equals rowing frame 0, outro frames 1–12 equal
     intro frames 12–1, and outro final frame equals standardized Walking frame
     0 pixel-for-pixel;
   - update deterministic production-scheduler coverage to at least 200
     passages; every complete five-arrival bag must sort to
     `lurking,racing,rowing,walking,walking`, all four arrival modes must occur,
     direct arrivals must be exactly 80%, and no arrival run may exceed two;
   - prove every Rowing arrival is `row-enter-* → rowing-outro → action block`
     at the same position/media class, with neither restart nor blank step;
   - retain bridge counts/modes, action blocks, direction bounds, departure
     bags, terminal rowing, one-GIF, restart guard, cancellation, and reduced
     motion assertions.
6. Update plan 006 and `plans/README.md` to DONE with exact execution notes.
   Leave the diff uncommitted for the animation review; the approved result
   will amend the current frontend commit.

## Boundaries

- Do not change final standalone Racing exit keyframes or route selection.
- Do not show any Racing entry before the 1000ms fully-boarded point or leave a
  bridge Racing stage visible at/after the 3080ms disembark point. Entry visible
  motion may only be constant-speed then deceleration; bridge exit motion may
  only be acceleration then constant-speed, never deceleration.
- Do not add Rowing to cross-edge bridges; add it only to arrival and retain it
  as an existing terminal departure.
- Do not modify the current rowing intro/loop, Walking, Lurking, action GIFs,
  course/theme/menu code, fixed stage size, opacity range, or random quiet
  interval.
- Do not add simultaneous images, a second timeout, rAF, `setInterval`, fixed
  vignette arrays, runtime reversal, or a new dependency.
- If audited source frame timestamps or the revised canonical/middle-frame
  pixel matches differ, stop and report rather than choosing new thresholds
  silently.

## Execution notes

- Replaced the superseded shared ease-in-out vehicle curve with distinct
  piecewise-linear profiles. The derived entry speeds are approximately
  `317.65, 320.30, 290, 220, 160, 100, 30, 0rpx/s`; bridge-exit speeds are
  approximately `30, 100, 160, 220, 290, 319.72, 325rpx/s`. Regression checks
  read these samples back from the production WXSS, verify the constant-speed
  plateaus within rounding tolerance, and enforce the required monotonic
  deceleration/acceleration rather than checking marker presence alone.
- Audited the normalized Racing source at 1000ms, 3000ms, and 3080ms, then
  moved direct/bridge entry visibility to 24.45% / 28.61% / 73.35% and added
  bridge-only exits at 24.45% / 71.39% / 73.35%. The final standalone Racing
  exit blocks remain byte-for-byte identical to plan 005.
- Generated the 275×185 non-looping Rowing outro with 14 frames and the exact
  reversed 2170ms delay sequence. Its canonical first/final frames match the
  standardized Rowing/Walking baselines, while frames 1–12 match composited
  intro frames 12–1 pixel-for-pixel.
- Added bidirectional 1840ms Rowing arrival routes and the anchored 2170ms
  outro handoff. The arrival bag now contains one Lurking, two Walking, one
  Racing, and one Rowing draw; bridge modes remain Walking/Racing only.
- Expanded the seeded scheduler regression to 200 passages and added exact
  source-frame, CSS-marker, numeric velocity, final-Racing hash, Rowing
  grammar, delay, loop, transparency, and composited-frame assertions.

## Verification

- **Mechanical**: run typecheck, `check:timetable`, `check:wxml`,
  `check:schedule`, the full Skyline WXSS check, and `git diff --check`. Run the
  full frontend check and report unrelated existing baseline failures
  separately.
- **Asset check**: verify rowing-outro is 275×185, 14 frames, 2170ms,
  transparent, non-looping, has the exact reversed delays, satisfies both
  canonical RGBA endpoint equalities, and preserves the 12 reversed middle
  frames pixel-for-pixel.
- **Feel check**: inspect both directions at slow speed and confirm:
  - direct/bridge Racing stays completely off-screen during boarding;
  - only the fully seated car crosses into view;
  - bridge Racing accelerates at the anchor, then holds constant speed through
    the edge with no visible deceleration;
  - Racing entry crosses the edge at constant speed and only decelerates near
    the activity anchor; it never accelerates while visible;
  - Racing reaches the central anchor before any disembark frame;
  - bridge Racing is fully invisible before disembarking and never appears to
    stop/get out at the screen edge;
  - final standalone Racing exit is visually unchanged;
  - a bridge can drive off one side, invisibly reset, enter from the opposite
    side at the same height, disembark centrally, and continue actions;
  - Rowing can sail in from either side, reach the anchor, transform smoothly
    from boat to standing, and continue actions without a flash or scale jump;
  - reduced motion remains static and the timetable remains fully interactive.
- **Done when**: Racing edge handoffs contain no visible boarding/disembarking,
  final Racing exits remain unchanged, and Rowing joins the arrival vocabulary
  with exact boat→standing continuity.
