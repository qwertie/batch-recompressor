import { styled } from '../styled.js';

const Wrap = styled('span')`
  position: relative; display: inline-block;
  &:hover > [role=tooltip], &:focus-within > [role=tooltip] { display: block; }
`;
const Bubble = styled('span')`
  display: none; position: absolute; z-index: 10; left: 0; top: 100%; margin-top: 5px;
  width: max-content; max-width: 360px; padding: 8px 11px;
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
  return <Wrap tabIndex={0}>
    <Hint>{props.children}</Hint>
    <Bubble role="tooltip">{props.tip}</Bubble>
  </Wrap>;
}

/** The recurring explanation of the normalized density unit. */
export const DensityTip = (
  <span>
    <b>Compression density</b> normalizes size across media types, so that
    ~1 is a typical value for all of them:
    <table>
      <tbody>
        <tr><td>Video</td><td><code>b/px·s</code></td><td>bits ÷ pixels ÷ seconds</td></tr>
        <tr><td>Image</td><td><code>b/px</code></td><td>bits ÷ pixels</td></tr>
        <tr><td>Audio</td><td><code>b/smp</code></td><td>bits ÷ samples ÷ channels</td></tr>
      </tbody>
    </table>
    e.g. 1080p30 video at 2 Mbps ≈ 0.96 b/px·s; a 248 KB 1080p JPEG ≈ 0.96 b/px;
    96 kbps stereo 48 kHz Opus = 1.0 b/smp.
  </span>
);
