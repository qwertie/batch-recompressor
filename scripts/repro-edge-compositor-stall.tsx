import React from 'react';
import { createRoot } from 'react-dom/client';
import { setup, styled, glob } from '../src/styled.js';
import { ViewModel } from '../src/viewmodel.js';
import { Tree } from '../src/components/Tree.js';
import { DetailPage } from '../src/components/DetailPage.js';
import { initialAppState, type StateSnapshot } from '../shared/state.js';
import type { MediaFileInfo } from '../shared/types.js';

setup(React.createElement);
glob`
  body {
    margin: 0; background: #1e1e1e; color: #ddd;
    font: 14px/1.45 system-ui, sans-serif;
  }
  input, select, button {
    background: #2a2a2a; color: #ddd; border: 1px solid #555; border-radius: 4px;
  }
  h2 { margin: 4px 0 12px; }
  h3 { margin: 16px 0 6px; color: #9cc; }
  #probe {
    position: fixed; right: 18px; top: 18px; z-index: 1000; padding: 10px 14px;
    background: #000; color: aquamarine; border: 2px solid white; border-radius: 7px;
    font: 700 18px ui-monospace, monospace;
  }
  #probe.waiting { animation: flash .25s step-end infinite alternate; }
  @keyframes flash { to { color: black; background: aquamarine; } }
`;

const Layout = styled('div')`display: flex; height: 100vh;`;
const Sidebar = styled('div')`
  width: 380px; min-width: 240px; overflow: auto; padding: 10px;
  border-right: 1px solid #333; resize: horizontal;
`;
const ROOT = 'D:\\Synthetic\\Pictures\\2023';
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function syntheticFile(index: number): MediaFileInfo {
  const width = index % 3 === 0 ? 3840 : index % 3 === 1 ? 1920 : 1280;
  const height = width === 3840 ? 2160 : width === 1920 ? 1080 : 720;
  const kbps = 1800 + (index % 19) * 230;
  return {
    path: `${ROOT}\\Folder ${index % 37}\\A deliberately descriptive synthetic filename ${String(index).padStart(4, '0')}.mp4`,
    rootFolder: ROOT,
    kind: 'video',
    width, height, codedWidth: width, codedHeight: height, rotation: 0, fps: 30,
    sampleRate: 48000, channels: 2, audioKbps: 128,
    kbps, size: kbps * 125 * 60, duration: 60, codec: 'h264',
  };
}

const files = Array.from({ length: 1029 }, (_, index) => syntheticFile(index));
let revision = 1;

function snapshot(): StateSnapshot {
  return {
    revision,
    state: {
      ...initialAppState(),
      rootFolders: [ROOT],
      files: files.map(file => ({ ...file })),
      outputFolder: 'D:\\Synthetic\\Out',
    },
    jobs: [],
    existingOutputs: [],
  };
}

const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url === '/api/state' && (!init?.method || init.method === 'GET'))
    return Response.json(snapshot());
  if (url === '/api/state' && init?.method === 'POST') {
    const body = JSON.parse(String(init.body ?? '{}'));
    if (body.command?.type === 'rescan') await sleep(400);
    revision++;
    return Response.json(snapshot());
  }
  return Response.json({ ok: true });
};

function Repro(props: { vm: ViewModel }) {
  return <Layout>
    <Sidebar><Tree vm={props.vm} /></Sidebar>
    {/* Restores the pre-fix behavior intentionally; production defaults to 100 rows. */}
    <DetailPage vm={props.vm} unsafeFileTablePageSize={Number.MAX_SAFE_INTEGER} />
  </Layout>;
}

async function run() {
  const probe = document.querySelector<HTMLElement>('#probe')!;
  probe.classList.add('waiting');
  await new Promise<void>(resolve =>
    addEventListener('mousemove', () => resolve(), { once: true, passive: true }));
  probe.classList.remove('waiting');

  probe.textContent = 'Loading synthetic state';
  const vm = new ViewModel(fakeFetch, () => true);
  await vm.loadState();
  createRoot(document.querySelector('#root')!).render(<Repro vm={vm} />);

  let ticks = 0;
  let phase = 'Initial paint';
  const timer = setInterval(() => {
    probe.textContent = `${phase} - tick ${++ticks}`;
  }, 15);
  await sleep(250);
  for (let cycle = 1; cycle <= 3; cycle++) {
    phase = `Rescan ${cycle}/3`;
    await vm.rescanAll();
    phase = `Recovery ${cycle}/3`;
    await sleep(900);
  }
  clearInterval(timer);
  probe.textContent = `Done - tick ${ticks}`;
}

void run();
