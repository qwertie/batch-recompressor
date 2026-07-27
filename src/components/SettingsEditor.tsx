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
    This is the main setting controlling the <b>target rate</b>. The target
    rate is based on the target density formula:
    <code>TargetDensity = clamp(SourceDensity / CompressionRatio, MinDensity, MaxDensity)</code>

    <br />{DensityTip}
    <b>Min density</b> is the floor, protecting low-bitrate files from ratio
    over-shrinking. For example, min <b>0.1</b> stops a 1080p30 video from
    being targeted below ~208 kbps, or 48 kHz stereo audio below ~9.6 kbps.
    <br /><b>Max density</b> is the ceiling.
  </span>,
  maxWidth: <span>
    <b>Max width</b> and <b>Max height</b> shrink an image or video down when
    it is too large, while maintaining its aspect ratio. Leave either setting
    blank for no limit in that dimension. Density applies to the new output
    dimensions rather than the source dimensions. For example, if the limits
    cut both the width and height in half, and Compression ratio also cuts the
    size by about <b>3×</b>, the effective size reduction is about <b>12×</b>.
  </span>,
  maxSampleRate: <span>
    Maximum audio sample rate, when the target codec allows it; blank means no
    limit. This also applies to audio inside videos. By default, video audio is
    passed through unchanged. It is recompressed only when this limit is less
    than or equal to its current sample rate: 44,100 Hz with a 48,000 Hz limit
    passes through, while 44,100 Hz with a 44,100 Hz limit is recompressed.
    Pure audio files are always recompressed. Only when audio is recompressed
    do the density or quality settings apply to it. Density uses the limited
    output sample rate, not the original sample rate. FFmpeg uses the closest
    sample rate supported by the selected audio codec without exceeding the
    limit.
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
    0 = worst, 100 = best; mapped to each format's native scale, e.g. <b>75 </b>
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
    e.g. for AV1, effort <b>8</b> → SVT preset 4 while <b>10</b> →
    preset 2 (many times slower, a few % smaller). Mapped to
    <code> veryfast…veryslow</code> for x264/x265. Images ignore this.
  </span>,
};

const NUMERIC_FIELDS: { key: keyof EncodeSettings; label: string }[] = [
  { key: 'compressionRatio', label: 'Compression ratio (x smaller)' },
  { key: 'minDensity', label: 'Min density' },
  { key: 'maxDensity', label: 'Max density' },
  { key: 'maxWidth', label: 'Max width' },
  { key: 'maxHeight', label: 'Max height' },
  { key: 'maxSampleRate', label: 'Max audio sample rate' },
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
  const isBlankLimit = (k: keyof EncodeSettings) =>
    k === 'maxWidth' || k === 'maxHeight' || k === 'maxSampleRate';
  return <div>
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
    {NUMERIC_FIELDS.map(({ key, label }) =>
      <Row key={key}>
        <span>{TIPS[key] ? <Tip tip={TIPS[key]}>{label}</Tip> : label}</span>
        <input type="number" step="any" style={{ width: 90 }}
          min={isBlankLimit(key) ? 0 : undefined}
          value={isBlankLimit(key) && val(key) === 0
            ? ''
            : val(key) as number | undefined ?? ''}
          placeholder={isOverride ? String(base[key]) : undefined}
          onChange={e => onChange(key,
            e.target.value === ''
              ? (isOverride ? undefined : isBlankLimit(key) ? 0 : undefined)
              : Number(e.target.value))} />
      </Row>)}
    {CODEC_FIELDS.map(({ key, label, options }) => {
      const inheritedLabel = options
        .find(([value]) => value === String(base[key]))?.[1]
        .replace(/\s+\([^)]*\)$/, '') ?? String(base[key]);
      return <Row key={key}>
        <span><Tip tip={TIPS[key]}>{label}</Tip></span>
        <select value={(val(key) as string | undefined) ?? (isOverride ? '' : base[key] as string)}
          onChange={e => onChange(key, e.target.value || undefined)}>
          {isOverride && <option value="">{inheritedLabel} (inherited)</option>}
          {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
        </select>
      </Row>;
    })}
    <Row>
      <span><Tip tip={TIPS.effort}>Effort (0 fast – 10 best)</Tip></span>
      <input type="range" min={0} max={10} step={1} value={eff('effort') as number}
        onChange={e => onChange('effort', Number(e.target.value))} />
      <span>{eff('effort')}{isOverride && override.effort === undefined ? ' (inherited)' : ''}</span>
    </Row>
  </div>;
});
