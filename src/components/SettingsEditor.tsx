import { observer } from 'mobx-react-lite';
import { styled } from '../styled.js';
import type { EncodeSettings, SettingsOverride } from '../../shared/types.js';
import { Tip, DensityTip } from './Tip.js';

const Row = styled('label')`
  display: flex; align-items: center; gap: 8px; margin: 4px 0;
  & > span:first-child { width: 220px; color: #bbb; }
`;

const TIPS: Partial<Record<keyof EncodeSettings, React.ReactNode>> = {
  compressionRatio: <span>
    Target output size = input size ÷ ratio, e.g. ratio <b>4</b> aims to turn a
    800 MB video into a ~200 MB one. Used in <b>target rate</b> mode (for images
    and in quality mode, the quality slider decides instead). The resulting
    density is still clamped to the min/max limits below.
  </span>,
  minDensity: <span>
    Floor for the target density, protecting low-bitrate files from ratio
    over-shrinking. {DensityTip} e.g. min <b>0.05</b> stops a 1080p30 video
    from being targeted below ~104 kbps, or 48 kHz stereo audio below ~4.8 kbps.
  </span>,
  maxDensity: <span>
    Ceiling for the target density, so barely-compressed sources (e.g. WAV
    audio at 16 b/smp) don't get absurdly large targets. {DensityTip}
    e.g. max <b>4</b> caps 1080p30 video at ~8.3 Mbps and 48 kHz stereo audio
    at ~384 kbps.
  </span>,
  rateMode: <span>
    <b>Prefer target rate</b>: encode to the bitrate implied by ratio and
    density limits — predictable sizes (e.g. ratio 4 → ~4× smaller), variable
    quality. Image formats don't support it and always use the quality slider.<br />
    <b>Prefer quality setting</b>: encode with the quality slider — consistent
    quality, unpredictable sizes. Opus audio doesn't support it and always
    uses the target rate.
  </span>,
  quality: <span>
    0 = worst, 100 = best; mapped to each format's native scale, e.g. <b>75</b>
    becomes WebP <code>-quality 75</code>, JPEG <code>-q:v 9</code>,
    AV1/x264 <code>CRF 16/13</code>, MP3 <code>-q:a 2</code>. Always used for
    images; used for video/audio in quality mode.
  </span>,
  videoCodec: <span>
    AV1 compresses best but encodes slowest (e.g. roughly half the bitrate of
    H.264 at similar quality); H.264 is fastest and most compatible; HEVC is
    in between. Output container is <code>.mkv</code>.
  </span>,
  imageFormat: <span>
    WebP is a good default (~30% smaller than JPEG at similar quality);
    AVIF compresses best but is slowest and less widely supported;
    JPEG is universal.
  </span>,
  audioCodec: <span>
    Opus compresses best (fine music quality at ~96 kbps stereo, where MP3
    needs ~192 kbps) but has no quality mode; AAC and MP3 are more compatible.
  </span>,
  effort: <span>
    How hard the encoder works: higher = slower but smaller/better output,
    e.g. for AV1, effort <b>6</b> → SVT preset 6 (balanced) while <b>10</b> →
    preset 2 (many times slower, a few % smaller). Mapped to
    <code> veryfast…veryslow</code> for x264/x265. Images ignore this.
  </span>,
};

const NUMERIC_FIELDS: { key: keyof EncodeSettings; label: string }[] = [
  { key: 'compressionRatio', label: 'Compression ratio (x smaller)' },
  { key: 'minDensity', label: 'Min density' },
  { key: 'maxDensity', label: 'Max density' },
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
    {NUMERIC_FIELDS.map(({ key, label }) =>
      <Row key={key}>
        <span><Tip tip={TIPS[key]}>{label}</Tip></span>
        <input type="number" step="any" style={{ width: 90 }}
          value={val(key) as number | undefined ?? ''}
          placeholder={isOverride ? String(base[key]) : undefined}
          onChange={e => onChange(key,
            e.target.value === '' ? undefined : Number(e.target.value))} />
      </Row>)}
    <Row>
      <span><Tip tip={TIPS.rateMode}>Rate control</Tip></span>
      <label>
        <input type="radio" checked={eff('rateMode') === 'bitrate'}
          onChange={() => onChange('rateMode', 'bitrate')} /> Prefer target rate
      </label>
      <label>
        <input type="radio" checked={eff('rateMode') === 'quality'}
          onChange={() => onChange('rateMode', 'quality')} /> Prefer quality setting
      </label>
    </Row>
    <Row>
      <span><Tip tip={TIPS.quality}>Quality (0 worst – 100 best)</Tip></span>
      <input type="range" min={0} max={100} step={1} value={eff('quality') as number}
        onChange={e => onChange('quality', Number(e.target.value))} />
      <span>{eff('quality')}{isOverride && override.quality === undefined ? ' (inherited)' : ''}</span>
    </Row>
    {CODEC_FIELDS.map(({ key, label, options }) =>
      <Row key={key}>
        <span><Tip tip={TIPS[key]}>{label}</Tip></span>
        <select value={(val(key) as string | undefined) ?? (isOverride ? '' : base[key] as string)}
          onChange={e => onChange(key, e.target.value || undefined)}>
          {isOverride && <option value="">(inherit: {String(base[key])})</option>}
          {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
        </select>
      </Row>)}
    <Row>
      <span><Tip tip={TIPS.effort}>Effort (0 fast – 10 best)</Tip></span>
      <input type="range" min={0} max={10} step={1} value={eff('effort') as number}
        onChange={e => onChange('effort', Number(e.target.value))} />
      <span>{eff('effort')}{isOverride && override.effort === undefined ? ' (inherited)' : ''}</span>
    </Row>
  </div>;
});
