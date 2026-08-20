# 004 — Reveal the full Lurking half-body

- **Status**: DONE
- **Commit**: 5956d79
- **Severity**: HIGH
- **Category**: Physicality and origin
- **Estimated scope**: 2 source/check files, under 25 lines

## Problem

The Lurking GIF uses a 275×185 transparent canvas. During its fully emerged
frames, the visible half-body occupies source pixels `x=0..64`. The timetable
renders that canvas inside a centered 360rpx stage, so the source scales by
`360 / 275` and the half-body occupies roughly the first 84rpx of the stage.

The centered stage has a 195rpx margin on a 750rpx-wide viewport:
`(750 - 360) / 2 = 195`. The current hold offset moves the stage 57rpx beyond
that margin, clipping most of the half-body and leaving only the outermost
roughly 27rpx visible. This matches the reported symptom: only the hand peeks
into the timetable.

```css
/* miniprogram/pages/timetable/index.wxss:1576 — current */
@keyframes clawd-lurk-from-left {
  5.38% {
    transform: translateX(-252rpx);
    opacity: 0.38;
  }
  94.62% {
    transform: translateX(-252rpx);
    opacity: 0.38;
  }
}

@keyframes clawd-lurk-from-right {
  5.38% {
    transform: translateX(252rpx);
    opacity: 0.38;
  }
  94.62% {
    transform: translateX(252rpx);
    opacity: 0.38;
  }
}
```

The current timetable regression says Lurking must fully emerge, but it checks
only timing, opacity, and the final off-screen position. It does not protect
the visible hold offset.

## Target

At the fully emerged hold, align the fixed stage edge exactly with the screen
edge using `translateX(-195rpx)` on the left and `translateX(195rpx)` on the
right. This reveals the GIF's complete native half-body while preserving its
intended edge-peek composition.

```css
/* target */
@keyframes clawd-lurk-from-left {
  0% { transform: translateX(-470rpx); }
  5.38%, 94.62% { transform: translateX(-195rpx); }
  100% { transform: translateX(-470rpx); }
}

@keyframes clawd-lurk-from-right {
  0% { transform: translateX(470rpx); }
  5.38%, 94.62% { transform: translateX(195rpx); }
  100% { transform: translateX(470rpx); }
}
```

Keep the existing separate 5.38% and 94.62% declarations if needed to retain
their per-segment easing assignments. Do not change opacity, the 5580ms native
duration, the outer ±470rpx off-screen endpoints, the fixed 360×242 stage, the
three vertical anchors, or inner-media mirroring.

## Repo conventions to follow

- Route motion lives on `.clawd-scene-stage`; mirroring remains only on
  `.clawd-scene-media--mirrored`.
- Route keyframes animate only `transform` and `opacity`.
- Entering uses the existing strong ease-out
  `cubic-bezier(0.23, 1, 0.32, 1)`; retreating uses the existing strong
  ease-in-out `cubic-bezier(0.77, 0, 0.175, 1)`.
- `scripts/check-timetable.js` uses `cssBlock(...)` plus regex assertions for
  exact journey invariants.

## Steps

1. In `miniprogram/pages/timetable/index.wxss`, change only the 5.38% and
   94.62% Lurking hold transforms from `±252rpx` to `±195rpx` in both
   directions.
2. In `scripts/check-timetable.js`, strengthen the existing Lurking assertion:
   require both the 5.38% and 94.62% blocks to contain `-195rpx` for the left
   keyframes and `195rpx` for the right keyframes, while retaining the current
   duration/opacity/±470rpx off-screen checks.
3. Update this plan to `DONE` and add a short execution note after verification.
   Update `plans/README.md` to mark plan 004 done.
4. Amend the existing frontend commit with `git commit --amend --no-edit` after
   all checks pass.

## Boundaries

- Do not edit or regenerate `lurking.gif`.
- Do not change the fixed stage size, media size, vertical anchors, mirroring,
  scheduler, random bags, scene duration, opacity, or Lurking→Walking handoff.
- Do not touch course layout, colors, theme menus, or other Clawd actions.
- Do not add dependencies.
- If the current keyframes differ from the excerpts above, stop and report the
  drift rather than improvising.

## Execution notes

- Aligned the left and right Lurking hold positions to the viewport edge with
  symmetric `-195rpx` / `195rpx` transforms at both `5.38%` and `94.62%`.
- Strengthened the timetable regression to require both hold offsets and both
  unchanged `±470rpx` off-screen endpoints at the existing `0.38` opacity.

## Verification

- **Mechanical**: run typecheck, `check:timetable`, `check:wxml`,
  `check:schedule`, the full Skyline WXSS check, and `git diff --check`; all
  task-related checks must pass.
- **Feel check**: inspect both left and right Lurking routes at slow speed and
  confirm:
  - the full native half-body (`x=0..64` before mirroring) is visible at peak;
  - the character still reads as peeking from the edge, not standing fully in
    the timetable;
  - the complete greeting plays without clipping;
  - retreat reaches fully off-screen before Walking enters at the same height;
  - mirroring does not change the visible amount between directions.
- Toggle reduced motion and confirm the static idle SVG remains unchanged.
- **Done when**: both Lurking directions show the whole animated half-body,
  retain the complete retract, and introduce no size jump, flash, or scheduler
  regression.
