import { makeAutoObservable, runInAction, autorun } from 'mobx';
import type {
  MediaFileInfo, JobState, JobStatus, EncodeSettings, SettingsOverride,
} from '../shared/types.js';
import { DEFAULT_SETTINGS } from '../shared/types.js';
import { groupFiles, DEFAULT_GROUPING, type FileGroup, type GroupingOptions } from '../shared/grouping.js';
import { ALL_EXTENSIONS } from '../shared/filetypes.js';
import { isExcluded, normPath } from '../shared/paths.js';

/** What the tree currently has selected: root, a group, or a single file. */
export type Selection =
  | { kind: 'root' }
  | { kind: 'group'; key: string }
  | { kind: 'file'; path: string };

export class ViewModel {
  /** Root folders added with the "Add folder" button. */
  rootFolders: string[] = [];
  /** All scanned (non-excluded) media files. */
  files: MediaFileInfo[] = [];
  /** Paths (files or folders) hidden from the tree. */
  exclusions: string[] = [];
  outputFolder = '';
  /** Re-encode even if the output file already exists. */
  overwrite = false;
  /** Show nested root/directory nodes in the sidebar instead of flat file paths. */
  showDirectoryTree = true;
  /** Maximum number of FFmpeg processes allowed to run at once. */
  maxConcurrent = 1;
  settings: EncodeSettings = { ...DEFAULT_SETTINGS };
  grouping: GroupingOptions = { ...DEFAULT_GROUPING };
  /** File extensions (lowercase, with dot) enabled for scanning. */
  enabledExts: string[] = [...ALL_EXTENSIONS];
  /** Per-group and per-file setting overrides, keyed by group key / file path. */
  groupOverrides = new Map<string, SettingsOverride>();
  fileOverrides = new Map<string, SettingsOverride>();
  /** Job states received from the server, keyed by file path. */
  jobs = new Map<string, JobState>();
  selection: Selection = { kind: 'root' };
  scanning = false;
  error = '';

  constructor(private fetcher: typeof fetch = fetch.bind(globalThis)) {
    makeAutoObservable(this);
  }

  // ---- derived state ----

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
    const group = this.groups.find(g => g.files.some(f => f.path === file.path));
    return {
      ...this.settings,
      ...(group ? this.groupOverrides.get(group.key) : undefined),
      ...this.fileOverrides.get(file.path),
    };
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

  setOutputFolder(folder: string): void { this.outputFolder = folder; }

  setOverwrite(v: boolean): void { this.overwrite = v; }

  setShowDirectoryTree(v: boolean): void { this.showDirectoryTree = v; }

  setMaxConcurrent(v: number): void {
    this.maxConcurrent = Math.min(8, Math.max(1, Math.round(v) || 1));
    void this.fetcher('/api/queue/concurrency', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxConcurrent: this.maxConcurrent }),
    }).catch(err => runInAction(() => { this.error = String(err.message ?? err); }));
  }

  setGrouping(field: keyof GroupingOptions, v: boolean): void { this.grouping[field] = v; }

  setExtEnabled(ext: string, enabled: boolean): void {
    if (enabled && !this.enabledExts.includes(ext)) this.enabledExts.push(ext);
    if (!enabled) this.enabledExts = this.enabledExts.filter(e => e !== ext);
  }

  setSetting<K extends keyof EncodeSettings>(key: K, value: EncodeSettings[K]): void {
    this.settings[key] = value;
  }

  resetSettings(): void {
    this.settings = { ...DEFAULT_SETTINGS };
    this.showDirectoryTree = true;
    this.setMaxConcurrent(1);
  }

  clearSelectionSettings(): void {
    if (this.selection.kind === 'group') this.groupOverrides.delete(this.selection.key);
    else if (this.selection.kind === 'file') this.fileOverrides.delete(this.selection.path);
  }

  setOverride(
    map: 'group' | 'file', key: string,
    field: keyof EncodeSettings, value: number | string | undefined,
  ): void {
    const overrides = map === 'group' ? this.groupOverrides : this.fileOverrides;
    const o = { ...overrides.get(key) };
    if (value === undefined || value === '') delete o[field];
    else (o as any)[field] = value;
    if (Object.keys(o).length === 0) overrides.delete(key);
    else overrides.set(key, o);
  }

  /** Exclude a file or folder path; removes it from the tree. */
  exclude(path: string): void {
    if (!this.exclusions.includes(normPath(path))) this.exclusions.push(normPath(path));
    this.selection = { kind: 'root' };
  }

  /** Exclude every file currently in a group. */
  excludeGroup(key: string): void {
    for (const f of this.groupByKey(key)?.files ?? []) {
      const p = normPath(f.path);
      if (!this.exclusions.includes(p)) this.exclusions.push(p);
    }
    this.selection = { kind: 'root' };
  }

  removeExclusion(path: string): void {
    this.exclusions = this.exclusions.filter(e => e !== path);
  }

  async addFolder(folder: string): Promise<void> {
    if (!folder) return;
    this.scanning = true;
    this.error = '';
    try {
      const res = await this.fetcher('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folder, outputFolder: this.outputFolder, exclusions: this.exclusions,
          extensions: this.enabledExts.slice(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      runInAction(() => {
        if (!this.rootFolders.includes(folder)) this.rootFolders.push(folder);
        const newFiles = (data as MediaFileInfo[])
          .filter(f => !this.files.some(x => x.path === f.path));
        this.files.push(...newFiles);
      });
    } catch (err: any) {
      runInAction(() => { this.error = String(err.message ?? err); });
    } finally {
      runInAction(() => { this.scanning = false; });
    }
  }

  /** Re-scan all root folders, replacing their file lists (picks up new/removed files). */
  async rescanAll(): Promise<void> {
    for (const folder of [...this.rootFolders]) {
      this.files = this.files.filter(f => f.rootFolder !== folder);
      await this.addFolder(folder);
    }
  }

  removeRootFolder(folder: string): void {
    this.rootFolders = this.rootFolders.filter(r => r !== folder);
    this.files = this.files.filter(f => f.rootFolder !== folder);
  }

  /** Enqueue the given files (defaults to the current selection). */
  isStartable(path: string): boolean {
    const status = this.statusOf(path);
    return status === 'notQueued' || status === 'error';
  }

  async start(files: MediaFileInfo[] = this.selectedFiles): Promise<void> {
    const startable = files.filter(f => this.isStartable(f.path));
    if (startable.length === 0) return;
    if (!this.outputFolder) {
      this.error = 'Set an output folder first.';
      return;
    }
    const payload = {
      outputFolder: this.outputFolder,
      overwrite: this.overwrite,
      maxConcurrent: this.maxConcurrent,
      files: startable.map(f => ({ info: f, settings: this.effectiveSettings(f) })),
    };
    await this.fetcher('/api/enqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
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

  /** Remove scanned entries from the UI; never delete source media. */
  async clearEntries(paths: string[]): Promise<void> {
    const processing = new Set([...this.jobs.values()]
      .filter(j => j.status === 'processing').map(j => j.path));
    const clearable = paths.filter(path => !processing.has(path));
    if (clearable.length === 0) return;
    await this.fetcher('/api/jobs/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: clearable }),
    });
    runInAction(() => {
      const removed = new Set(clearable);
      this.files = this.files.filter(f => !removed.has(f.path));
      for (const path of removed) {
        this.jobs.delete(path);
        this.fileOverrides.delete(path);
      }
      this.rootFolders = this.rootFolders.filter(root =>
        this.files.some(f => f.rootFolder === root));
      this.selection = { kind: 'root' };
    });
  }

  /** Clear every entry except the active encode; queued work is cancelled first. */
  async clearAll(files: MediaFileInfo[] = this.selectedFiles): Promise<void> {
    await this.cancelQueue(files);
    await this.clearEntries(files.map(f => f.path));
  }

  /** Clear entries which have never been queued or were cancelled. */
  async clearUnqueued(files: MediaFileInfo[] = this.files): Promise<void> {
    await this.clearEntries(files
      .filter(f => this.statusOf(f.path) === 'notQueued').map(f => f.path));
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

  /**
   * Load persisted settings from `storage` and save on every change.
   * Re-scans previously added folders after loading.
   */
  enablePersistence(storage: Pick<Storage, 'getItem' | 'setItem'>, key = 'batch-recompressor'): void {
    const raw = storage.getItem(key);
    if (raw) {
      try {
        const s = JSON.parse(raw);
        this.rootFolders = s.rootFolders ?? [];
        this.exclusions = s.exclusions ?? [];
        this.outputFolder = s.outputFolder ?? '';
        this.overwrite = s.overwrite ?? false;
        this.showDirectoryTree = s.showDirectoryTree ?? true;
        this.maxConcurrent = Math.min(8, Math.max(1, Math.round(s.maxConcurrent) || 1));
        this.settings = { ...DEFAULT_SETTINGS, ...s.settings };
        this.grouping = { ...DEFAULT_GROUPING, ...s.grouping };
        this.enabledExts = s.enabledExts ?? [...ALL_EXTENSIONS];
        this.groupOverrides = new Map(s.groupOverrides ?? []);
        this.fileOverrides = new Map(s.fileOverrides ?? []);
      } catch { /* corrupt state: start fresh */ }
    }
    autorun(() => storage.setItem(key, JSON.stringify({
      rootFolders: this.rootFolders.slice(),
      exclusions: this.exclusions.slice(),
      outputFolder: this.outputFolder,
      overwrite: this.overwrite,
      showDirectoryTree: this.showDirectoryTree,
      maxConcurrent: this.maxConcurrent,
      settings: { ...this.settings },
      grouping: { ...this.grouping },
      enabledExts: this.enabledExts.slice(),
      groupOverrides: [...this.groupOverrides.entries()],
      fileOverrides: [...this.fileOverrides.entries()],
    })));
    if (this.rootFolders.length > 0) void this.rescanAll();
  }

  /** Subscribe to the server's SSE job-update stream. */
  connectEvents(): void {
    const es = new EventSource('/api/events');
    es.onmessage = ev => this.applyJobUpdate(JSON.parse(ev.data));
  }
}
