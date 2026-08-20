# 005 — Compose continuous randomized Clawd passages

- **Status**: DONE
- **Commit**: 4d7805b
- **Severity**: HIGH
- **Category**: Purpose, cohesion, physicality, and timing
- **Estimated scope**: 4 source/check files, 1 derived GIF asset, about 500 lines

## Problem

The current runtime randomizes actions and departures, but every visible
journey still has one recognizable grammar:

```ts
/* miniprogram/pages/timetable/index.ts:485 — current */
const steps: TimetableClawdJourneyStep[] = [
  clawdJourneyStep("lurking", "lurking" /* ... */),
  clawdJourneyStep("emerge", "walking" /* ... */),
];
// one or two actions
// optional farewell
// exactly one final walking / racing / rowing exit
```

After that final exit, `playClawdSceneStep` clears the source, waits for the
quiet interval, and builds another journey. Therefore the randomized contents
still read as repeated `peek → act → leave` cycles. There is no direct walking
or Racing Car arrival, and there is no continuous same-height wrap such as
driving off one edge, immediately driving in from the opposite edge, stopping,
and continuing with another action.

Walking also crosses the route in the original login asset's 1660ms cycle:

```ts
/* miniprogram/pages/timetable/index.ts:159 — current */
const CLAWD_WALKING_SOURCE_DURATION_MS = 1660;
const CLAWD_WALKING_DURATION_MS =
  CLAWD_WALKING_SOURCE_DURATION_MS + CLAWD_BASELINE_HANDOFF_MS;
```

Merely lengthening the 1740ms CSS animation would end on a non-baseline GIF
frame and reintroduce the handoff jump that plans 001 and 003 removed.

## Target

Keep one GIF, one cancellable timeout, the fixed 360×242 stage, three vertical
anchors, and shared-baseline handoffs. Replace the single mandatory grammar
with a runtime-composed passage containing a randomized arrival, one or more
action blocks, zero to two optional cross-edge bridges, and a final departure.

### 1. Slightly slower walking without frame drift

Create
`miniprogram/assets/images/timetable-theme-clawd-walking.gif` from
`miniprogram/assets/login/crabwalking.gif` by changing only GIF Graphic Control
Extension delays:

- source: 20 frames, 275×185, 1660ms, delays
  `[8,9,8,8,9,8,8,9,8,8,9,8,8,9,8,8,9,8,8,8]` centiseconds;
- target: replace every `8cs` with `9cs` and every `9cs` with `10cs`, yielding
  `[9,10,9,9,10,9,9,10,9,9,10,9,9,10,9,9,10,9,9,9]` and exactly 1860ms;
- preserve all palette, image descriptor, compressed pixel, transparency,
  disposal, loop, dimensions, and frame-order bytes exactly.

Use the derived standardized timetable path for the `walking` scene. Set
`CLAWD_WALKING_SOURCE_DURATION_MS = 1860` and retain the 80ms baseline margin,
so `CLAWD_WALKING_DURATION_MS = 1940`.

Update walking routes from 1740ms to 1940ms. The lead baseline becomes
`370 / 1940 = 19.07%`; the source-loop handoff becomes
`1860 / 1940 = 95.88%`. Replace every walking `18.97%` marker with `19.07%`
and every walking `95.4%` marker with `95.88%`. Keep the existing 28% reveal
and 84% near-edge markers. This slows both the GIF cadence and route travel by
about 12% while still landing on the identical shared baseline.

### 2. Three randomized arrival modes

Add `TimetableClawdArrivalMode = "lurking" | "walking" | "racing"` and a
shuffled weighted arrival bag:

```ts
const CLAWD_WEIGHTED_ARRIVALS = [
  "lurking",
  "walking",
  "walking",
  "racing",
] as const;
```

Every complete four-draw bag therefore contains one Lurking arrival, two
direct Walking arrivals, and one direct Racing arrival. Refill safely so an
arrival mode never runs more than twice across a bag boundary; do not force
strict alternation.

Arrival construction:

- `lurking`: complete the existing Lurking peek/retract at the chosen edge,
  then use the slowed Walking entry from that same edge and anchor;
- `walking`: directly use the slowed Walking entry from the chosen edge;
- `racing`: directly use a new Racing entry route from the chosen edge and
  stop on the shared standing baseline at the anchor;
- every arrival is followed by an action block; Lurking is no longer a
  mandatory first step.

### 3. Racing entry routes

Add `clawd-scene-motion--race-enter-left` and `--race-enter-right`, both 4090ms
with the existing Racing source timing and
`cubic-bezier(0.77, 0, 0.175, 1)`. The source is standing during 0–330ms,
becomes the car during 330–3670ms, and returns to standing at 3670ms. Use these
exact keyframes:

```css
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

@keyframes clawd-race-enter-right {
  0%,
  8.07% {
    transform: translateX(560rpx);
    opacity: 0;
  }
  12.23% {
    transform: translateX(430rpx);
    opacity: 0.44;
  }
  89.73%,
  100% {
    transform: translateX(0);
    opacity: 0.44;
  }
}
```

This keeps the initial standing frame off-screen, reveals only after the car
exists, reaches the anchor before it returns to standing, and preserves the
80ms baseline margin for the next action.

### 4. Variable action blocks and same-height cross-edge bridges

Draw action-block sizes from a shuffled bag
`[1, 1, 2, 2, 3]`. Draw bridge counts from a separate shuffled bag
`[0, 0, 1, 1, 2]`. Draw bridge travel modes from
`["walking", "walking", "racing", "racing"]`, with no run longer than two
across refills and without strict Walking/Racing alternation.

Compose one passage as follows:

1. Draw one of the three arrival modes and one of the existing six
   edge+anchor entry points.
2. Append an action block of 1–3 no-adjacent actions from the existing action
   Fisher–Yates bag.
3. For each of the drawn 0–2 bridges:
   - draw Walking or Racing and an exit edge using the existing maximum-two
     same-side direction rule;
   - exit fully through that edge at the current anchor;
   - immediately re-enter from the opposite edge using the same travel mode,
     facing direction, and anchor; there is no quiet interval and no anchor
     change between the two steps;
   - stop on the shared standing baseline and append another independently
     drawn 1–3 action block.
4. Optionally append the existing 32% farewell only before the final
   departure, not before bridges.
5. Draw the final departure from the existing
   `[walking, walking, racing, rowing]` bag. Rowing retains its exact intro and
   remains terminal. Only this final departure is followed by the existing
   900–2800ms off-screen quiet interval.

The result must include passages such as:

```text
Racing enter left → action → Racing exit left
→ (off-screen source restart) Racing enter right at the same height
→ stop on baseline → two actions → Walking exit right
```

and also shorter direct Walking passages, occasional Lurking passages, and
zero-, one-, or two-bridge variants. Do not encode these as fixed vignette
arrays; assemble them at runtime from the draw bags.

### 5. Invisible same-source restart at bridge boundaries

A Walking exit followed by Walking entry, or Racing exit followed by Racing
entry, leaves `src` unchanged. Mini Program may continue the prior GIF phase
instead of restarting it. Add a boolean such as `restartOffscreen` to journey
steps and set it only on bridge entries.

Before applying such an entry, verify that the preceding step has
`exitOffscreen === true`; then clear `clawdSceneSrc`, motion class, and media
class in one `setData`, and mount the entry step in that callback. Do not add a
timer or quiet delay. The previous route is already at opacity 0 and ±470/560,
so this remount is invisible but restarts the GIF at frame 0 and keeps CSS and
media timing aligned. Never clear/remount between visible anchored actions.

## Repo conventions to follow

- The scheduler logic remains isolated between `type TimetableClawdSceneName`
  and `interface InFlightTimetableRequest` so `scripts/check-timetable.js` can
  load the production builder deterministically.
- Use Fisher–Yates; never use `sort(() => Math.random() - 0.5)`.
- Route transforms stay on `.clawd-scene-stage`; direction mirroring stays only
  on `.clawd-scene-media--mirrored`.
- Keyframes animate only `transform` and `opacity`. Static anchor classes may
  retain layout positions.
- The strong route curves remain
  `cubic-bezier(0.23, 1, 0.32, 1)` and
  `cubic-bezier(0.77, 0, 0.175, 1)`. Vehicle motion is explanatory decorative
  motion, so its native multi-second source duration is intentional rather
  than a UI-response delay.
- Reduced motion continues to render only the idle SVG and never starts the
  scheduler.

## Steps

1. Generate the slowed standardized Walking GIF by patching only the 20 GCE
   delay words as specified; do not re-encode image data.
2. Update `miniprogram/pages/timetable/index.ts` types, sources, exact walking
   duration, arrival/bridge/action-count bags, planner state, and passage
   builder. Keep `buildClawdJourney` if minimizing churn, but its output must
   implement the variable passage grammar above.
3. Add a small helper for Walking/Racing entry and exit step construction so
   directions, media mirroring, position classes, durations, and off-screen
   flags cannot drift between initial and bridge routes.
4. Update `playClawdSceneStep` to perform the callback-only off-screen source
   restart for bridge entries. Keep the one cancellable timeout/revision
   system intact.
5. Update `miniprogram/pages/timetable/index.wxss` with the 1940ms Walking
   timing/markers and both Racing entry keyframes. Do not change Lurking,
   action, Racing exit, or rowing geometry.
6. Extend `scripts/check-timetable.js`:
   - include the standardized Walking asset and require 275×185, 20 frames,
     transparency, loop metadata, 1860ms, and the same first-frame bounds as
     `crabwalking.gif`;
   - derive an expected buffer from `crabwalking.gif` by changing only 8cs→9cs
     and 9cs→10cs GCE delay words, then require byte-for-byte equality with the
     new asset;
   - require 1940ms, 19.07%, and 95.88% Walking routes and both Racing entry
     keyframes with the exact transforms/opacity above;
   - load the new production bags and simulate at least 120 deterministic
     passages;
   - for every complete four-arrival bag require sorted modes
     `lurking,racing,walking,walking`, all three modes overall, no arrival run
     above two, and at least 75% of passages entering without Lurking;
   - for every complete five bridge-count draws require sorted values
     `0,0,1,1,2`, and observe all three counts overall;
   - for every complete four bridge-mode draws require sorted values
     `racing,racing,walking,walking`, no mode run above two, and at least one
     adjacent same-mode pair so the system does not become strict alternation;
   - prove every initial arrival and every bridge entry is followed by 1–3
     actions with no adjacent repeated action;
   - prove every bridge exit is fully off-screen and is followed immediately
     by an opposite-edge, same-height, same-mode entry marked
     `restartOffscreen`, then an action; no quiet/null step may occur inside;
   - prove `restartOffscreen` is never set unless the preceding step is an
     off-screen exit, and statically verify runtime clearing is guarded by that
     relationship;
   - retain the final departure, rowing-terminal, direction-run, one-GIF,
     cancellation, and reduced-motion assertions.
7. Update this plan and `plans/README.md` to DONE with execution notes after
   verification. Leave source changes uncommitted for the animation review;
   the final approved diff will amend the current frontend commit.

## Boundaries

- Do not change Lurking's ±195rpx full-half-body hold, 5580ms duration, or
  complete retract.
- Do not change course data, colors, blocks, menus, other themes, companion
  behavior, or login-page assets.
- Do not re-encode or rescale Walking pixels; only the 20 frame delays change.
- Do not add simultaneous GIF layers, `setInterval`, rAF animation, a second
  live timeout, dependencies, or fixed vignette arrays.
- Do not clear a visible source or move a visible stage between anchors.
- Do not permit rowing as a bridge; it remains a terminal final departure.
- If GIF bytes, source timing, or current route markers differ from the audited
  values in this plan, stop and report rather than guessing.

## Execution notes

- Derived the standardized 275×185 Walking GIF by changing only the 20 audited
  GCE delay words. Its 20 frames now total 1860ms while all palette, compressed
  image, loop, transparency, disposal, and descriptor bytes remain identical.
- Replaced mandatory Lurking-first journeys with shuffled arrival, action-size,
  bridge-count, bridge-mode, entry-point, direction, and departure draws.
  Passages now support direct Walking/Racing arrivals and zero to two
  same-height cross-edge continuations without fixed vignette arrays.
- Bridge entries clear and remount their unchanged source only in the callback
  after the matching same-source bridge exit is fully off-screen. The existing
  single cancellable timeout, one-GIF stage, reduced-motion fallback, and final
  900–2800ms quiet interval remain unchanged.
- Updated Walking routes to 1940ms with exact 19.07% / 95.88% markers and added
  symmetric Racing entry routes. A seeded 160-passage regression verifies all
  complete bags, run limits, direct-arrival share, action blocks, bridge
  continuity/restarts, terminal rowing, exact media bytes, and route timing.

## Verification

- **Mechanical**: run typecheck, `check:timetable`, `check:wxml`,
  `check:schedule`, the full Skyline WXSS check, and `git diff --check`; all
  task-related checks must pass. Run the full frontend check and report only
  pre-existing unrelated baseline failures separately.
- **Asset check**: confirm the new Walking GIF is 275×185, 20 frames, 1860ms,
  transparent and looping, with binary differences limited to the 20 specified
  GCE delay words.
- **Feel check**: review deterministic examples and slow playback to confirm:
  - several passages start directly by Walking or Racing; Lurking remains an
    occasional surprise rather than a ritual;
  - Walking cadence and travel are subtly slower together, with no foot-cycle
    snap at arrival or departure;
  - Racing appears only after its car frame exists, stops exactly when Clawd
    returns to standing, and hands off without a size or baseline jump;
  - bridge exits disappear fully, remount invisibly while off-screen, then
    enter from the opposite side at exactly the same vertical height;
  - a bridged entry stops and continues actions instead of automatically
    leaving again;
  - zero-, one-, and two-bridge passages feel varied and do not reveal a fixed
    `peek → action → exit` loop;
  - directions can repeat once but never collapse into strict alternation;
  - reduced motion remains static and timetable interaction is never blocked.
- **Done when**: direct Walking/Racing arrivals, occasional Lurking, variable
  action blocks, and same-height cross-edge continuations coexist without
  flashing, timing drift, obvious fixed cycles, or extra runtime media/timers.
