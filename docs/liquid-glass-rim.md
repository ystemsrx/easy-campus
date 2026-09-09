# Single capsule rim

With Liquid Glass enabled, the primary navigation (Overview, Schedule, Profile)
and both Course Assistant tabs add one 6 logical-pixel outline. The outline is
a single SVG alpha mask around the entire capsule, not four sections or a grid.
A live WXML replica is scaled by 1.06 around the capsule centre. The interior of
the mask is transparent; the existing navigation material, selector and drag
behaviour continue unchanged. There is no selector replica.

This is a piecewise affine approximation, not the demo's continuous per-pixel
refraction. The scale samples slightly closer to the centre at each edge. The
outer ends therefore have more displacement than the straight top/bottom edge.
The mask dimensions follow the measured navigation, including its border.

Uniform scaling cannot join an unscaled image continuously along the whole
capsule boundary. A crossing line would jump at an opaque mask edge even with
perfectly aligned source coordinates. The mask therefore fades to transparent
at both its outer and inner boundary, while keeping the same 1.06 scale. Twelve
nested strokes of the same capsule centreline build this smooth alpha profile
inside one SVG resource; they are not background fragments and add no WXML
replicas or animated bindings. This softens the cut but does not produce genuine
continuous bending; fine lines can still appear blended or doubled in the rim.

Original and decorative content use the same named WXML templates and live page
data. Scroll containers remain in the owning page; only the decorative copy is
transformed. UI-thread scroll updates change a shared offset and one scene
matrix, without snapshots, bitmap caches, row-window rebuilding, layout queries
or setData per scroll frame. Schedule additionally translates its current date
and two neighbours within the same masked scene for horizontal paging, and
preserves each date's vertical offset. Programmatic restored offsets are copied
to shared state even when native scroll events are not emitted. On a new tab,
the first layout can report zero before applying scroll-top; the requested
offset is retained and clamped to the measured content range.

The small anchor component measures the navigation and releases the replica when
hidden, detached or disabled. Page hide/unload clears bindings and releases the
decorative nodes. Resize or changing the scroll viewport/date window remeasures
geometry; ordinary content and filter updates reuse the same native replica.
If layout or binding fails, the rim stays hidden and the existing material remains.

One copy still creates native nodes and incurs layout/compositing work, especially
for long course lists. Removing 48 fragments is not a guarantee of phone frame
rate. Assess scrolling and navigation on the actual target phones before increasing
the width or applying it to more controls.

Validation uses the normal frontend check suite and the installed DevTools Babel
and Worklet compiler. A native Skyline fixture (390 × 844, DPR 2) compares the
same page with and without the rim for all three primary tabs and both Course
Assistant tabs. The comparisons verify that the mask leaves the capsule interior
unchanged. The fixture also checks
live content changes, restored scroll positions and releasing all bindings when
disabled. Fixture screenshots are test artifacts, not part of the renderer.

A native grid/alpha fixture validated the earlier 3px feather on Skyline. At
DPR 2, top-edge alpha samples at depths 0.25 through 2.75px are
23, 130, 236, 237, 130, 23 (out of 255), compared with 255 throughout the opaque
mask. The grid's measured boundary contrast falls to about 10% of the hard-cut
version, with no pixel changes in the interior or exterior. This is evidence of
softer blending, not evidence that the underlying coordinate discontinuity is gone.
