import { observer } from 'mobx-react-lite';
import { styled } from '../styled.js';
import type { EncodeSettings, SettingsOverride } from '../../shared/types.js';

const Row = styled('label')`
  display: flex; align-items: center; gap: 8px; margin: 4px 0;
  & > span:first-child { width: 220px; color: #bbb; }
`;

const NUMERIC_FIELDS: { key: keyof EncodeSettings; label: string; title?: string }[] = [
  { key: 'compressionRatio', label: 'Compression ratio (x smaller)' },
  { key: 'minDensity', label: 'Min density (~1 is typical)',
    title: 'bits per pixel·second (video), per pixel (image), per sample (audio)' },
  { key: 'maxDensity', label: 'Max density',
    title: 'bits per pixel·second (video), per pixel (image), per sample (audio)' },
];

const CODEC_FIELDS: { key: keyof EncodeSettings; label: string; options: [string, string][] }[] = [
  { key: 'videoCodec', label: 'Video codec', options: [
    ['av1', 'AV1 (libsvtav1)'], ['hevc', 'HEVC (libx265)'], ['h264', 'H.264 (libx264)']] },
  { key: 'imageFormat', label: 'Image format', options: [
    ['webp', 'WebP'], ['jpeg', 'JPEG'], ['avif', 'AVIF']] },
  { key: 'audioCodec', label: 'Audio codec', options: [
    ['opus', 'Opus'], ['aac', 'AAC'], ['mp3', 'MP3']] },
];

/**
 * Edits either the global settings (pass only `base`) or an override layer
 * (pass `override` too); empty fields in override mode mean "inherit".
 */
export const SettingsEditor = observer(function SettingsEditor(props: {
  base: EncodeSettings;
  override?: SettingsOverride;
  onChange: (field: keyof EncodeSettings, value: number | string | undefined) => void;
}) {
  const { base, override, onChange } = props;
  const isOverride = override !== undefined;
  const val = (k: keyof EncodeSettings) => (isOverride ? override[k] : base[k]);
  const eff = (k: keyof EncodeSettings) => val(k) ?? base[k];
  return <div>
    {NUMERIC_FIELDS.map(({ key, label, title }) =>
      <Row key={key} title={title}>
        <span>{label}</span>
        <input type="number" step="any" style={{ width: 90 }}
          value={val(key) as number | undefined ?? ''}
          placeholder={isOverride ? String(base[key]) : undefined}
          onChange={e => onChange(key,
            e.target.value === '' ? undefined : Number(e.target.value))} />
      </Row>)}
    <Row>
      <span>Rate control</span>
      <label title="Encode to a target bitrate computed from ratio and density limits. Not supported by image formats, which always use the quality setting.">
        <input type="radio" checked={eff('rateMode') === 'bitrate'}
          onChange={() => onChange('rateMode', 'bitrate')} /> Prefer target rate
      </label>
      <label title="Encode with the quality slider instead of a bitrate. Not supported by Opus audio, which always uses the target rate.">
        <input type="radio" checked={eff('rateMode') === 'quality'}
          onChange={() => onChange('rateMode', 'quality')} /> Prefer quality setting
      </label>
    </Row>
    <Row>
      <span>Quality (0 worst – 100 best)</span>
      <input type="range" min={0} max={100} step={1} value={eff('quality') as number}
        onChange={e => onChange('quality', Number(e.target.value))} />
      <span>{eff('quality')}{isOverride && override.quality === undefined ? ' (inherited)' : ''}</span>
    </Row>
    {CODEC_FIELDS.map(({ key, label, options }) =>
      <Row key={key}>
        <span>{label}</span>
        <select value={(val(key) as string | undefined) ?? (isOverride ? '' : base[key] as string)}
          onChange={e => onChange(key, e.target.value || undefined)}>
          {isOverride && <option value="">(inherit: {String(base[key])})</option>}
          {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
        </select>
      </Row>)}
    <Row>
      <span>Effort (0 fast – 10 best)</span>
      <input type="range" min={0} max={10} step={1} value={eff('effort') as number}
        onChange={e => onChange('effort', Number(e.target.value))} />
      <span>{eff('effort')}{isOverride && override.effort === undefined ? ' (inherited)' : ''}</span>
    </Row>
  </div>;
});
