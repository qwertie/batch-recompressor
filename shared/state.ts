import type { EncodeSettings, JobState, MediaFileInfo, SettingsOverride } from './types.js';
import { DEFAULT_SETTINGS } from './types.js';
import type { GroupingOptions } from './grouping.js';
import { DEFAULT_GROUPING, groupFiles } from './grouping.js';
import { ALL_EXTENSIONS } from './filetypes.js';
import { isExcluded, isInside, normPath } from './paths.js';

export interface AppState {
  rootFolders: string[];
  files: MediaFileInfo[];
  exclusions: string[];
  outputFolder: string;
  overwrite: boolean;
  showDirectoryTree: boolean;
  maxConcurrent: number;
  settings: EncodeSettings;
  grouping: GroupingOptions;
  enabledExts: string[];
  groupOverrides: [string, SettingsOverride][];
  fileOverrides: [string, SettingsOverride][];
}

export interface StateSnapshot {
  revision: number;
  state: AppState;
  jobs: JobState[];
}

type StateValues = Pick<AppState,
  'outputFolder' | 'overwrite' | 'showDirectoryTree' | 'maxConcurrent'
  | 'settings' | 'grouping' | 'enabledExts'>;

export type StateCommand =
  | { type: 'update'; values: Partial<StateValues> }
  | {
    type: 'setOverride';
    scope: 'group' | 'file';
    key: string;
    value: SettingsOverride | null;
  }
  | { type: 'exclude'; paths: string[] }
  | { type: 'removeExclusion'; path: string }
  | { type: 'removeRoot'; folder: string }
  | { type: 'addFolder'; folder: string }
  | { type: 'rescan' }
  | { type: 'clearAll' }
  | { type: 'clearUnqueued'; paths: string[] };

export function initialAppState(): AppState {
  return {
    rootFolders: [],
    files: [],
    exclusions: [],
    outputFolder: '',
    overwrite: false,
    showDirectoryTree: true,
    maxConcurrent: 1,
    settings: { ...DEFAULT_SETTINGS },
    grouping: { ...DEFAULT_GROUPING },
    enabledExts: [...ALL_EXTENSIONS],
    groupOverrides: [],
    fileOverrides: [],
  };
}

export function cloneAppState(state: AppState): AppState {
  return structuredClone(state);
}

export interface SettingsIndex {
  groupKeys: Map<string, string>;
  groupOverrides: Map<string, SettingsOverride>;
  fileOverrides: Map<string, SettingsOverride>;
}

/** Precompute settings lookups once for rendering or enqueueing many files. */
export function settingsIndex(state: AppState): SettingsIndex {
  const groupKeys = new Map<string, string>();
  for (const group of groupFiles(
    state.files.filter(f =>
      !isExcluded(f.path, state.outputFolder, state.exclusions)),
    state.grouping,
  )) {
    for (const file of group.files) groupKeys.set(file.path, group.key);
  }
  return {
    groupKeys,
    groupOverrides: new Map(state.groupOverrides),
    fileOverrides: new Map(state.fileOverrides),
  };
}

export function effectiveSettingsFor(
  state: AppState, file: MediaFileInfo, index = settingsIndex(state),
): EncodeSettings {
  const groupKey = index.groupKeys.get(file.path);
  return {
    ...state.settings,
    ...(groupKey ? index.groupOverrides.get(groupKey) : undefined),
    ...index.fileOverrides.get(file.path),
  };
}

function overrideEntries(
  state: AppState, scope: 'group' | 'file',
): [string, SettingsOverride][] {
  return scope === 'group' ? state.groupOverrides : state.fileOverrides;
}

/** Apply an immediate, deterministic command shared by the server and browser mirror. */
export function applyStateCommand(
  state: AppState, command: StateCommand, strict = false,
): string | undefined {
  switch (command.type) {
    case 'update': {
      const values = command.values;
      if (values.outputFolder !== undefined) state.outputFolder = values.outputFolder;
      if (values.overwrite !== undefined) state.overwrite = values.overwrite;
      if (values.showDirectoryTree !== undefined)
        state.showDirectoryTree = values.showDirectoryTree;
      if (values.maxConcurrent !== undefined) state.maxConcurrent = values.maxConcurrent;
      if (values.settings !== undefined) state.settings = { ...values.settings };
      if (values.grouping !== undefined) state.grouping = { ...values.grouping };
      if (values.enabledExts !== undefined) state.enabledExts = values.enabledExts.slice();
      state.maxConcurrent = Math.min(8, Math.max(1, Math.round(state.maxConcurrent) || 1));
      return;
    }
    case 'setOverride': {
      const exists = command.scope === 'file'
        ? state.files.some(f => f.path === command.key)
        : groupFiles(
          state.files.filter(f =>
            !isExcluded(f.path, state.outputFolder, state.exclusions)),
          state.grouping,
        ).some(group => group.key === command.key);
      if (strict && !exists) return `The ${command.scope} being edited no longer exists.`;
      const entries = overrideEntries(state, command.scope);
      const index = entries.findIndex(([key]) => key === command.key);
      if (command.value && Object.keys(command.value).length > 0) {
        if (index < 0) entries.push([command.key, { ...command.value }]);
        else entries[index] = [command.key, { ...command.value }];
      } else if (index >= 0) {
        entries.splice(index, 1);
      }
      return;
    }
    case 'exclude': {
      if (strict) {
        const missing = command.paths.find(path =>
          !state.files.some(f => f.path === path));
        if (missing) return `The item being excluded no longer exists: ${missing}`;
      }
      for (const path of command.paths) {
        const normalized = normPath(path);
        if (!state.exclusions.includes(normalized)) state.exclusions.push(normalized);
      }
      return;
    }
    case 'removeExclusion': {
      if (strict && !state.exclusions.includes(command.path))
        return `The exclusion being removed no longer exists: ${command.path}`;
      state.exclusions = state.exclusions.filter(path => path !== command.path);
      return;
    }
    case 'removeRoot':
      if (strict && !state.rootFolders.includes(command.folder))
        return `The folder being removed no longer exists: ${command.folder}`;
      forgetRoots(state, [command.folder]);
      return;
    case 'addFolder':
    case 'rescan':
    case 'clearAll':
    case 'clearUnqueued':
      return; // Server-dependent commands are applied from their returned snapshot.
  }
}

/** Remove file records and every association belonging only to emptied roots. */
export function removeStateEntries(
  state: AppState, paths: string[], candidateRoots: string[] = [],
): void {
  const removed = new Set(paths);
  const removedRoots = [...new Set(state.files
    .filter(f => removed.has(f.path)).map(f => f.rootFolder))];
  const affectedGroupKeys = groupFiles(
    state.files.filter(f =>
      !isExcluded(f.path, state.outputFolder, state.exclusions)),
    state.grouping,
  ).filter(group => group.files.some(f => removed.has(f.path))).map(group => group.key);
  state.files = state.files.filter(f => !removed.has(f.path));
  state.fileOverrides = state.fileOverrides.filter(([path]) => !removed.has(path));

  const emptiedRoots = (candidateRoots.length > 0 ? candidateRoots : removedRoots).filter(root =>
    !state.files.some(f => f.rootFolder === root));
  forgetRoots(state, emptiedRoots);

  const remainingKeys = new Set(groupFiles(
    state.files.filter(f =>
      !isExcluded(f.path, state.outputFolder, state.exclusions)),
    state.grouping,
  ).map(group => group.key));
  state.groupOverrides = state.groupOverrides.filter(([key]) =>
    !affectedGroupKeys.includes(key) || remainingKeys.has(key));
}

function forgetRoots(state: AppState, roots: string[]): void {
  if (roots.length === 0) return;
  state.rootFolders = state.rootFolders.filter(root => !roots.includes(root));
  state.files = state.files.filter(f => !roots.includes(f.rootFolder));
  state.exclusions = state.exclusions.filter(path =>
    !roots.some(root => isInside(path, root)));
  state.fileOverrides = state.fileOverrides.filter(([path]) =>
    !roots.some(root => isInside(path, root)));

  const remainingKeys = new Set(groupFiles(
    state.files.filter(f =>
      !isExcluded(f.path, state.outputFolder, state.exclusions)),
    state.grouping,
  ).map(group => group.key));
  state.groupOverrides = state.groupOverrides.filter(([key]) => remainingKeys.has(key));
}
