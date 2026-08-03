# Edge system-slowdown reproduction

Open `repro-of-system-slowdown-in-edge.html` directly in hardware-accelerated
Microsoft Edge. Move the mouse when prompted and keep moving through the three
short Rescan cycles and the 40-second recovery observation. The JavaScript
counter can remain smooth while the Windows mouse and native windows stall.

Append `#contained` to apply the production control: a wrapper around the
table with `contain: layout paint`.

## Reliability

The standalone file is a conditional reduction. It produced a human-confirmed
physical-mouse slowdown during the investigation, but later ran clean while an
exact backend-free copy of the application still failed in the same dedicated
Edge profile. A clean standalone run therefore does not disprove the bug, and
the reduction is not claimed to contain every sufficient condition.

The exact harness retained React/MobX, the captured 1,029-file view, and an
in-memory Rescan, but used no server, filesystem, media files, FFprobe, or
FFmpeg. It repeatedly produced the system-wide native-window stall and was used
to validate the workaround.

## Measured boundaries

The native probe repeatedly sent bounded messages to Edge, Explorer, and Task
Manager while also measuring its own scheduling delay. Representative trials:

| Trial | Task Manager timeouts | Explorer timeouts | Edge timeouts | Max loop lag |
|---|---:|---:|---:|---:|
| Exact app, fixed table layout | 34/63 | 34/63 | 42/63 | 913 ms |
| Button/scanning state only; snapshot unchanged | 26/51 | 24/51 | 32/51 | 1,182 ms |
| Same view mounted with no transitions | 3/206 | 0/206 | 1/206 | 196 ms |
| 100 rows | 4/144 | 0/144 | 3/144 | 209 ms |
| 500 rows | 26/55 | 13/55 | 23/55 | 710 ms |
| Contained table; button/scanning transitions | 0/163 | 0/163 | 1/163 | 219 ms |
| Contained table; full snapshot replacements | 2/179 | 0/179 | 1/179 | 151 ms |

`table-layout: fixed`, ordinary document scrolling, and row-level
`content-visibility: auto` did not prevent the failure. A plain 1,029-row page
also was not sufficient by itself; the failure has a cumulative page/paint
threshold rather than one independently necessary widget.

## Conclusion and workaround

Scanning, disk I/O, FFprobe, FFmpeg, memory pressure, and the JavaScript event
loop are not required. The evidence points to Edge/Chromium propagating a small
control or status invalidation through the large table's layout/paint subtree,
then hitting an AMD-driver/Windows-compositor failure that delays desktop input
and native-window presentation.

Production retains every row in one continuous table and wraps the table in:

```css
contain: layout paint;
```

This creates a layout/paint invalidation boundary without pagination or
application-level virtualization. It passed both the button-only and complete
snapshot-replacement trials above.
