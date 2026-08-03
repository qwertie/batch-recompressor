# Edge system-slowdown reproduction

Open `repro-of-system-slowdown-in-edge.html` directly in Microsoft Edge. It is
a self-contained HTML file with inline vanilla JavaScript: no build, packages,
web server, application backend, filesystem scan, FFprobe, or FFmpeg.

Move the mouse when prompted and keep moving through the three short Rescan
cycles. Delayed/jumping desktop mouse movement and delayed native-window
updates constitute a positive reproduction. The on-page JavaScript counter
may continue smoothly during the system slowdown.

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

The file is a reduced candidate distilled from the exact frontend reproduction:
1,029 content-sized collapsed-table rows with the file row's nested buttons,
tips and SVG; initial paint; and the two Rescan invalidations. Generic static
tables and synthetic div/React trees did not reproduce reliably. This new
reduction must therefore be tried in an affected GPU context; failure there
would mean that the reduction removed another necessary part of the trigger.

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
