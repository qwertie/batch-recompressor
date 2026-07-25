import { observer } from 'mobx-react-lite';
import { styled } from '../styled.js';
import type { ViewModel } from '../viewmodel.js';
import { EXTENSIONS_BY_KIND } from '../../shared/filetypes.js';
import type { MediaKind } from '../../shared/types.js';

const Kinds = styled('div')`
  display: flex; gap: 24px; flex-wrap: wrap; margin: 4px 0;
`;
const ExtList = styled('div')`
  margin-left: 20px; display: grid; grid-template-columns: repeat(2, auto);
  column-gap: 12px;
  & label { white-space: nowrap; }
`;

const KIND_LABELS: Record<MediaKind, string> = {
  video: '🎞 Video', image: '🖼 Images', audio: '🔊 Audio',
};

/** Checkbox tree of scannable file types: three roots (video/images/audio). */
export const FileTypeTree = observer(function FileTypeTree(props: { vm: ViewModel }) {
  const { vm } = props;
  return <Kinds>
    {(Object.keys(EXTENSIONS_BY_KIND) as MediaKind[]).map(kind => {
      const exts = EXTENSIONS_BY_KIND[kind];
      const enabled = exts.filter(e => vm.enabledExts.includes(e));
      return <div key={kind}>
        <label>
          <input type="checkbox" checked={enabled.length === exts.length}
            ref={el => { if (el) el.indeterminate = enabled.length > 0 && enabled.length < exts.length; }}
            onChange={e => exts.forEach(x => vm.setExtEnabled(x, e.target.checked))} />
          {' '}<b>{KIND_LABELS[kind]}</b>
        </label>
        <ExtList>
          {exts.map(ext =>
            <label key={ext}>
              <input type="checkbox" checked={vm.enabledExts.includes(ext)}
                onChange={e => vm.setExtEnabled(ext, e.target.checked)} />
              {' '}{ext}
            </label>)}
        </ExtList>
      </div>;
    })}
  </Kinds>;
});
