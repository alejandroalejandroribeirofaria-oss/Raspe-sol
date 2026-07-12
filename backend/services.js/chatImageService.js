import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import sharp from 'sharp';
import { config } from '../config.js';
import { ChatError } from './chatService.js';

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_DIMENSION = 1600; // longest side, px — plenty for a chat bubble/lightbox

/**
 * Validates and compresses an uploaded image buffer, writes it to the chat
 * upload directory, and returns the generated filename.
 *
 * GIFs are passed through uncompressed (sharp would flatten animation to a
 * single frame) — only size/type validation applies to them. Everything
 * else is re-encoded to WebP, which is both smaller and normalizes the
 * format we have to serve.
 */
export async function processChatUpload({ buffer, mimetype, size }) {
  if (!ALLOWED_MIME.has(mimetype)) {
    throw new ChatError('INVALID_IMAGE_TYPE', 'Only PNG, JPG, JPEG, WEBP, and GIF images are allowed.');
  }
  if (size > config.chatMaxImageBytes) {
    throw new ChatError('IMAGE_TOO_LARGE', `Image exceeds the ${Math.floor(config.chatMaxImageBytes / 1e6)}MB limit.`);
  }

  const id = crypto.randomUUID();

  if (mimetype === 'image/gif') {
    const filename = `${id}.gif`;
    await fs.writeFile(path.join(config.chatUploadDir, filename), buffer);
    return filename;
  }

  let pipeline;
  try {
    pipeline = sharp(buffer).rotate(); // .rotate() with no args auto-orients from EXIF
  } catch {
    throw new ChatError('INVALID_IMAGE', 'Could not read this image file.');
  }

  const metadata = await pipeline.metadata().catch(() => null);
  if (!metadata) throw new ChatError('INVALID_IMAGE', 'Could not read this image file.');

  const filename = `${id}.webp`;
  await pipeline
    .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(path.join(config.chatUploadDir, filename));

  return filename;
}

