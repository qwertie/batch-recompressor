import { makeAutoObservable, runInAction } from 'mobx';
import type {
  MediaFileInfo, JobState, JobStatus, EncodeSettings, SettingsOverride,
} from '../shared/types.js';
import { DEFAULT_SETTINGS } from '../shared/types.js';
import { groupFiles, type FileGroup, type GroupingOptions } from '../shared/grouping.js';
import { isExcluded } from '../shared/paths.js';
import {
  applyStateCommand, effectiveSettingsFor, initialAppState,
  type AppState, type StateCommand, type StateSnapshot,
} from '../shared/state.js';

/** What the tree currently has selected: root, a group, or a single file. */
export type Selection =
  | { kind: 'root' }
  | { kind: 'group'; key: string }
  | { kind: 'file'; path: string };

interface PendingCommand {
  command: StateCommand;
  done: () => void;
}

export class ViewModel {
  private state: AppState = initialAppState();
  /** Job states received from the server, keyed by file path. */
  jobs = new Map<string, JobState>();
  selection: Selection = { kind: 'root' };
  scanning = false;
  loadingState = false;
  error = '';
  private revision = 0;
  private pending: PendingCommand[] = [];
  private syncing = false;
  private lastSync: Promise<void> = Promise.resolve();

  constructor(
    private fetcher: typeof fetch = fetch.bind(globalThis),
    private confirmReload: (message: string) => boolean =
      message => globalThis.confirm(message),
  ) {
    makeAutoObservable(this);
  }

  // ---- derived state ----

  get rootFolders(): string[] { return this.state.rootFolders; }
  get files(): MediaFileInfo[] { return this.state.files; }
  get exclusions(): string[] { return this.state.exclusions; }
  get outputFolder(): string { return this.state.outputFolder; }
  get overwrite(): boolean { return this.state.overwrite; }
  get showDirectoryTree(): boolean { return this.state.showDirectoryTree; }
  get maxConcurrent(): number { return this.state.maxConcurrent; }
  get settings(): EncodeSettings { return this.state.settings; }
  get grouping(): GroupingOptions { return this.state.grouping; }
  get enabledExts(): string[] { return this.state.enabledExts; }
  get groupOverrides(): Map<string, SettingsOverride> {
    return new Map(this.state.groupOverrides);
  }
  get fileOverrides(): Map<string, SettingsOverride> {
    return new Map(this.state.fileOverrides);
  }

  get visibleFiles(): MediaFileInfo[] {
    return this.files.filter(f => !isExcluded(f.path, this.outputFolder, this.exclusions));
  }

  get groups(): FileGroup[] {
    return groupFiles(this.visibleFiles, this.grouping);
  }

  groupByKey(key: string): FileGroup | undefined {
    return this.groups.find(g => g.key === key);
  }

  fileByPath(path: string): MediaFileInfo | undefined {
    return this.files.find(f => f.path === path);
  }

  /** Effective settings for a file: global <- group override <- file override. */
  effectiveSettings(file: MediaFileInfo): EncodeSettings {
    return effectiveSettingsFor(this.state, file);
  }

  statusOf(path: string): JobStatus {
    return this.jobs.get(path)?.status ?? 'notQueued';
  }

  /** Files shown on the currently selected page. */
  get selectedFiles(): MediaFileInfo[] {
    const sel = this.selection;
    if (sel.kind === 'root') return this.visibleFiles;
    if (sel.kind === 'group') return this.groupByKey(sel.key)?.files ?? [];
    const f = this.fileByPath(sel.path);
    return f ? [f] : [];
  }

  // ---- actions ----

  select(sel: Selection): void { this.selection = sel; }

  setOutputFolder(folder: string): void {
    this.change({ type: 'update', values: { outputFolder: folder } });
  }

  setOverwrite(v: boolean): void {
    this.change({ type: 'update', values: { overwrite: v } });
  }

  setShowDirectoryTree(v: boolean): void {
    this.change({ type: 'update', values: { showDirectoryTree: v } });
  }

  setMaxConcurrent(v: number): void {
    this.change({ type: 'update', values: { maxConcurrent: v } });
  }

  setGrouping(field: keyof GroupingOptions, v: boolean): void {
    this.change({
      type: 'update',
      values: { grouping: { ...this.grouping, [field]: v } },
    });
  }

  setExtEnabled(ext: string, enabled: boolean): void {
    const enabledExts = enabled
      ? [...new Set([...this.enabledExts, ext])]
      : this.enabledExts.filter(e => e !== ext);
    this.change({ type: 'update', values: { enabledExts } });
  }

  setSetting<K extends keyof EncodeSettings>(key: K, value: EncodeSettings[K]): void {
    this.change({
      type: 'update',
      values: { settings: { ...this.settings, [key]: value } },
    });
  }

  resetSettings(): void {
    this.change({
      type: 'update',
      values: {
        settings: { ...DEFAULT_SETTINGS },
        showDirectoryTree: true,
        maxConcurrent: 1,
      },
    });
  }

  clearSelectionSettings(): void {
    if (this.selection.kind === 'group') {
      this.change({
        type: 'setOverride', scope: 'group', key: this.selection.key, value: null,
      });
    } else if (this.selection.kind === 'file') {
      this.change({
        type: 'setOverride', scope: 'file', key: this.selection.path, value: null,
      });
    }
  }

  setOverride(
    map: 'group' | 'file', key: string,
    field: keyof EncodeSettings, value: number | string | undefined,
  ): void {
    const overrides = map === 'group' ? this.groupOverrides : this.fileOverrides;
    const o = { ...overrides.get(key) };
    if (value === undefined || value === '') delete o[field];
    else (o as any)[field] = value;
    this.change({
      type: 'setOverride',
      scope: map,
      key,
      value: Object.keys(o).length === 0 ? null : o,
    });
  }

  /** Exclude a file or folder path; removes it from the tree. */
  exclude(path: string): void {
    this.change({ type: 'exclude', paths: [path] });
    this.selection = { kind: 'root' };
  }

  /** Exclude every file currently in a group. */
  excludeGroup(key: string): void {
    const paths = (this.groupByKey(key)?.files ?? []).map(f => f.path);
    this.change({ type: 'exclude', paths });
    this.selection = { kind: 'root' };
  }

  removeExclusion(path: string): void {
    this.change({ type: 'removeExclusion', path });
  }

  async addFolder(folder: string): Promise<void> {
    if (!folder) return;
    this.scanning = true;
    await this.enqueueCommand({ type: 'addFolder', folder });
    runInAction(() => { this.scanning = false; });
  }

  /** Re-scan all root folders, replacing their file lists (picks up new/removed files). */
  async rescanAll(): Promise<void> {
    this.scanning = true;
    await this.enqueueCommand({ type: 'rescan' });
    runInAction(() => { this.scanning = false; });
  }

  removeRootFolder(folder: string): void {
    this.change({ type: 'removeRoot', folder });
  }

  /** Enqueue the given files (defaults to the current selection). */
  isStartable(path: string): boolean {
    const status = this.statusOf(path);
    return status === 'notQueued' || status === 'error';
  }

  async start(files: MediaFileInfo[] = this.selectedFiles): Promise<void> {
    await this.lastSync;
    const startable = files.filter(f => this.isStartable(f.path));
    if (startable.length === 0) return;
    if (!this.outputFolder) {
      this.error = 'Set an output folder first.';
      return;
    }
    const res = await this.fetcher('/api/enqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: startable.map(f => f.path) }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) await this.handleConflict(data.error);
      else runInAction(() => { this.error = data.error ?? 'Could not start the files.'; });
      return;
    }
    runInAction(() => {
      for (const f of startable) {
        const cur = this.jobs.get(f.path);
        if (!cur || cur.status === 'notQueued' || cur.status === 'error')
          this.jobs.set(f.path, { path: f.path, status: 'enqueued', progress: 0 });
      }
    });
  }

  /** Stop currently processing jobs within the supplied page scope. */
  async stopProcessing(
    files: MediaFileInfo[] = this.selectedFiles,
    deletePartial = true,
  ): Promise<void> {
    const paths = files
      .filter(f => this.statusOf(f.path) === 'processing')
      .map(f => f.path);
    if (paths.length === 0) return;
    await this.fetcher('/api/unqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths, deletePartial }),
    });
  }

  /** Revert waiting jobs within the supplied page scope to notQueued. */
  async cancelQueue(files: MediaFileInfo[] = this.selectedFiles): Promise<void> {
    const paths = files
      .filter(f => this.statusOf(f.path) === 'enqueued')
      .map(f => f.path);
    if (paths.length === 0) return;
    await this.fetcher('/api/unqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths }),
    });
    const cancelled = new Set(paths);
    runInAction(() => {
      for (const [path, job] of this.jobs)
        if (cancelled.has(path) && job.status === 'enqueued')
          this.jobs.set(path, { path, status: 'notQueued', progress: 0 });
    });
  }

  /** Clear every entry except the active encode; queued work is cancelled first. */
  async clearAll(): Promise<void> {
    await this.enqueueCommand({ type: 'clearAll' });
  }

  /** Clear entries which have never been queued or were cancelled. */
  async clearUnqueued(files: MediaFileInfo[] = this.files): Promise<void> {
    await this.enqueueCommand({
      type: 'clearUnqueued',
      paths: files.map(f => f.path),
    });
  }

  async revealInFileManager(path: string): Promise<void> {
    this.error = '';
    try {
      const res = await this.fetcher('/api/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Could not reveal the file in its file manager.');
      }
    } catch (err: any) {
      runInAction(() => {
        this.error = String(err.message ?? err);
      });
    }
  }

  async openFile(path: string): Promise<void> {
    this.error = '';
    try {
      const res = await this.fetcher('/api/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Could not open the file.');
      }
    } catch (err: any) {
      runInAction(() => {
        this.error = String(err.message ?? err);
      });
    }
  }

  applyJobUpdate(state: JobState): void {
    this.jobs.set(state.path, state);
  }

  /** Hydrate the browser mirror from the backend without touching the filesystem. */
  async loadState(): Promise<void> {
    this.loadingState = true;
    try {
      const res = await this.fetcher('/api/state');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      runInAction(() => {
        this.applySnapshot(data as StateSnapshot);
        this.error = '';
      });
    } catch (err: any) {
      runInAction(() => {
        this.error = `Could not load server state: ${String(err.message ?? err)}`;
      });
    } finally {
      runInAction(() => { this.loadingState = false; });
    }
  }

  private applyEditableState(state: AppState): void {
    this.state = state;
    if (this.selection.kind === 'file' && !this.fileByPath(this.selection.path))
      this.selection = { kind: 'root' };
    if (this.selection.kind === 'group' && !this.groupByKey(this.selection.key))
      this.selection = { kind: 'root' };
  }

  private applySnapshot(snapshot: StateSnapshot): void {
    this.revision = snapshot.revision;
    this.applyEditableState(snapshot.state);
    this.jobs = new Map(snapshot.jobs.map(job => [job.path, job]));
  }

  private change(command: StateCommand): void {
    applyStateCommand(this.state, command);
    void this.enqueueCommand(command);
  }

  private enqueueCommand(command: StateCommand): Promise<void> {
    const completion = new Promise<void>(resolve => {
      this.pending.push({ command, done: resolve });
      void this.drainCommands();
    });
    this.lastSync = completion;
    return completion;
  }

  private async drainCommands(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    try {
      while (this.pending.length > 0) {
        const current = this.pending[0];
        let res: Response;
        let data: any;
        try {
          res = await this.fetcher('/api/state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              revision: this.revision,
              command: current.command,
            }),
          });
          data = await res.json();
        } catch (err: any) {
          await this.handleConflict(
            `Could not confirm the change with the server: ${String(err.message ?? err)}`,
          );
          break;
        }

        if (!res.ok) {
          if (res.status === 409) await this.handleConflict(data.error);
          else {
            const rejected = this.pending.shift()!;
            runInAction(() => {
              this.error = data.error ?? 'The server rejected the change.';
            });
            rejected.done();
            continue;
          }
          this.finishPending();
          break;
        }

        const completed = this.pending.shift()!;
        runInAction(() => {
          this.revision = data.revision;
          if (data.state) {
            this.applySnapshot(data as StateSnapshot);
            for (const pending of this.pending)
              applyStateCommand(this.state, pending.command);
          }
          this.error = '';
        });
        completed.done();
      }
    } finally {
      this.syncing = false;
    }
  }

  private finishPending(): void {
    for (const pending of this.pending.splice(0)) pending.done();
  }

  private async handleConflict(message = 'The server state no longer matches this page.'): Promise<void> {
    this.finishPending();
    const reload = this.confirmReload(`${message}\n\nReload state from the server?`);
    if (reload) {
      await this.loadState();
    } else {
      runInAction(() => {
        this.error = `${message} Reload the page before making more changes.`;
      });
    }
  }

  /** Subscribe to the server's SSE job-update stream. */
  connectEvents(): void {
    const es = new EventSource('/api/events');
    es.onmessage = ev => this.applyJobUpdate(JSON.parse(ev.data));
  }
}
