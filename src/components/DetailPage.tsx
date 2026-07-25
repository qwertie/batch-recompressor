import { observer } from 'mobx-react-lite';
import { styled } from '../styled.js';
import type { ViewModel } from '../viewmodel.js';
import { SettingsEditor } from './SettingsEditor.js';
import { targetKbps } from '../../shared/encode.js';

const Page = styled('div')`flex: 1; padding: 12px 16px; overflow: auto;`;
const Btn = styled('button')`
  margin-right: 8px; padding: 4px 12px; cursor: pointer;
`;
const Table = styled('table')`
  border-collapse: collapse; margin-top: 12px; width: 100%;
  & td, & th { padding: 3px 10px; text-align: left; border-bottom: 1px solid #333; }
  & th { color: #999; font-weight: normal; }
`;
const StatusCell = styled('td')<{ status: string }>`
  color: ${p => ({
    notQueued: '#888', enqueued: '#c9a227', processing: '#4da3ff',
    finished: '#5dbb63', error: '#e05555',
  } as Record<string, string>)[p.status]};
`;
const ExcludeList = styled('ul')`
  margin: 4px 0; padding-left: 20px;
  & li { margin: 2px 0; }
`;

const Bar = styled('div')`
  height: 4px; background: #333; border-radius: 2px; margin-top: 2px; width: 120px;
  & > div { height: 100%; background: #4da3ff; border-radius: 2px; }
`;

function fmtSize(bytes: number): string {
  if (bytes >= 1 << 30) return (bytes / (1 << 30)).toFixed(2) + ' GB';
  return (bytes / (1 << 20)).toFixed(1) + ' MB';
}

export const DetailPage = observer(function DetailPage(props: { vm: ViewModel }) {
  const { vm } = props;
  const sel = vm.selection;
  const files = vm.selectedFiles;

  let title = 'All files';
  let settingsEditor;
  let excludeBtn = null;
  if (sel.kind === 'root') {
    settingsEditor = <>
      <h3>Global settings</h3>
      <label>Output folder{' '}
        <input size={50} value={vm.outputFolder} placeholder="e.g. C:/Recompressed"
          onChange={e => vm.setOutputFolder(e.target.value)} />
      </label>
      <SettingsEditor base={vm.settings}
        onChange={(k, v) => v !== undefined && vm.setSetting(k, v as never)} />
      <label style={{ display: 'block', margin: '4px 0' }}>
        <input type="checkbox" checked={vm.overwrite}
          onChange={e => vm.setOverwrite(e.target.checked)} />
        {' '}Overwrite existing output files
      </label>
      {vm.exclusions.length > 0 && <>
        <h3>Exclusions</h3>
        <ExcludeList>
          {vm.exclusions.map(e => <li key={e}>
            {e} <Btn onClick={() => vm.removeExclusion(e)}>Remove</Btn>
          </li>)}
        </ExcludeList>
      </>}
      {vm.rootFolders.length > 0 && <>
        <h3>Added folders</h3>
        <ExcludeList>
          {vm.rootFolders.map(r => <li key={r}>
            {r} <Btn onClick={() => vm.removeRootFolder(r)}>Remove</Btn>
          </li>)}
        </ExcludeList>
      </>}
    </>;
  } else if (sel.kind === 'group') {
    const g = vm.groupByKey(sel.key);
    title = g?.label ?? 'Group';
    excludeBtn = <Btn onClick={() => vm.excludeGroup(sel.key)}>Exclude this</Btn>;
    settingsEditor = <>
      <h3>Group overrides</h3>
      <SettingsEditor base={vm.settings} override={vm.groupOverrides.get(sel.key) ?? {}}
        onChange={(k, v) => vm.setOverride('group', sel.key, k, v)} />
    </>;
  } else {
    const f = vm.fileByPath(sel.path);
    title = sel.path;
    excludeBtn = <Btn onClick={() => vm.exclude(sel.path)}>Exclude this</Btn>;
    settingsEditor = f && <>
      <h3>File overrides</h3>
      <SettingsEditor base={vm.settings} override={vm.fileOverrides.get(sel.path) ?? {}}
        onChange={(k, v) => vm.setOverride('file', sel.path, k, v)} />
    </>;
  }

  return <Page>
    <h2 style={{ wordBreak: 'break-all' }}>{title}</h2>
    {vm.error && <p style={{ color: '#e05555' }}>{vm.error}</p>}
    <div>
      <Btn onClick={() => vm.start()} disabled={files.length === 0}>
        ▶ Start ({files.length})
      </Btn>
      <Btn onClick={() => vm.stop()}>■ Stop / unqueue</Btn>
      {sel.kind === 'root' && vm.rootFolders.length > 0 &&
        <Btn onClick={() => vm.rescanAll()} disabled={vm.scanning}>
          {vm.scanning ? 'Scanning…' : '⟳ Rescan'}
        </Btn>}
      {excludeBtn}
    </div>
    {files.length > 0 && <p style={{ color: '#999' }}>
      {files.length} file{files.length === 1 ? '' : 's'},{' '}
      {fmtSize(files.reduce((a, f) => a + f.size, 0))} total, target ~
      {fmtSize(files.reduce((a, f) =>
        a + f.size * targetKbps(f.kbps, vm.effectiveSettings(f)) / Math.max(1, f.kbps), 0))}
    </p>}
    {settingsEditor}
    <Table>
      <thead><tr>
        <th>File</th><th>Size</th><th>Bitrate</th><th>Target</th><th>Status</th><th></th>
      </tr></thead>
      <tbody>
        {files.map(f => {
          const job = vm.jobs.get(f.path);
          const status = job?.status ?? 'notQueued';
          const eff = vm.effectiveSettings(f);
          return <tr key={f.path}>
            <td style={{ wordBreak: 'break-all', cursor: 'pointer' }}
              onClick={() => vm.select({ kind: 'file', path: f.path })}>{f.path}</td>
            <td>{fmtSize(f.size)}</td>
            <td>{f.kbps} kbps</td>
            <td>{targetKbps(f.kbps, eff)} kbps</td>
            <StatusCell status={status}>
              {status === 'processing'
                ? `processing ${Math.round((job?.progress ?? 0) * 100)}%`
                : status === 'error' ? `error: ${job?.error}` : status}
              {status === 'finished' && job?.outputSize
                ? ` (${fmtSize(job.outputSize)})` : ''}
              {status === 'processing' &&
                <Bar><div style={{ width: `${(job?.progress ?? 0) * 100}%` }} /></Bar>}
            </StatusCell>
            <td>
              {sel.kind !== 'file' &&
                <Btn title="Exclude this" onClick={() => vm.exclude(f.path)}>Exclude</Btn>}
            </td>
          </tr>;
        })}
      </tbody>
    </Table>
  </Page>;
});
