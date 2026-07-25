// Runs before `npm run dev` / `npm start`: verifies ffmpeg and ffprobe are on
// the PATH, and if not, offers (with the user's permission) to install them
// using the platform's package manager.
import { spawnSync } from 'node:child_process';
import * as readline from 'node:readline/promises';

function has(cmd: string): boolean {
  return spawnSync(cmd, ['-version'], { stdio: 'ignore' }).status === 0;
}

/** Pick the first available package manager and its ffmpeg install command. */
function installCommand(): { name: string; cmd: string; args: string[] } | null {
  const candidates: { probe: string; name: string; cmd: string; args: string[] }[] =
    process.platform === 'win32' ? [
      { probe: 'winget', name: 'winget', cmd: 'winget', args: ['install', '--id', 'Gyan.FFmpeg', '-e', '--accept-source-agreements', '--accept-package-agreements'] },
      { probe: 'choco', name: 'Chocolatey', cmd: 'choco', args: ['install', '-y', 'ffmpeg'] },
      { probe: 'scoop', name: 'Scoop', cmd: 'scoop', args: ['install', 'ffmpeg'] },
    ] : process.platform === 'darwin' ? [
      { probe: 'brew', name: 'Homebrew', cmd: 'brew', args: ['install', 'ffmpeg'] },
    ] : [
      { probe: 'apt-get', name: 'apt', cmd: 'sudo', args: ['apt-get', 'install', '-y', 'ffmpeg'] },
      { probe: 'dnf', name: 'dnf', cmd: 'sudo', args: ['dnf', 'install', '-y', 'ffmpeg'] },
      { probe: 'pacman', name: 'pacman', cmd: 'sudo', args: ['pacman', '-S', '--noconfirm', 'ffmpeg'] },
    ];
  for (const c of candidates) {
    const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [c.probe], { stdio: 'ignore' });
    if (probe.status === 0) return c;
  }
  return null;
}

async function main(): Promise<void> {
  if (has('ffmpeg') && has('ffprobe')) return; // all good, stay quiet

  console.error('ffmpeg and/or ffprobe were not found on your PATH; this app needs them.');
  const installer = installCommand();
  if (!installer) {
    console.error('No known package manager found. Please install ffmpeg yourself:');
    console.error('  https://ffmpeg.org/download.html');
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(
    `Install ffmpeg now via ${installer.name}? (${installer.cmd} ${installer.args.join(' ')}) [y/N] `)).trim();
  rl.close();
  if (!/^y(es)?$/i.test(answer)) {
    console.error('Not installing. Install ffmpeg manually, then re-run.');
    process.exit(1);
  }

  const result = spawnSync(installer.cmd, installer.args, { stdio: 'inherit' });
  if (result.status !== 0 || !(has('ffmpeg') && has('ffprobe'))) {
    console.error('Installation did not succeed (you may need a new terminal for PATH changes).');
    process.exit(1);
  }
  console.log('ffmpeg installed successfully.');
}

main();
