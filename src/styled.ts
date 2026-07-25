// Re-export goober with `styled` unbound from the module namespace object.
// (Vitest's ESM transform makes `styled(...)` a method call on the frozen
// namespace, and goober writes to `this||{}` — which then throws.)
import { styled as gooberStyled } from 'goober';

export const styled = gooberStyled.bind(undefined) as typeof gooberStyled;
export { glob, setup } from 'goober';
