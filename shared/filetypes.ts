import type { MediaKind } from './types.js';

/**
 * Extensions offered in the file-type tree, by media root. Container
 * extensions can be ambiguous (e.g. .mp4 may be audio-only, .webp may be
 * animated); they're listed under their most common kind, and the actual
 * classification of each scanned file comes from ffprobe.
 */
export const EXTENSIONS_BY_KIND: Record<MediaKind, string[]> = {
  video: ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.webm', '.m4v', '.mpg',
    '.mpeg', '.ts', '.m2ts', '.flv', '.3gp', '.ogv'],
  image: ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.heic', '.bmp',
    '.tif', '.tiff', '.gif'],
  audio: ['.mp3', '.m4a', '.flac', '.wav', '.opus', '.ogg', '.wma',
    '.aac', '.aiff'],
};

export const ALL_EXTENSIONS: string[] = Object.values(EXTENSIONS_BY_KIND).flat();
