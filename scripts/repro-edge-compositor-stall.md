# Edge system-slowdown reproduction

Open `repro-of-system-slowdown-in-edge.html` directly in Microsoft Edge. It is
a self-contained HTML file with inline vanilla JavaScript: no build, packages,
web server, application backend, filesystem scan, FFprobe, or FFmpeg.

Move the mouse when prompted and keep moving through the eight short Rescan
cycles. Continue observing the system for at least 40 seconds afterward:
the strongest native-window timeout period sometimes began after the page
already displayed Done. Delayed/jumping desktop mouse movement and delayed
native-window updates constitute a positive reproduction. The on-page
JavaScript counter may continue smoothly during the system slowdown.

## Conditions

- Edge must have hardware acceleration/compositing enabled.
- Its GPU process and graphics driver must be in the transient affected state.
  The state occurred on AMD Radeon 8060S driver 32.0.12064.27, but disappeared
  after restarting Edge's GPU process.
- The large table must be paintable. The repro hides it until the first mouse
  movement so the observer is ready for its initial paint.

A fresh Edge process commonly runs clean, so a clean trial does not disprove
the issue. Append `#fixed` to the file URL to run the same workload with
`table-layout: fixed`.

## Minimal workload and conclusions

The file is the smallest empirically positive reduction reached before further
GUI trials were blocked. It retains 1,029 content-sized, collapsed-table rows;
six populated cells; one hidden command-tooltip subtree plus its copy-button
SVG; initial paint; and the two Rescan invalidations. It removes all cosmetic
CSS, the table header, the offscreen spacer, and the second tooltip subtree.

Measured reduction boundaries in the affected isolated Edge context:

- This reduced row produced 19 Edge and 6 Task Manager GUI timeouts.
- Removing both cell padding and the collapsed bottom border produced zero
  timeouts; either declaration alone also produced zero.
- Removing the command-tooltip/copy-SVG pair produced zero Edge timeouts.
- Keeping only the tooltip or only the SVG produced zero Edge timeouts; their
  interaction is required at this workload size.
- Reducing the row to two populated cells or leaving four cells empty produced
  zero timeouts.
- Removing the header and offscreen spacer did not weaken the positive signal.

Generic static tables and synthetic div/React trees likewise did not reproduce
reliably. The remaining markup and styles are therefore retained because each
was either part of the last measured positive case or could not be tested
further; not because every remaining token has independently been proven
necessary.

The original backend-free application reproduced system-wide GUI probe
timeouts, whereas the same page in a fresh Edge GPU process did not. Firefox
and Edge with graphics acceleration disabled were clean. Hiding the real table
was clean, and in-page timers/video could remain smooth while native input and
other applications stalled. The evidence therefore points to a transient
Chromium hardware-compositor/AMD-driver failure aggravated by the large real
table's layout/paint work, rather than scanning, disk, CPU, memory, FFprobe,
FFmpeg, or the JavaScript event loop.

Production uses `table-layout: fixed` to bypass content-dependent whole-table
sizing while retaining every row in one continuous table. The `#fixed` mode is
included to test that workaround against the same standalone workload once an
affected GPU context is available.
