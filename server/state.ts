import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  applyStateCommand, cloneAppState, effectiveSettingsFor, initialAppState, removeStateEntries,
  settingsIndex,
  type AppState, type StateCommand, type StateSnapshot,
} from '../shared/state.js';
import type { EnqueueRequest } from '../shared/types.js';
import { isExcluded } from '../shared/paths.js';
import { scanFolder } from './scan.js';
import type { EncodeQueue } from './queue.js';

export class StateConflict extends Error {}

type Scan = typeof scanFolder;
type IsFolder = (folder: string) => boolean;

interface StateStoreOptions {
  scan?: Scan;
  isFolder?: IsFolder;
  stateFile?: string;
}

interface PersistedState {
  version: 1;
  revision: number;
  state: AppState;
}

/** Single-user source of truth for editable state, optionally persisted to disk. */
export class AppStateStore {
  private state: AppState = initialAppState();
  private revision = 0;
  private scan: Scan;
  private isFolder: IsFolder;
  private stateFile?: string;

  constructor(
    private queue: Pick<EncodeQueue,
      'getStates' | 'setMaxConcurrent' | 'unqueue' | 'clear'>,
    options: StateStoreOptions = {},
  ) {
    this.scan = options.scan ?? scanFolder;
    this.isFolder = options.isFolder ?? (folder =>
      Boolean(folder && fs.existsSync(folder) && fs.statSync(folder).isDirectory()));
    this.stateFile = options.stateFile;
    this.load();
    this.queue.setMaxConcurrent(this.state.maxConcurrent);
  }

  snapshot(): StateSnapshot {
    return {
      revision: this.revision,
      state: cloneAppState(this.state),
      jobs: structuredClone(this.queue.getStates()),
    };
  }

  enqueueRequest(paths: string[]): EnqueueRequest {
    const wanted = new Set(paths);
    const files = this.state.files.filter(file =>
      wanted.has(file.path)
      && !isExcluded(file.path, this.state.outputFolder, this.state.exclusions));
    if (files.length !== wanted.size)
      throw new StateConflict('One or more files being started no longer exist on the server.');
    const index = settingsIndex(this.state);
    return {
      outputFolder: this.state.outputFolder,
      overwrite: this.state.overwrite,
      maxConcurrent: this.state.maxConcurrent,
      files: files.map(info => ({
        info: structuredClone(info),
        settings: effectiveSettingsFor(this.state, info, index),
      })),
    };
  }

  async dispatch(command: StateCommand, expectedRevision: number): Promise<StateSnapshot> {
    this.expectRevision(expectedRevision);

    switch (command.type) {
      case 'addFolder':
        await this.addFolder(command.folder, expectedRevision);
        break;
      case 'rescan':
        await this.rescan(expectedRevision);
        break;
      case 'clearAll':
        this.clearAll();
        break;
      case 'clearUnqueued':
        this.clearUnqueued(command.paths);
        break;
      default: {
        const error = applyStateCommand(this.state, command, true);
        if (error) throw new StateConflict(error);
        if (command.type === 'update' && command.values.maxConcurrent !== undefined)
          this.queue.setMaxConcurrent(this.state.maxConcurrent);
      }
    }
    this.revision++;
    await this.persist();
    return this.snapshot();
  }

  private load(): void {
    if (!this.stateFile) return;
    try {
      const saved = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) as PersistedState;
      if (saved.version !== 1 || !saved.state) throw new Error('Unsupported state file');
      const defaults = initialAppState();
      this.state = {
        ...defaults,
        ...saved.state,
        settings: { ...defaults.settings, ...saved.state.settings },
        grouping: { ...defaults.grouping, ...saved.state.grouping },
      };
      this.revision = Math.max(0, Math.floor(saved.revision) || 0);
    } catch (error: any) {
      if (error?.code !== 'ENOENT')
        console.error(`Could not load state from ${this.stateFile}:`, error);
    }
  }

  private async persist(): Promise<void> {
    if (!this.stateFile) return;
    const data: PersistedState = {
      version: 1,
      revision: this.revision,
      state: this.state,
    };
    await fs.promises.mkdir(path.dirname(this.stateFile), { recursive: true });
    const temporary = `${this.stateFile}.${process.pid}.tmp`;
    await fs.promises.writeFile(temporary, JSON.stringify(data), 'utf8');
    await fs.promises.rename(temporary, this.stateFile);
  }

  private expectRevision(expected: number): void {
    if (expected !== this.revision) {
      throw new StateConflict(
        `The server state changed (client revision ${expected}, server revision ${this.revision}).`,
      );
    }
  }

  private async addFolder(folder: string, expectedRevision: number): Promise<void> {
    if (!this.isFolder(folder))
      throw new Error(`Not a folder: ${folder}`);
    const files = await this.scan(
      folder, this.state.outputFolder, this.state.exclusions, this.state.enabledExts);
    this.expectRevision(expectedRevision);
    if (!this.state.rootFolders.includes(folder)) this.state.rootFolders.push(folder);
    this.state.files.push(...files.filter(file =>
      !this.state.files.some(existing => existing.path === file.path)));
  }

  private async rescan(expectedRevision: number): Promise<void> {
    const files = [];
    for (const folder of this.state.rootFolders) {
      files.push(...await this.scan(
        folder, this.state.outputFolder, this.state.exclusions, this.state.enabledExts));
    }
    this.expectRevision(expectedRevision);
    this.state.files = files;
  }

  private clearAll(): void {
    const states = new Map(this.queue.getStates().map(job => [job.path, job]));
    for (const file of this.state.files) {
      if (states.get(file.path)?.status === 'enqueued') this.queue.unqueue(file.path);
    }
    const processing = new Set(this.queue.getStates()
      .filter(job => job.status === 'processing').map(job => job.path));
    const paths = this.state.files
      .filter(file => !processing.has(file.path)).map(file => file.path);
    this.queue.clear(paths);
    removeStateEntries(this.state, paths, [...this.state.rootFolders]);
  }

  private clearUnqueued(requestedPaths: string[]): void {
    const states = new Map(this.queue.getStates().map(job => [job.path, job]));
    const paths = requestedPaths.filter(path =>
      this.state.files.some(file => file.path === path)
      && (states.get(path)?.status ?? 'notQueued') === 'notQueued');
    this.queue.clear(paths);
    removeStateEntries(this.state, paths);
  }
}
