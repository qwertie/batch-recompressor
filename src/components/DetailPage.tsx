import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { styled } from '../styled.js';
import type { ViewModel } from '../viewmodel.js';
import { SettingsEditor } from './SettingsEditor.js';
import { FileTypeTree } from './FileTypeTree.js';
import { density, densityUnit, estimatedSize, supportsQualityMode } from '../../shared/encode.js';
import { Tip, DensityTip } from './Tip.js';

const Page = styled('div')`flex: 1; padding: 12px 16px; overflow: auto;`;
const ExplorerLink = styled('button')`
  padding: 0; border: 0; background: none; color: #8fc7ff; cursor: pointer;
  font: inherit; font-weight: inherit; text-align: left; word-break: break-all;
  text-decoration: underline;
  &:hover { color: #b9dcff; }
`;
const TableLink = styled('button')`
  padding: 0; border: 0; background: none; color: #8fc7ff; cursor: pointer;
  font: inherit; text-align: left; text-decoration: underline;
  &:hover { color: #b9dcff; }
`;
const StatusLink = styled('button')`
  padding: 0; border: 0; background: none; color: inherit; cursor: pointer;
  font: inherit; text-align: left; text-decoration: underline;
`;
const Btn = styled('button')`
  margin-right: 8px; padding: 4px 12px; cursor: pointer;
`;
const ActionRow = styled('div')`
  display: flex; align-items: center; margin-top: 16px;
`;
const StopBtn = styled(Btn)`margin-left: auto; margin-right: 0;`;
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
  const [folderInput, setFolderInput] = useState('');
  const addFolder = () => { if (folderInput) { vm.addFolder(folderInput); setFolderInput(''); } };
  const processing = [...vm.jobs.values()].some(j => j.status === 'processing');
  const enqueued = [...vm.jobs.values()].some(j => j.status === 'enqueued');
  const unqueued = files.some(f => vm.statusOf(f.path) === 'notQueued');
  const stopCurrent = () => {
    const deletePartial = window.confirm(
      'Stop the current encode?\n\nOK deletes its partial output. Cancel keeps the partial output.',
    );
    void vm.stopCurrent(deletePartial);
  };

  let title = 'All files';
  let settingsEditor;
  let excludeAction = null;
  if (sel.kind === 'root') {
    settingsEditor = <>
      <h3>Global settings</h3>
      <SettingsEditor base={vm.settings}
        onChange={(k, v) => v !== undefined && vm.setSetting(k, v as never)} />
      <label><Tip tip={<span>
        Outputs mirror the input structure: if you added <code>C:\A\B</code>,
        then <code>C:\A\B\C\D.mp4</code> is written to
        <code> &lt;output&gt;\C\D.mkv</code>. Files already inside the output
        folder are excluded from scanning, so it's safe to put it under an
        input folder.
      </span>}>Output folder</Tip>{' '}
        <input size={50} value={vm.outputFolder} placeholder="e.g. C:/Recompressed"
          onChange={e => vm.setOutputFolder(e.target.value)} />
      </label>
      <label style={{ display: 'block', margin: '4px 0' }}>
        <input type="checkbox" checked={vm.overwrite}
          onChange={e => vm.setOverwrite(e.target.checked)} />
        {' '}<Tip tip={<span>
          When unchecked, a file whose output already exists is marked
          finished without re-encoding — so you can re-run a big batch and
          only new files are processed. Check this to re-encode everything,
          e.g. after changing quality settings.
        </span>}>Overwrite existing output files</Tip>
      </label>

      <h3>Add media</h3>
      <div>
        <input placeholder="Folder to add…" value={folderInput} size={40}
          onChange={e => setFolderInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addFolder(); }} />
        {' '}
        <Btn disabled={vm.scanning || !folderInput} onClick={addFolder}>
          {vm.scanning ? 'Scanning…' : 'Add folder'}
        </Btn>
      </div>

      <h3>File types to scan</h3>
      <FileTypeTree vm={vm} />
      <h3><Tip tip={<span>
        Files always group by media kind and by compression density (splitting
        when two files differ by more than 25%, e.g. 0.9 and 1.3 b/px·s end up
        apart). {DensityTip} These checkboxes additionally split groups by
        resolution (sample rate/channels for audio) and framerate — untick
        both to group purely by density, e.g. putting a 720p and a 1080p video
        with similar density together.
      </span>}>Grouping</Tip></h3>
      <label style={{ marginRight: 16 }}>
        <input type="checkbox" checked={vm.grouping.byResolution}
          onChange={e => vm.setGrouping('byResolution', e.target.checked)} />
        {' '}Group by resolution
      </label>
      <label>
        <input type="checkbox" checked={vm.grouping.byFps}
          onChange={e => vm.setGrouping('byFps', e.target.checked)} />
        {' '}Group by framerate
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
    excludeAction = <Btn onClick={() => vm.excludeGroup(sel.key)}>Exclude this</Btn>;
    settingsEditor = <>
      <h3>Group overrides</h3>
      <SettingsEditor base={vm.settings} override={vm.groupOverrides.get(sel.key) ?? {}}
        onChange={(k, v) => vm.setOverride('group', sel.key, k, v)} />
    </>;
  } else {
    const f = vm.fileByPath(sel.path);
    title = sel.path;
    excludeAction = <Btn onClick={() => vm.exclude(sel.path)}>Exclude this</Btn>;
    settingsEditor = f && <>
      <h3>File overrides</h3>
      <SettingsEditor base={vm.settings} override={vm.fileOverrides.get(sel.path) ?? {}}
        onChange={(k, v) => vm.setOverride('file', sel.path, k, v)} />
    </>;
  }

  return <Page>
    <h2 style={{ wordBreak: 'break-all' }}>
      {sel.kind === 'file'
        ? <ExplorerLink title="Show in file manager"
            onClick={() => vm.revealInFileManager(sel.path)}>
            {title}
          </ExplorerLink>
        : title}
    </h2>
    {vm.error && <p style={{ color: '#e05555' }}>{vm.error}</p>}
    <div>
      {sel.kind === 'root' && vm.rootFolders.length > 0 &&
        <Btn onClick={() => vm.rescanAll()} disabled={vm.scanning}>
          {vm.scanning ? 'Scanning…' : '⟳ Rescan'}
        </Btn>}
      {sel.kind === 'root'
        ? <Btn onClick={() => vm.resetSettings()}>Reset global settings</Btn>
        : <Btn onClick={() => vm.clearSelectionSettings()}>
            Clear settings (use global)
          </Btn>}
    </div>
    {files.length > 0 && <p style={{ color: '#999' }}>
      {files.length} file{files.length === 1 ? '' : 's'},{' '}
      {fmtSize(files.reduce((a, f) => a + f.size, 0))} total, target ~
      {fmtSize(files.reduce((a, f) => a + estimatedSize(f, vm.effectiveSettings(f)), 0))}
      {' '}(bitrate mode estimate)
    </p>}
    {settingsEditor}
    <ActionRow>
      <Btn onClick={() => vm.start()} disabled={files.length === 0}>
        |&gt; Start ({files.length})
      </Btn>
      {sel.kind === 'root'
        ? <Btn onClick={() => vm.clearAll()} disabled={vm.files.length === 0}>Clear all</Btn>
        : excludeAction}
      <Btn onClick={() => vm.clearUnqueued(files)} disabled={!unqueued}>Clear unqueued</Btn>
      <Btn onClick={() => vm.cancelQueue()} disabled={!enqueued}>Cancel queue</Btn>
      {processing && <StopBtn onClick={stopCurrent}>Stop</StopBtn>}
    </ActionRow>
    <Table>
      <thead><tr>
        <th>File</th><th>Size</th>
        <th><Tip tip={DensityTip}>Density</Tip></th>
        <th><Tip tip={<span>
          What the encode aims for: an estimated output size in target-rate
          mode (input density ÷ ratio, clamped to the limits — e.g. a 100 MB
          video at ratio 4 shows ~25 MB), or the quality setting when that
          mode applies (always for images).
        </span>}>Target</Tip></th>
        <th>Status</th><th></th>
      </tr></thead>
      <tbody>
        {files.map(f => {
          const job = vm.jobs.get(f.path);
          const status = job?.status ?? 'notQueued';
          const eff = vm.effectiveSettings(f);
          const statusLabel = status === 'processing'
            ? `processing ${Math.round((job?.progress ?? 0) * 100)}%`
            : status === 'error' ? `error: ${job?.error}` : status;
          const outputLabel = statusLabel + (status === 'finished' && job?.outputSize
            ? ` (${fmtSize(job.outputSize)})` : '');
          const revealOutput = (status === 'processing' || status === 'finished')
            && job?.outputPath;
          return <tr key={f.path}>
            <td style={{ wordBreak: 'break-all' }}>
              <TableLink title="Open file" onClick={() => vm.openFile(f.path)}>
                {f.path}
              </TableLink>
            </td>
            <td>{fmtSize(f.size)}</td>
            <td>{density(f).toFixed(2)} {densityUnit(f.kind)}</td>
            <td>{f.kind !== 'image' && (eff.rateMode === 'bitrate' || !supportsQualityMode(f.kind, eff))
              ? `~${fmtSize(estimatedSize(f, eff))}`
              : `quality ${eff.quality}`}</td>
            <StatusCell status={status}>
              {revealOutput
                ? <StatusLink title="Show output in file manager"
                    onClick={() => vm.revealInFileManager(job.outputPath!)}>
                    {outputLabel}
                  </StatusLink>
                : outputLabel}
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
