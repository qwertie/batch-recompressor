import { makeAutoObservable, runInAction } from 'mobx';
import type {
  VideoFileInfo, JobState, JobStatus, EncodeSettings, SettingsOverride,
} from '../shared/types.js';
import { DEFAULT_SETTINGS } from '../shared/types.js';
import { groupFiles, type FileGroup } from '../shared/grouping.js';
import { isExcluded, normPath } from '../shared/paths.js';

/** What the tree currently has selected: root, a group, or a single file. */
export type Selection =
  | { kind: 'root' }
  | { kind: 'group'; key: string }
  | { kind: 'file'; path: string };

export class ViewModel {
  /** Root folders added with the "Add folder" button. */
  rootFolders: string[] = [];
  /** All scanned (non-excluded) video files. */
  files: VideoFileInfo[] = [];
  /** Paths (files or folders) hidden from the tree. */
  exclusions: string[] = [];
  outputFolder = '';
  settings: EncodeSettings = { ...DEFAULT_SETTINGS };
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

  get visibleFiles(): VideoFileInfo[] {
    return this.files.filter(f => !isExcluded(f.path, this.outputFolder, this.exclusions));
  }

  get groups(): FileGroup[] {
    return groupFiles(this.visibleFiles);
  }

  groupByKey(key: string): FileGroup | undefined {
    return this.groups.find(g => g.key === key);
  }

  fileByPath(path: string): VideoFileInfo | undefined {
    return this.files.find(f => f.path === path);
  }

  /** Effective settings for a file: global <- group override <- file override. */
  effectiveSettings(file: VideoFileInfo): EncodeSettings {
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
  get selectedFiles(): VideoFileInfo[] {
    const sel = this.selection;
    if (sel.kind === 'root') return this.visibleFiles;
    if (sel.kind === 'group') return this.groupByKey(sel.key)?.files ?? [];
    const f = this.fileByPath(sel.path);
    return f ? [f] : [];
  }

  // ---- actions ----

  select(sel: Selection): void { this.selection = sel; }

  setOutputFolder(folder: string): void { this.outputFolder = folder; }

  setSetting<K extends keyof EncodeSettings>(key: K, value: EncodeSettings[K]): void {
    this.settings[key] = value;
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

  /** Exclude a file or group; removes it from the tree. */
  exclude(path: string): void {
    if (!this.exclusions.includes(normPath(path))) this.exclusions.push(normPath(path));
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
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      runInAction(() => {
        if (!this.rootFolders.includes(folder)) this.rootFolders.push(folder);
        const newFiles = (data as VideoFileInfo[])
          .filter(f => !this.files.some(x => x.path === f.path));
        this.files.push(...newFiles);
      });
    } catch (err: any) {
      runInAction(() => { this.error = String(err.message ?? err); });
    } finally {
      runInAction(() => { this.scanning = false; });
    }
  }

  removeRootFolder(folder: string): void {
    this.rootFolders = this.rootFolders.filter(r => r !== folder);
    this.files = this.files.filter(f => f.rootFolder !== folder);
  }

  /** Enqueue the given files (defaults to the current selection). */
  async start(files: VideoFileInfo[] = this.selectedFiles): Promise<void> {
    if (!this.outputFolder) {
      this.error = 'Set an output folder first.';
      return;
    }
    const payload = {
      outputFolder: this.outputFolder,
      files: files.map(f => ({
        path: f.path, rootFolder: f.rootFolder,
        settings: this.effectiveSettings(f), kbps: f.kbps,
      })),
      durations: Object.fromEntries(files.map(f => [f.path, f.duration])),
    };
    await this.fetcher('/api/enqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    runInAction(() => {
      for (const f of files) {
        const cur = this.jobs.get(f.path);
        if (!cur || cur.status === 'notQueued' || cur.status === 'error')
          this.jobs.set(f.path, { path: f.path, status: 'enqueued', progress: 0 });
      }
    });
  }

  async stop(files: VideoFileInfo[] = this.selectedFiles): Promise<void> {
    await this.fetcher('/api/unqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: files.map(f => f.path) }),
    });
  }

  applyJobUpdate(state: JobState): void {
    this.jobs.set(state.path, state);
  }

  /** Subscribe to the server's SSE job-update stream. */
  connectEvents(): void {
    const es = new EventSource('/api/events');
    es.onmessage = ev => this.applyJobUpdate(JSON.parse(ev.data));
  }
}
