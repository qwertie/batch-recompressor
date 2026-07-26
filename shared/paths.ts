// Path mapping and exclusion logic. Pure functions so they are testable
// on any platform; separators of both kinds are handled.

/** Normalize a path to forward slashes, no trailing slash, for comparisons. */
export function normPath(p: string): string {
  let n = p.replace(/\\/g, '/');
  if (n.length > 1 && n.endsWith('/')) n = n.slice(0, -1);
  return n;
}

/**
 * Compact path shown when the sidebar directory tree is disabled. Includes
 * the added root folder's name so files from different roots remain distinct.
 */
export function flatDisplayPath(filePath: string, rootFolder: string): string {
  const file = normPath(filePath);
  const root = normPath(rootFolder);
  const rootName = root.split('/').pop() || root;
  const shownRoot = rootName.length > 12 ? `${rootName.slice(0, 11)}...` : rootName;
  const relative = root === '/'
    ? file.slice(1)
    : file.toLowerCase().startsWith(`${root.toLowerCase()}/`)
      ? file.slice(root.length + 1)
      : file.split('/').pop() || file;
  const separator = rootFolder.includes('\\') || /^[A-Za-z]:/.test(root) ? '\\' : '/';
  return [shownRoot, relative].filter(Boolean).join(separator).replaceAll('/', separator);
}

/** True if `child` equals `parent` or is inside it. Case-insensitive drive-letter friendly. */
export function isInside(child: string, parent: string): boolean {
  const c = normPath(child).toLowerCase();
  const p = normPath(parent).toLowerCase();
  return c === p || c.startsWith(p + '/');
}

/**
 * Map an input file to its output path: the file's path relative to the
 * root folder it was added under is appended to the output folder.
 * e.g. root C:/A/B, file C:/A/B/C/D.mp4, out C:/Out -> C:/Out/C/D.mkv
 */
export function outputPathFor(
  filePath: string, rootFolder: string, outputFolder: string, ext = '.mkv',
): string {
  const f = normPath(filePath);
  const r = normPath(rootFolder);
  if (!isInside(f, r)) throw new Error(`${filePath} is not inside ${rootFolder}`);
  const rel = f.slice(r.length + 1);
  const relNoExt = rel.replace(/\.[^./]+$/, '');
  return `${normPath(outputFolder)}/${relNoExt}${ext}`;
}

/** True if the file should be excluded: inside the output folder or any excluded path. */
export function isExcluded(
  filePath: string, outputFolder: string, exclusions: string[],
): boolean {
  if (outputFolder && isInside(filePath, outputFolder)) return true;
  return exclusions.some(e => isInside(filePath, e));
}
