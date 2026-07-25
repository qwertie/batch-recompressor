import { observer } from 'mobx-react-lite';
import { styled } from '../styled.js';
import type { EncodeSettings, SettingsOverride } from '../../shared/types.js';

const Row = styled('label')`
  display: flex; align-items: center; gap: 8px; margin: 4px 0;
  & > span:first-child { width: 180px; color: #bbb; }
`;

const FIELDS: { key: keyof EncodeSettings; label: string }[] = [
  { key: 'compressionRatio', label: 'Compression ratio (x smaller)' },
  { key: 'minKbps', label: 'Min bitrate (kbps)' },
  { key: 'maxKbps', label: 'Max bitrate (kbps)' },
];

/**
 * Edits either the global settings (pass `settings`) or an override layer
 * (pass `override` + `base`); empty fields in override mode mean "inherit".
 */
export const SettingsEditor = observer(function SettingsEditor(props: {
  base: EncodeSettings;
  override?: SettingsOverride;
  onChange: (field: keyof EncodeSettings, value: number | string | undefined) => void;
}) {
  const { base, override, onChange } = props;
  const isOverride = override !== undefined;
  const val = (k: keyof EncodeSettings) =>
    isOverride ? override[k] : base[k];
  return <div>
    {FIELDS.map(({ key, label }) =>
      <Row key={key}>
        <span>{label}</span>
        <input type="number" step="any" style={{ width: 90 }}
          value={val(key) ?? ''}
          placeholder={isOverride ? String(base[key]) : undefined}
          onChange={e => onChange(key,
            e.target.value === '' ? undefined : Number(e.target.value))} />
      </Row>)}
    <Row>
      <span>Codec</span>
      <select value={val('codec') ?? (isOverride ? '' : base.codec)}
        onChange={e => onChange('codec', e.target.value || undefined)}>
        {isOverride && <option value="">(inherit: {base.codec})</option>}
        <option value="av1">AV1 (libsvtav1)</option>
        <option value="hevc">HEVC (libx265)</option>
        <option value="h264">H.264 (libx264)</option>
      </select>
    </Row>
    <Row>
      <span>Effort (0 fast – 10 best)</span>
      <input type="range" min={0} max={10} step={1}
        value={val('effort') ?? base.effort}
        onChange={e => onChange('effort', Number(e.target.value))} />
      <span>{val('effort') ?? base.effort}{isOverride && override.effort === undefined ? ' (inherited)' : ''}</span>
    </Row>
  </div>;
});
