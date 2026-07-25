import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { styled } from '../styled.js';
import type { ViewModel, Selection } from '../viewmodel.js';
import type { VideoFileInfo } from '../../shared/types.js';
import { normPath } from '../../shared/paths.js';

const NodeRow = styled('div')<{ selected?: boolean }>`
  padding: 2px 6px;
  cursor: pointer;
  white-space: nowrap;
  border-radius: 4px;
  background: ${p => (p.selected ? '#2d5b9e' : 'transparent')};
  &:hover { background: ${p => (p.selected ? '#2d5b9e' : '#333')}; }
`;
const Indent = styled('div')`margin-left: 16px;`;
const Toggle = styled('span')`
  display: inline-block; width: 14px; user-select: none; color: #888;
`;
const AddBtn = styled('button')`
  margin: 4px 0; padding: 2px 8px; cursor: pointer;
`;

/** A folder-hierarchy node built from file paths relative to a root folder. */
interface DirNode {
  name: string;
  children: Map<string, DirNode>;
  files: VideoFileInfo[];
}

function buildDirTree(files: VideoFileInfo[], root: string): DirNode {
  const top: DirNode = { name: root, children: new Map(), files: [] };
  for (const f of files) {
    const rel = normPath(f.path).slice(normPath(root).length + 1);
    const parts = rel.split('/');
    let node = top;
    for (const part of parts.slice(0, -1)) {
      let child = node.children.get(part);
      if (!child) node.children.set(part, (child = { name: part, children: new Map(), files: [] }));
      node = child;
    }
    node.files.push(f);
  }
  return top;
}

const statusIcon: Record<string, string> = {
  notQueued: '', enqueued: ' ⏳', processing: ' ▶', finished: ' ✔', error: ' ✖',
};

const Expandable = observer(function Expandable(props: {
  label: React.ReactNode; selected?: boolean; onClick?: () => void; children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return <div>
    <NodeRow selected={props.selected} onClick={props.onClick}>
      <Toggle onClick={e => { e.stopPropagation(); setOpen(!open); }}>
        {props.children ? (open ? '▾' : '▸') : ''}
      </Toggle>
      {props.label}
    </NodeRow>
    {open && props.children && <Indent>{props.children}</Indent>}
  </div>;
});

const DirTreeView = observer(function DirTreeView(props: { vm: ViewModel; node: DirNode }) {
  const { vm, node } = props;
  return <>
    {[...node.children.values()].map(child =>
      <Expandable key={child.name} label={'📁 ' + child.name}>
        <DirTreeView vm={vm} node={child} />
      </Expandable>)}
    {node.files.map(f => {
      const name = normPath(f.path).split('/').pop();
      const sel = vm.selection.kind === 'file' && vm.selection.path === f.path;
      return <NodeRow key={f.path} selected={sel}
        onClick={() => vm.select({ kind: 'file', path: f.path })}>
        🎞 {name}{statusIcon[vm.statusOf(f.path)]}
      </NodeRow>;
    })}
  </>;
});

export const Tree = observer(function Tree(props: { vm: ViewModel }) {
  const { vm } = props;
  const [folderInput, setFolderInput] = useState('');
  const isSel = (s: Selection) => JSON.stringify(s) === JSON.stringify(vm.selection);
  return <div>
    <Expandable label={<b>All files</b>} selected={isSel({ kind: 'root' })}
      onClick={() => vm.select({ kind: 'root' })}>
      {vm.groups.map(g => {
        const byRoot = new Map<string, VideoFileInfo[]>();
        for (const f of g.files) {
          let list = byRoot.get(f.rootFolder);
          if (!list) byRoot.set(f.rootFolder, (list = []));
          list.push(f);
        }
        return <Expandable key={g.key} label={g.label}
          selected={isSel({ kind: 'group', key: g.key })}
          onClick={() => vm.select({ kind: 'group', key: g.key })}>
          {[...byRoot.entries()].map(([root, files]) =>
            <Expandable key={root} label={'📂 ' + root}>
              <DirTreeView vm={vm} node={buildDirTree(files, root)} />
            </Expandable>)}
        </Expandable>;
      })}
    </Expandable>
    <div style={{ marginTop: 8 }}>
      <input placeholder="Folder to add…" value={folderInput} size={24}
        onChange={e => setFolderInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { vm.addFolder(folderInput); setFolderInput(''); } }} />
      <AddBtn disabled={vm.scanning || !folderInput}
        onClick={() => { vm.addFolder(folderInput); setFolderInput(''); }}>
        {vm.scanning ? 'Scanning…' : 'Add folder'}
      </AddBtn>
    </div>
  </div>;
});
