# Batch Recompressor

A local web app for recompressing video, image and audio files in batch with
ffmpeg. Add folders, and their media files are scanned (via ffprobe, which
also classifies ambiguous containers) and grouped by kind, resolution,
framerate (each toggleable) and *compression density* — a normalized unit
where ~1 is typical: bits per pixel·second for video, bits per pixel for
images, bits per sample·channel for audio. Set a global target compression
ratio (default 4x smaller) with density limits, or prefer a quality setting
(always used for image formats), override settings per group or per file,
and start a sequential encode queue. Output files mirror the input folder
structure under the output folder. Built with React 18, TypeScript, MobX and
goober (CSS-in-JS), with a small Express backend that does the scanning and
runs ffmpeg.

## Requirements

- Node.js 22+ must be installed and on your PATH.
- If `ffmpeg` and `ffprobe` are not on your PATH, `npm run dev` / `npm start` check for 
  them and offer to install via your package manager (winget/choco/scoop, brew, or 
  apt/dnf/pacman) if missing. The app expects libsvtav1 for the default AV1 codec.

## Build & start

On Windows you should be able to just double-click `install-and-run.bat` (if ffmpeg is installed the first time, run it again). Or in terminal:

```sh
npm install
npm run dev        # development: server on :5177 + Vite UI on http://localhost:5173
```

or for a production build:

```sh
npm run build      # builds the UI into dist/
npm start          # serves UI + API on http://localhost:5177
```

Tests and typechecking:

```sh
npm test
npm run typecheck
```

## Original prompt

> I'd like you to make a new modern TypeScript 7 React web app for recompressing video files in batch on one's local machine with ffmpeg, in a new git repo in a "batch-recompressor" folder
>
> I think the way it would work is:
> 1. the app will have a tree widget whose root node has an add folder button for adding every video file recursively in a folder, and a textbox for the output folder and other settings. One of the settings will be an exclusion list of hidden tree nodes which only needs to support removing items, as items are added to the exclusion list by clicking an "Exclude this" button on the page for the item, which removes the item from the tree and adds it to the exclude list. The output folder is implicitly excluded.
> 2. upon adding a folder, scan for video files and group them into categories by their resolution, framerate, and approximate bitrate. When two files have bitrates larger than 30% different from each other, they should end up in different groups. So at the top level the tree display will have groups like 1920x1080x30 ~2204 kbps, and underneath those are paths to folder added with the add folder button, and under those put a tree of folders and files.
> 3. define a global target relative compression ratio that defaults to 4, meaning by default the app will target output files 4x smaller than the originals. There's also a default min and max bitrate, and other settings like codec (default av1), effort slider (some sort of medium high), and output folder. If the output folder is not disjoint from the input folder, files in the output folder should be excluded. Then each file group will have its own overrides. Individual files could have overrides too.
> 4. make a start button which starts a queue. The queue itself doesn't need a separate UI page ... I figure the UI page for each file and group can show a flat list of items in that group (or just one if it's a file page) with their status wrt the queue (enqueued, not queued, processing, finished), with buttons to start and stop/unqueue processing of everything in the group. The root node then naturally shows a list of everything.
> - output files should match the folder structure of the input, e.g. if I added folder C:\A\B then C:\A\B\C\D.mp4 should go in C:\OutputFolder\C\D.mp4
> - use CSS-in-JS; I am agnostic about UI framework but wish to minimize code size and I want MobX for reactivity, with a ViewModel class holding the state tree
>
> Add this prompt itself on the text box in the root folder of the new repo, at the bottom of a brief readme with instructions for build and start.
>
> So,
> 1. ask me any questions that come to mind, to finish the design
> 2. create a basic version of the app with essential features, then make a commit from that
> 3. write tests for basic features, ensure they pass
> 4. add the rest of the features and finer details and tests in another commit; tests can be more superficial or even missing for nonessential features. add only basic UI tests, no end-to-end tests

### Design Q&A

Questions asked to finish the design, and the answers that shaped the app:

1. **The app needs local filesystem access and to spawn ffmpeg — what architecture?**
   → *Node server + browser UI*: Vite React frontend + small Node backend that
   scans folders, runs ffprobe/ffmpeg, and streams progress (SSE).
2. **Which CSS-in-JS library?** → *goober* (~1KB styled-components-like API).
3. **Queue concurrency and encoding details?** → *1 job at a time*, assuming the
   jobs themselves use many cores (SVT-AV1 default, effort slider maps to presets).
4. **"TypeScript 7" — what do you mean?** → *Latest stable TS, tsgo if usable*.
   (TypeScript 7 turned out to be stable on npm, so the project uses it.)
