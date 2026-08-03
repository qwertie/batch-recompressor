# Chromium compositor stall reproduction

This reproduces the frontend workload which accompanied the system-wide mouse
and window stalls. It uses the real Batch Recompressor React components, but
all 1,029 media records and all rescan responses are generated in memory. It
does not start the backend, read media, access `D:`, run FFmpeg, or call
FFprobe.

## Run

From the repository root:

```powershell
npm.cmd run repro:compositor
```

This opens `scripts/repro-of-system-slowdown-in-edge.html`.

## Conditions required to reproduce

- Microsoft Edge must be using hardware acceleration/compositing.
- Edge's GPU process and the graphics driver must be in the transient affected
  state. It reproduced on AMD Radeon 8060S driver 32.0.12064.27, but a fresh
  Edge GPU process was often clean.
- The large real-app table must be paintable. The companion module deliberately
  restores the old unbounded 1,029-row table; production no longer does this.

A clean run outside those conditions does not disprove the bug.

Move the mouse when the flashing prompt appears and keep moving through the
three short rescans. A positive reproduction is delayed/jumping desktop mouse
movement and delayed native window updates. The counter can remain smooth; in
the recorded incidents, browser timers and video playback often continued
normally while desktop input and other native windows stalled.

This is a conditional reproduction. The strongest exact-frontend run happened
inside a long-lived Edge GPU context, while both a fresh Edge profile/process
and the formerly bad profile after restarting its GPU process were clean. A
clean run therefore does not falsify the issue. Restart Edge between trials if
you need to stop a bad run; disabling browser graphics acceleration also
prevented the stalls in testing.

## Observations

The investigation found:

- The exact backend-free frontend reproduced the stall: 88 of 176 Edge GUI
  probes timed out, alongside 103 Task Manager and 41 Explorer timeouts.
- The same page in a fresh Edge process had zero probe timeouts.
- Firefox and Edge with graphics acceleration disabled were clean.
- Edge with GPU rasterization disabled but hardware compositing retained was
  still bad: the measured mouse-event gap reached 10.5 seconds.
- Hiding the real table with `visibility: hidden` was clean. Rendering 100 rows
  was clean, while 600 and 1,029 rows reproduced increasingly severe stalls in
  the affected context.
- Generic static tables and synthetic React/Goober tables were insufficient by
  themselves. The real, descendant-heavy file rows were the reliable workload
  once the Chromium GPU context entered the bad state.

## Conclusion and mitigation

The evidence points to a transient Chromium hardware-compositor/AMD graphics
driver failure, not CPU, memory, disk, scanning, FFprobe, or the browser's
JavaScript event loop. Batch Recompressor's large painted file table was a
stressor which crossed the failure threshold, not a sufficient root cause on
its own.

Production therefore paginates the file table at 100 rows. Queue actions and
summary calculations still apply to the complete selection; only DOM painting
is bounded. The deliberate `unsafeFileTablePageSize` override in the TSX repro
restores the old unbounded behavior and must not be used by the application.
