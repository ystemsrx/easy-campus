# 007 — Place Clawd in adaptive free space

- **Status**: DONE
- **Commit**: 2eaf03a
- **Severity**: HIGH
- **Category**: Spatial continuity, purpose, and composition
- **Estimated scope**: 4 source/check files, about 450 lines

## Problem

The continuous Clawd journey now has varied arrival, action, bridge, and
departure grammar, but its resting geometry is still selected from six fixed
edge/anchor pairs. Every anchor is horizontally centered and only three
vertical levels exist:

```ts
/* miniprogram/pages/timetable/index.ts:114,226 — current */
type TimetableClawdAnchor = "upper" | "middle" | "lower";

const CLAWD_ANCHORS: readonly TimetableClawdAnchor[] = [
  "upper",
  "middle",
  "lower",
];
const CLAWD_EDGES: readonly TimetableClawdEdge[] = ["left", "right"];
const CLAWD_ENTRY_POINTS: readonly TimetableClawdEntryPoint[] =
  CLAWD_EDGES.flatMap((edge) =>
    CLAWD_ANCHORS.map((anchor) => ({ edge, anchor })),
  );
```

```css
/* miniprogram/pages/timetable/index.wxss:173 — current */
.clawd-scene--journey-upper,
.clawd-scene--journey-middle,
.clawd-scene--journey-lower {
  left: 50%;
  margin-left: -180rpx;
}

.clawd-scene--journey-upper {
  top: 16%;
}

.clawd-scene--journey-middle {
  top: 42%;
}

.clawd-scene--journey-lower {
  bottom: 9%;
}
```

`drawClawdEntryPoint` shuffles those six values without considering the
currently displayed courses. Clawd therefore repeatedly stops on the center
axis and may stop behind a dense group of course cards even when a much more
open part of the current week is available. The timetable deliberately keeps
the ambient layer behind the interactive grid, so overlap makes the animation
look cut apart rather than merely decorative.

Simply changing `left` and `top` is unsafe. All route keyframes currently use
fixed center-derived distances such as `-470rpx` and `-560rpx`. Once the
resting point moves away from the center, a near-edge route would travel too
far while a far-edge route could start or finish visibly on screen. Lurking's
`±195rpx` hold would also reveal only the wrong slice of the character.

## Target

Replace the fixed three-anchor model with one two-dimensional stop point per
complete journey. Generate a 7×7 lattice over the usable timetable body,
apply a small continuous phase offset, score each candidate against the actual
course rectangles for the visible week, and randomly choose among the six
least-obstructed candidates. Entry direction is drawn independently. Every
step and bridge within that journey retains the exact same position; a new
position is chosen only after the final departure has completed off-screen.

This produces all of the following together:

- Clawd is no longer centered by default;
- vertical positions are continuous and are not visibly limited to upper,
  middle, and lower bands;
- sparse parts of the current week are strongly preferred without making the
  motion deterministic;
- switching weeks affects only the next journey and never teleports an active
  scene;
- Lurking still reveals its complete half-body at either viewport edge;
- Walking, Racing, and Rowing remain fully off-screen at route endpoints from
  every allowed resting position;
- Plan 006's Racing velocity shapes remain intact after scaling each route to
  its actual distance.

### 1. Use exact timetable-space geometry

Represent positions in the page's logical 750rpx coordinate space. Define:

```ts
const CLAWD_STAGE_WIDTH_RPX = 360;
const CLAWD_STAGE_HEIGHT_RPX = 242;
const CLAWD_GRID_LEFT_RPX = 74;
const CLAWD_GRID_WIDTH_RPX = 666;
const CLAWD_GRID_HEAD_RPX = 84;
const CLAWD_STOP_COLUMN_COUNT = 7;
const CLAWD_STOP_ROW_COUNT = 7;
const CLAWD_STOP_POOL_SIZE = 6;
const CLAWD_STOP_X_RANGE_RPX = [170, 580] as const;
const CLAWD_STOP_X_PHASE_RPX = 22;
const CLAWD_STOP_CORE_BOUNDS = [71, 46, 319, 242] as const;
const CLAWD_STOP_HALO_BOUNDS = [12, 26, 338, 242] as const;
const CLAWD_STOP_HALO_WEIGHT = 0.22;
```

The core bounds are the conservative parked-action alpha union inside the
normalized 360×242 stage. The halo bounds include the wider/taller vehicle
poses. Course overlap inside the core receives full weight; overlap that is
only in the vehicle halo receives `0.22` weight.

Build layout coordinates from the same values already used to render the
grid:

```ts
const scale = metrics.scale; // physical pixels per rpx
const headerHeightRpx = headerHeightPx / scale;
const gridTopRpx = headerHeightRpx + CLAWD_GRID_HEAD_RPX;
const rowHeightRpx = metrics.rowHeightPx / scale;
const gridBottomRpx = gridTopRpx + rowHeightRpx * maxPeriod;
const minimumBaselineRpx = Math.min(
  gridBottomRpx - 12,
  gridTopRpx + (CLAWD_STAGE_HEIGHT_RPX - CLAWD_STOP_CORE_BOUNDS[1]),
);
const maximumBaselineRpx = Math.max(minimumBaselineRpx, gridBottomRpx - 12);
```

The stop point is Clawd's baseline. Stage placement is:

```ts
stageLeftRpx = centerXRpx - CLAWD_STAGE_WIDTH_RPX / 2;
stageTopRpx = baselineYRpx - CLAWD_STAGE_HEIGHT_RPX;
```

Create seven horizontal samples evenly from `170rpx` through `580rpx` and
seven baseline samples evenly from `minimumBaselineRpx` through
`maximumBaselineRpx`. On each new journey, draw one horizontal phase from the
closed range `[-22, 22]rpx`. Draw one vertical phase from:

```ts
[-Math.min(26, rowHeightRpx * 0.35), Math.min(26, rowHeightRpx * 0.35)];
```

Apply those phases to all lattice coordinates and clamp them to their
respective safe ranges. Round final `left`, `top`, and route-variable values to
two decimals. The phase changes on every journey, so even choosing the same
lattice cell later does not recreate one of seven obvious horizontal or
vertical rails.

### 2. Score actual visible-course rectangles

Use `visibleCourses`, the current `periodRows.length`, the current
`headerHeight`, and `timetableGridLayoutMetrics` only when a new journey is
built. Do not query the DOM and do not cache a score across week changes.

For each current-week course, clamp `periodStart`/`periodEnd` to
`1..maxPeriod` and construct its rendered rectangle:

```ts
const dayWidthRpx = CLAWD_GRID_WIDTH_RPX / 7;
const courseLeftRpx = CLAWD_GRID_LEFT_RPX + (course.weekday - 1) * dayWidthRpx;
const courseRightRpx = courseLeftRpx + dayWidthRpx;
const courseTopRpx =
  gridTopRpx +
  (periodStart - 1) * rowHeightRpx +
  metrics.courseTopInsetPx / scale;
const courseBottomRpx =
  courseTopRpx +
  (periodEnd - periodStart + 1) * rowHeightRpx +
  (periodEnd < maxPeriod ? metrics.courseHeightExtensionPx / scale : 0);
```

For a candidate stage, translate the core and halo bounds by
`stageLeftRpx/stageTopRpx`. Calculate ordinary rectangle-intersection area.
For each course add:

```ts
coreOverlap + Math.max(0, haloOverlap - coreOverlap) * CLAWD_STOP_HALO_WEIGHT;
```

to the candidate's obstruction score. Invalid weekdays and non-finite period
values are ignored rather than poisoning the selection.

Shuffle the 49 scored candidates before performing a stable ascending score
sort, so equal-score candidates do not favor a particular row or column.
Take the first six candidates, discard the planner's immediately previous
lattice cell when another candidate is available, then choose uniformly from
the remainder. Store the selected cell key in the planner. On a completely
empty week every lattice cell is equally eligible over time; on a dense week
selection remains random but is confined to the six best available places.

Do not interrupt an active journey when `visibleCourses` changes. The runtime
must read the latest courses only inside the existing
`if (!clawdActiveJourney)` branch; the next journey adopts the new layout.

### 3. Decouple random entry direction from the stop point

Remove `TimetableClawdAnchor`, `TimetableClawdEntryPoint`,
`CLAWD_ANCHORS`, `CLAWD_ENTRY_POINTS`, `entryPointBag`, `lastEntryKey`, and
`clawdAnchorPositionClass`. Add a separate entry-edge draw with independent
planner state:

```ts
lastEntryEdge: TimetableClawdEdge | "";
entryEdgeRunLength: number;
lastStopCellKey: string;
```

Use the same maximum-two rule already used for exit direction: a side may
repeat once, but a third consecutive use is forced to the other side. Do not
use a two-value shuffle bag, because that degenerates into strict left/right
alternation. Entry edge and the adaptive stop point are independent draws.

Change `TimetableClawdJourney.entryAnchor` to `stopPoint`, and change every
step's `positionClass` to one `positionStyle` string. The style is identical
for arrival, action blocks, every same-position cross-edge bridge, farewell,
and final departure within the journey. The off-screen restart guard compares
`positionStyle`, not the removed class.

### 4. Derive edge-safe route variables from the chosen x position

Inline the stage style in WXML:

```xml
<view
  wx:if="{{clawdSceneSrc}}"
  class="clawd-scene-stage {{clawdSceneMotionClass}}"
  style="{{clawdScenePositionStyle}}"
>
```

The style begins with the computed `left` and `top`, then declares the signed
custom properties below. Use `var(--name, <current-center-value>)` fallbacks in
WXSS. Existing page-level theme variables prove that inline custom properties
are supported; the full Skyline check must additionally prove they remain
valid inside `transform: translateX(var(...))` keyframes before this plan is
marked DONE.

Walking endpoints are based on the normalized Walking alpha bounds and retain
the current center values when `centerXRpx === 375`:

```ts
walkLeftFar = -(centerXRpx + 95); // center: -470
walkRightFar = 845 - centerXRpx; // center:  470
walkLeftReveal = walkLeftFar * (414 / 470);
walkRightReveal = walkRightFar * (414 / 470);
walkLeftNear = walkLeftFar * (390 / 470);
walkRightNear = walkRightFar * (390 / 470);
lurkLeftHold = 180 - centerXRpx; // center: -195
lurkRightHold = 570 - centerXRpx; // center:  195
```

Use the far Walking values for Walking and Lurking hidden endpoints. The hold
values place the outer stage edge exactly at the viewport edge, so the entire
half-body Lurking animation is visible from either direction at every x.

The Racing/Rowing union requires a wider vehicle endpoint:

```ts
vehicleLeftFar = -(centerXRpx + 185); // center: -560
vehicleRightFar = 935 - centerXRpx; // center:  560
```

Precompute signed vehicle offsets at these exact ratios for both left and
right endpoints, rounding only the final rpx value:

```ts
const CLAWD_VEHICLE_ROUTE_RATIOS = {
  tiny: 3 / 560,
  small: 13 / 560,
  medium: 29 / 560,
  easing: 51 / 560,
  decelStart: 80 / 560,
  raceExitNear: 430 / 560,
  rowNear: 460 / 560,
  raceEntryReveal: 506 / 560,
  raceBridgeNearEdge: 534 / 560,
} as const;
```

Replace literal horizontal translations only; retain every Plan 006
percentage, opacity, duration, fill mode, and timing function:

- Walking entry/exit use far, reveal, and near Walking variables;
- Lurking uses far Walking variables and the computed edge-hold variables;
- Racing entry uses vehicle far plus `raceEntryReveal`, `decelStart`,
  `easing`, `medium`, `small`, and `tiny`;
- bridge-only Racing exit uses `tiny`, `small`, `medium`, `easing`,
  `decelStart`, `raceBridgeNearEdge`, and vehicle far;
- final standalone Racing exit retains its strong curve and
  `8.07% / 85.57% / 89.73%` timing, but its `430/560` literal distances become
  `raceExitNear/vehicleFar` variables so it can still leave from an off-center
  stop;
- Rowing entry/exit uses `rowNear/vehicleFar` variables.

This plan intentionally supersedes Plan 006's byte-for-byte WXSS block hash
for final Racing distance declarations. It preserves that route's scene,
keyframe percentages, opacity, and `cubic-bezier(0.77, 0, 0.175, 1)` behavior;
only the signed distance is scaled to the selected resting x coordinate.

For Racing entry and bridge-only exit, the ratios preserve the exact normalized
piecewise-linear physics from Plan 006. Tests must calculate position divided
by the journey's actual far distance before checking constant-speed →
deceleration and acceleration → constant-speed shapes. Do not replace these
profiles with a generic easing curve.

### 5. Preserve one stable point for a whole journey

Add `clawdScenePositionStyle` to page data with a safe centered fallback style.
When the existing scheduler mounts a step it sets source, position style,
motion class, and media class in one `setData`. Do not clear or recompute the
position between ordinary adjacent steps. During a same-source bridge restart,
source/motion/media may still be cleared while fully off-screen, but the
position style remains unchanged and is restored verbatim by the next mount.

The active journey's point is immutable. Actions must never drift; cross-edge
bridges re-enter at the same x and exact same height; a week swipe does not move
an already visible character. Only the existing final off-screen completion
sets `clawdActiveJourney = null`, after which the next build can choose a new
adaptive point.

## Repo conventions to follow

- Reuse `timetableGridLayoutMetrics`; it is the authoritative row-height,
  inset, extension, and scale calculation used by course rendering.
- Keep the existing fixed 360×242 media stage, one GIF, one cancellable
  timeout chain, inner-media-only mirroring, 0.38/0.44 opacity, and reduced
  motion static fallback.
- Route animation stays on `transform` and `opacity`. Static `left`/`top` are
  assigned once per journey and are never animated.
- Keep course cards above the ambient layer and preserve `pointer-events:
none`; adaptive positioning must not affect timetable interaction.
- Use deterministic pure helpers for lattice generation, rectangle overlap,
  selection, and route-style generation so `scripts/check-timetable.js` can
  load and exercise production logic.

## Steps

1. Update `miniprogram/pages/timetable/index.ts` types and planner state:
   remove three-anchor/entry-point state, add stop geometry/types, independent
   entry-edge run state, and `lastStopCellKey`.
2. Add pure geometry helpers using the exact 750rpx grid constants, 7×7
   phase-shifted lattice, rendered course rectangles, weighted core/halo
   overlap, top-six selection, and immediate-cell-repeat avoidance.
3. Add the exact route-variable style builder. Keep ratios signed by
   multiplying each left/right far offset; format finite values to two
   decimals and provide a centered fallback style.
4. Change `buildClawdJourney` to receive the current stop-layout input and
   random source. Draw stop point and entry edge independently, store the one
   style on all steps, and keep every bridge at that exact style.
5. In `playClawdSceneStep`, build stop-layout input from `visibleCourses`,
   current `periodRows.length`, current `headerHeight`, and
   `timetableGridLayoutMetrics` only when there is no active journey. Change
   mount/restart state and equality guards from position class to style.
6. Update `miniprogram/pages/timetable/index.wxml` to bind the position style
   on the one stage element and remove `clawdScenePositionClass`.
7. Update `miniprogram/pages/timetable/index.wxss`: remove the three fixed
   anchor selectors; give the base stage a safe center fallback; replace every
   literal Lurking/Walking/Racing/Rowing horizontal translation with the exact
   custom property and fallback described above. Do not change percentages,
   opacity, timing, or scene sizes.
8. Extend `scripts/check-timetable.js` with pure production-helper tests:
   - an empty 12-period week over at least 210 journeys reaches all seven
     lattice rows and all seven columns, produces at least 30 distinct rounded
     x coordinates and 30 distinct rounded y coordinates, and never repeats
     the same cell immediately when alternatives exist;
   - entry edges include both same-side repetitions and side changes, but no
     run exceeds two, proving they are random rather than strict alternation;
   - synthetic courses filling the upper half make every selected candidate's
     score no greater than the sixth-lowest score and favor the open lower
     area; a complementary lower-half fixture favors the upper area;
   - a fixture with one dense weekday/period rectangle calculates the exact
     rectangle intersection and core/halo score;
   - changing the course fixture changes the next built journey but cannot
     mutate a previously returned journey/style;
   - every step of a journey, including all bridge pairs, has one byte-equal
     position style and the restart guard compares that style;
   - all selected stage centers remain within `170±22..580±22`, all baselines
     remain within their safe grid range, and every computed variable is
     finite;
   - for x=`150`, `375`, and `600`, decoded route variables place the relevant
     Walking and vehicle alpha unions fully past both screen edges;
   - x=`375` reproduces all previous literal route offsets exactly;
   - normalized Racing entry/bridge velocities retain Plan 006's monotonic
     profiles at x=`150`, `375`, and `600`;
   - final Racing retains the original percentages and strong curve while its
     endpoint uses the adaptive variable;
   - WXML contains one GIF and one bound stage style; no extra timer, DOM
     query, rAF, or `setInterval` is added.
9. Retain all Plan 006 Rowing asset/pixel tests and the complete 200-passage
   grammar coverage. Update assertions that referenced anchors, entry-point
   bags, fixed transforms, or the superseded final-Racing block hash without
   weakening scene/timing/continuity coverage.
10. Update this plan and `plans/README.md` to DONE with measured verification
    results. Leave source changes uncommitted for the final animation review;
    after approval, amend the existing frontend commit.

## Boundaries

- Do not position from a DOM query, screenshot, rendered pixel scan, or timer;
  current-week course data and the shared render metrics are authoritative.
- Do not move the stage during an active journey or change position between a
  bridge exit and its paired entry.
- Do not animate `left`, `top`, width, height, margin, or layout properties.
- Do not let adaptive positioning change GIF source time, route percentages,
  opacity, duration, media mirroring, or action/departure distributions.
- Do not add Rowing to bridges or alter the new Rowing outro asset.
- Do not alter course-card layout, z-index, theme colors, menu behavior,
  background assets, or the unrelated modified
  `miniprogram/assets/images/timetable-theme-clawd-background.jpg`.
- Do not add simultaneous images, a second timeout, rAF, `setInterval`, a new
  dependency, or a continuous physics loop.
- If Skyline rejects `var()` inside keyframe transforms, stop and report the
  exact diagnostic. Do not silently fall back to visible fixed-distance
  endpoints or animating layout properties.

## Execution notes

- Verified the Skyline capability gate with an isolated longhand-animation
  probe containing `transform: translateX(var(--probe-x, 12rpx))`; the full
  WXSS compiler returned `error_count: 0`. The temporary probe was removed
  before implementation.
- Replaced the six fixed edge/anchor entries with independent entry-edge
  draws and one immutable adaptive stop point per journey. A deterministic
  420-journey empty-week regression reached all 49 lattice cells, covered all
  seven rows and columns, produced more than 30 rounded values on each axis,
  allowed both same-side and changed-side entries, and never exceeded a
  two-entry same-side run.
- Added exact rendered-course rectangles, core/halo weighted overlap, shuffled
  stable top-six selection, immediate-cell-repeat avoidance, and continuous
  horizontal/vertical phase offsets. Eighty upper-dense and eighty
  lower-dense draws remained within the six least-obstructed candidates and
  consistently favored the open half; a single-course fixture locks the exact
  rectangle and weighted intersection score.
- Bound one two-decimal `positionStyle` to the fixed 360×242 stage for every
  step in a journey. Walking, Lurking, Racing, and Rowing keyframes now consume
  signed route variables with their prior centered values as fallbacks;
  `x=150/375/600` endpoint checks prove both alpha-union classes leave the
  viewport, while `x=375` reproduces every previous literal distance.
- Preserved Plan 006's Racing percentages and timing functions. Six decoded
  direction/position profiles verify normalized constant-speed→deceleration
  entries and acceleration→constant-speed bridge exits after two-decimal
  route scaling; final Racing retains its strong departure curve.
- Retained the complete 200-passage grammar suite, Rowing RGBA asset checks,
  one GIF, one timeout chain, off-screen restart guard, pointer transparency,
  and reduced-motion fallback. Current-week course data and shared render
  metrics are read only when no journey is active.

## Verification

- **Mechanical**: run `node --check scripts/check-timetable.js`,
  `npm run typecheck`, `npm run check:timetable`, `npm run check:wxml`,
  `npm run check:schedule`, the full `npm run check:wxss`, and
  `git diff --check`. Run the full `npm run check`; report the known unrelated
  `check:pet` and `project.private.config.json` LF baselines separately if they
  remain.
- **Geometry check**: inspect deterministic empty, upper-dense, lower-dense,
  and single-course fixtures. Confirm only top-six obstruction candidates are
  selected, all 49 cells remain available on an empty week, and route endpoints
  hide their full relevant alpha bounds at x 150/375/600.
- **Feel check**: inspect several complete passages and confirm:
  - parked actions appear at visibly different horizontal and vertical points,
    not on a center axis or three repeated bands;
  - dense course clusters are avoided when open space exists elsewhere;
  - sparse near-ties still look random rather than cycling through positions;
  - a passage never slides or snaps between its own actions;
  - Walking, Racing, Rowing, and Lurking enter/leave cleanly from both sides at
    far-left and far-right stop points;
  - bridge exit/re-entry remains at one exact height and stop coordinate;
  - Racing bridge exit still accelerates then stays constant, entry stays
    constant then decelerates, and final Racing retains its stronger departure;
  - course cards remain readable, tappable, and visually above the animation;
  - reduced motion remains a static idle SVG.
- **Done when**: Clawd chooses continuously varied two-dimensional positions
  from the six least-obstructed current-week candidates, retains one immutable
  point per journey, and every edge route remains fully hidden and physically
  continuous from all allowed positions.
