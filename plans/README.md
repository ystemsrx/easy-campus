# Animation plans

| Plan | Title                                     | Severity | Status     |
| ---- | ----------------------------------------- | -------: | ---------- |
| 001  | Stabilize Clawd optical size and handoffs |     HIGH | DONE       |
| 002  | Randomize and diversify Clawd vignettes   |     HIGH | SUPERSEDED |
| 003  | Continuous randomized Clawd journeys      |     HIGH | DONE       |
| 004  | Reveal the full Lurking half-body         |     HIGH | DONE       |
| 005  | Compose continuous randomized passages    |     HIGH | DONE       |
| 006  | Protect vehicle edge handoffs             |     HIGH | DONE       |
| 007  | Place Clawd in adaptive free space        |     HIGH | DONE       |

## Execution order

1. Execute `001-stabilize-clawd-optical-size.md` first. It establishes the
   stable media stage and normalized source set required for seamless action
   changes.
2. Skip `002-randomize-clawd-vignettes.md`; plan 003 supersedes its fixed
   vignette and solo-fade design.
3. Execute `003-continuous-random-clawd-journeys.md` on plan 001's stable stage.
   It provides runtime-composed edge-to-edge journeys and the final scheduler.
4. Execute `004-reveal-full-clawd-lurking-half-body.md` after plan 003. It
   corrects the Lurking hold offset without changing the journey scheduler.
5. Execute `005-compose-continuous-clawd-passages.md` after plan 004. It keeps
   the corrected Lurking reveal while replacing mandatory peek-first cycles
   with direct arrivals and optional same-height cross-edge continuations.
6. Execute `006-protect-vehicle-edge-handoffs.md` after plan 005. It confines
   bridge Racing to the fully-boarded driving window and adds seamless Rowing
   arrivals without changing final Racing departures.
7. Execute `007-place-clawd-in-adaptive-free-space.md` after plan 006. It
   replaces the centered three-band stop model with continuously offset 2D
   positions chosen from the least-obstructed parts of the visible week.

Plan 003 superseded plan 002's isolated vignettes before commit. It preserves
plan 001's stable stage while replacing the scheduler with continuous,
edge-to-edge journeys and adding normalized Racing Car / rowing media.

Execution completed with targeted TypeScript, timetable, WXML, schedule, and
Skyline WXSS verification. Plan 001 records the one Skyline compatibility
exception for the unsupported `image-rendering` declaration.

Plan 005 extends the stable journey stage with direct Walking/Racing arrivals,
variable action blocks, and zero to two invisible off-screen cross-edge
continuations, protected by exact GIF-byte checks and 160 seeded passages.

Plan 006 confines direct and bridge Racing travel to the fully-boarded source
window with numerically verified constant/decelerating entry and
accelerating/constant bridge-exit profiles, preserves final Racing departures
byte-for-byte, and adds canonical Rowing arrivals/outros protected by 200
seeded passages and RGBA frame checks.

Plan 007 adapts each new journey to current-week course occupancy, randomizes
both axes without moving an active passage, and scales every edge route to the
chosen x coordinate while preserving the normalized vehicle velocity shapes.
