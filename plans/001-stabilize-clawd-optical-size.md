# 001 — Stabilize Clawd optical size and handoffs

- **Status**: DONE
- **Commit**: 97549e8
- **Severity**: HIGH
- **Category**: Physicality & origin
- **Estimated scope**: 4 files, about 180 lines plus asset-source changes

## Problem

The timetable renders every Clawd action through one `aspectFit` image, but the
GIFs do not share a consistent transparent canvas or optical scale:

```xml
<!-- miniprogram/pages/timetable/index.wxml:33 — current -->
<image
  wx:if="{{clawdSceneSrc}}"
  class="clawd-scene {{clawdScenePositionClass}} {{clawdSceneMotionClass}}"
  src="{{clawdSceneSrc}}"
  mode="aspectFit"
  fade-in="{{false}}"
  draggable="{{false}}"
></image>
```

`timetable-theme-clawd-walking.gif` has a 210×149 canvas whose visible body
occupies almost the full width. Waving and dancing use 156×105 canvases but
their visible body is only 68 px wide; jumping is 66 px wide on a 150×101
canvas. In the current 168rpx-wide bottom container, the body therefore jumps
from about 168rpx to about 73rpx when walking changes to waving, then back to
168rpx when walking resumes.

The motion keyframes add a second size discontinuity:

```css
/* miniprogram/pages/timetable/index.wxss:1574 — current */
@keyframes clawd-soft-arrive {
  0% {
    transform: translate(12rpx, 10rpx) scale(0.94);
    opacity: 0;
  }
  22%,
  100% {
    transform: translate(0, 0) scale(1);
    opacity: 0.44;
  }
}
```

## Target

- Use a stable outer stage and a separate inner media image.
- The bottom stage is exactly `360rpx × 242rpx` (the same 275:185 ratio used
  by the normalized login assets). The visible crab stays close to the current
  large walking size through walking, waving, dancing, jumping, laptop, and
  magnifier handoffs.
- Reuse the already-bundled normalized sources:
  - walking: `/assets/login/crabwalking.gif` (275×185, 1660ms)
  - lurking: `/assets/login/lurking.gif` (275×185, 5580ms)
  - waving: `/assets/login/waving.gif` (275×185, 1410ms)
  - dancing: `/assets/login/dancing.gif` (275×185, 3330ms)
  - laptop: `/assets/login/laptop.gif` (275×185, 3580ms)
  - magnifier: `/assets/login/magnifier.gif` (275×185, 9410ms)
  - jumping: retain the normalized-ratio
    `/assets/images/timetable-theme-clawd-jumping.gif` (150×101, 1760ms)
- Put route translation and opacity on the outer stage. The inner image may
  only use `scaleX(-1)` for right-to-left mirroring; it must never scale on both
  axes during a handoff.
- Remove every `scale(0.94)`, `scale(0.96)`, and `scale(1.02)` from Clawd
  keyframes. Arrivals use translation + opacity with
  `cubic-bezier(0.23, 1, 0.32, 1)`. On-screen repositioning uses
  `cubic-bezier(0.77, 0, 0.175, 1)`. Walking remains `linear`.
- Use an 80ms baseline-frame handoff after loop completion:
  - walking stage duration: `1740ms` (`1660 + 80`)
  - waving handoff: `1490ms` (`1410 + 80`)
  - dancing handoff: `3410ms` (`3330 + 80`)
- For the walking route, hold at the origin through `18.97%` (330/1740),
  finish movement at `95.4%` (1660/1740), and hold the destination until
  `100%`. This lets the GIF loop to its common baseline before the source swap.
- Preserve `pointer-events: none`, `z-index: 1`, one live GIF at a time, and
  the static SVG fallback under reduced motion.

## Repo conventions to follow

- The login page already separates a fixed-ratio stage from a full-size image:
  `miniprogram/pages/login/index.wxml:19` and
  `miniprogram/pages/login/index.wxss:72`.
- GIF timing constants live beside the source map in
  `miniprogram/pages/timetable/index.ts:117`.
- Walking uses linear movement synchronized to its built-in 330ms idle lead,
  as demonstrated by `miniprogram/pages/login/index.wxss:373`.
- Reduced motion is represented by `motionClass` and the timetable currently
  renders `timetable-theme-clawd-idle.svg` instead of animated GIFs.

## Steps

1. In `miniprogram/pages/timetable/index.wxml`, replace the single animated
   image with an outer `.clawd-scene-stage` carrying position and route classes
   and an inner `.clawd-scene-media` carrying the source and optional mirror
   class. Keep `fade-in="{{false}}"`, `mode="aspectFit"`, and
   `draggable="{{false}}"`.
2. Extend `TimetableClawdSceneStep` and page data in
   `miniprogram/pages/timetable/index.ts` with an inner-media class. Use it only
   for `clawd-scene-media--mirrored`; default is an empty string.
3. Point walking, lurking, waving, and dancing at the normalized login assets
   listed above. Add laptop and magnifier sources and exact duration constants.
   Keep jumping on the existing normalized-ratio timetable asset.
4. In `miniprogram/pages/timetable/index.wxss`, make the stage
   `360rpx × 242rpx`. Position variants may change `top/right/bottom/left` and
   opacity, but must not change stage width or height inside one visible phrase.
5. Make `.clawd-scene-media` fill the stage and use
   `image-rendering: pixelated`. Mirroring belongs on this inner node so route
   transforms never overwrite it.
6. Rewrite the four Clawd keyframes to remove scale and use the exact curves
   and handoff percentages in Target. Add mirrored walk-in and walk-out routes
   that retain the same 330ms lead and 80ms baseline handoff.
7. Update `scripts/check-timetable.js` to assert the shared normalized sources,
   stable stage markup, `360rpx × 242rpx`, no scale in any Clawd keyframe,
   1740ms walking handoff, 18.97% and 95.4% markers, inner-only mirroring, and
   the unchanged reduced-motion SVG fallback.

## Boundaries

- Do not alter course-grid layout, theme colors, menu motion, or companion
  animations.
- Do not add dependencies or new media formats.
- Do not use RacingCar, Persona, or minigame sprite assets in this plan.
- Do not display more than one animated GIF at once.
- If the listed source dimensions or durations no longer match, stop and report
  instead of estimating new values.

## Execution notes

- Implemented the fixed `360rpx × 242rpx` outer stage, inner media mirroring,
  normalized login sources, bidirectional routes, and baseline-frame handoffs.
- Plan 003 superseded the temporary one-shot/fade choreography before commit.
  The stable stage now remains visible across shared-baseline actions and only
  clears after a Walking, Racing Car, or rowing route is fully off-screen.
- `image-rendering: pixelated` was tested but omitted because Skyline CLI marks
  the property as unsupported. The native `aspectFit` image remains on the
  normalized transparent canvases, so the optical-size fix does not depend on
  that unsupported declaration.

## Verification

- **Mechanical**: run `npm run typecheck`, `npm run check:timetable`,
  `npm run check:wxml`, `npm run check:schedule`, and `npm run check:wxss`.
  All targeted checks must pass. If system npm is unavailable, use the bundled
  Node executable to run the equivalent scripts directly.
- **Asset inspection**: verify walking/waving/dancing/laptop/magnifier all
  report 275×185, jumping reports 150×101, and no two actions in a bottom phrase
  change the stage dimensions.
- **Feel check**:
  - Slow playback to 10%. Walking → waving → walking must keep the crab body at
    one optical size; only limbs/props may extend beyond the baseline body.
  - At 1660ms the walking stage has reached its stop; during the final 80ms it
    remains still on the baseline frame before the source changes.
  - Right-to-left walking mirrors the inner art without reversing or resetting
    the route transform.
  - Reduced motion shows only the static idle SVG.
- **Done when**: the large bottom crab never shrinks during an action handoff,
  and all automated checks above pass.
