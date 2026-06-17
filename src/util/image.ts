/** Helpers for building image (vision) content blocks. */
import { readFileSync, existsSync } from 'node:fs';
import { extname } from 'node:path';
import type { ImageBlock } from '../types/index.js';

const MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/** True if a path looks like a supported image by extension. */
export function isImagePath(path: string): boolean {
  return extname(path).toLowerCase() in MEDIA_TYPES;
}

/** Map a file extension to an image media type (defaults to image/png). */
export function mediaTypeFromPath(path: string): string {
  return MEDIA_TYPES[extname(path).toLowerCase()] ?? 'image/png';
}

/** Read an image file into a base64 ImageBlock. Throws if the file is missing. */
export function imageBlockFromFile(path: string): ImageBlock {
  if (!existsSync(path)) throw new Error(`Image not found: ${path}`);
  const data = readFileSync(path).toString('base64');
  return { type: 'image', source: { type: 'base64', mediaType: mediaTypeFromPath(path), data } };
}

/** Build an ImageBlock from a remote URL. */
export function imageBlockFromUrl(url: string): ImageBlock {
  return { type: 'image', source: { type: 'url', url } };
}
