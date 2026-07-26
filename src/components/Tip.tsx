import { styled } from '../styled.js';

const Wrap = styled('span')`
  position: relative; display: inline-block;
  &:hover > [role=tooltip], &:focus-within > [role=tooltip] { display: block; }
`;
const Bubble = styled('span')`
  display: none; position: fixed; z-index: 10; left: 0; top: 0;
  width: max-content; max-width: min(360px, calc(100vw - 16px)); padding: 8px 11px;
  background: #16222e; color: #cde0ee; border: 1px solid #3a5a7a; border-radius: 6px;
  font-size: 12.5px; line-height: 1.45; font-weight: normal;
  white-space: normal; text-align: left; box-shadow: 0 4px 14px rgba(0, 0, 0, .55);
  pointer-events: none;
  & code { background: #0a141e; padding: 0 4px; border-radius: 3px; }
  & b { color: #fff; }
  & table { border-collapse: collapse; margin: 4px 0; }
  & td { padding: 1px 8px 1px 0; }
`;
const Hint = styled('span')`
  border-bottom: 1px dotted #8aa; cursor: help;
`;

/**
 * Rich hover/focus tooltip: wraps its children with a dotted underline and
 * shows an HTML bubble (any JSX) below them.
 */
export function Tip(props: { tip: React.ReactNode; children: React.ReactNode }) {
  const placeBubble = (event: React.SyntheticEvent<HTMLSpanElement>) => {
    const wrap = event.currentTarget;
    const bubble = wrap.querySelector<HTMLElement>('[role="tooltip"]');
    if (!bubble || typeof window === 'undefined') return;

    // Reveal invisibly for measurement, then clamp it to the viewport.
    bubble.style.display = 'block';
    bubble.style.visibility = 'hidden';
    const anchor = wrap.getBoundingClientRect();
    const measured = bubble.getBoundingClientRect();
    const width = measured.width || Math.min(360, window.innerWidth - 16);
    const height = measured.height;
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
    let top = anchor.bottom + 5;
    if (height > 0 && top + height > window.innerHeight - 8
      && anchor.top - height - 5 >= 8)
      top = anchor.top - height - 5;
    bubble.style.left = `${left}px`;
    bubble.style.top = `${Math.max(8, top)}px`;
    bubble.style.visibility = '';
    bubble.style.display = '';
  };

  return <Wrap tabIndex={0}
    onMouseEnter={placeBubble} onFocus={placeBubble}>
    <Hint>{props.children}</Hint>
    <Bubble role="tooltip">{props.tip}</Bubble>
  </Wrap>;
}

/** The recurring explanation of the normalized density unit. */
export const DensityTip = (
  <span>
    <b>Density</b> describes how many bits of information a media file contains
    per pixel, per second per pixel (video) or per Hz (audio). Typical values are
    between 0.2 and 20. To convert density to bitrate, multiply by the resolution
    or, for audio, the sample rate. For example, if the density is 1.0:
    <table>
      <tbody>
        <tr><td>Video</td><td><code>1 b/s/px × 1920x1080 px = 2074 kb/s</code></td></tr>
        <tr><td>Image</td><td><code>1 b/px × 4000x3000 px = 12 Mb = 1.5 MB</code></td></tr>
        <tr><td>Audio</td><td><code>1 b/smp × 41000 Hz × 2ch = 82 kb/s</code></td></tr>
      </tbody>
    </table>
  </span>
);
