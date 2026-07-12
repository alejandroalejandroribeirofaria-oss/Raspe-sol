import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { db, logAudit } from '../db.js';
import { config } from '../config.js';

fs.mkdirSync(config.chatUploadDir, { recursive: true });

export class ChatError extends Error {
  constructor(code, message, httpStatus = 400) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

// --- HTML escaping (defense in depth — the frontend also never uses
// dangerouslySetInnerHTML for message text, but a raw DB row could end up
// rendered elsewhere later, so escape at write time too). -----------------
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function containsBannedWord(text) {
  if (config.chatBannedWords.length === 0) return false;
  const lower = text.toLowerCase();
  return config.chatBannedWords.some((word) => lower.includes(word));
}

// --- Rate limiting (in-memory, per wallet) ---------------------------------
// Presence/rate state doesn't need to survive a restart and would be pure
// write overhead in SQLite for something checked on every keystroke/message
// — keeping it in memory is what keeps this "lightweight after months."
const lastMessageAt = new Map(); // wallet -> timestamp
const imageTimestamps = new Map(); // wallet -> number[] (recent image sends)

function assertNotRateLimited(wallet, { isImage }) {
  const now = Date.now();
  const last = lastMessageAt.get(wallet) || 0;
  if (now - last < config.chatMinMessageIntervalMs) {
    throw new ChatError('RATE_LIMITED', 'You are sending messages too fast.', 429);
  }

  if (isImage) {
    const windowStart = now - 60_000;
    const recent = (imageTimestamps.get(wallet) || []).filter((t) => t > windowStart);
    if (recent.length >= config.chatMaxImagesPerMinute) {
      throw new ChatError('IMAGE_RATE_LIMITED', 'Too many images sent in the last minute.', 429);
    }
    recent.push(now);
    imageTimestamps.set(wallet, recent);
  }
}

function markSent(wallet) {
  lastMessageAt.set(wallet, Date.now());
}

// --- Temporary wallet blocks (admin moderation) -----------------------------
export function isWalletBlocked(wallet) {
  const row = db.prepare(`SELECT blocked_until FROM chat_blocked_wallets WHERE wallet = ?`).get(wallet);
  if (!row) return false;
  if (new Date(row.blocked_until).getTime() < Date.now()) {
    db.prepare(`DELETE FROM chat_blocked_wallets WHERE wallet = ?`).run(wallet);
    return false;
  }
  return true;
}

export function blockWallet(wallet, minutes, reason = null) {
  const until = new Date(Date.now() + minutes * 60_000).toISOString();
  db.prepare(
    `INSERT INTO chat_blocked_wallets (wallet, blocked_until, reason) VALUES (?, ?, ?)
     ON CONFLICT(wallet) DO UPDATE SET blocked_until = excluded.blocked_until, reason = excluded.reason`
  ).run(wallet, until, reason);
  logAudit('CHAT_WALLET_BLOCKED', { wallet, detail: { minutes, reason } });
}

// --- Messages ----------------------------------------------------------------
export function sendMessage({ wallet, message, imagePath, replyTo }) {
  if (!wallet || typeof wallet !== 'string') {
    throw new ChatError('INVALID_WALLET', 'A connected wallet is required to chat.');
  }
  if (isWalletBlocked(wallet)) {
    throw new ChatError('WALLET_BLOCKED', 'This wallet is temporarily blocked from chatting.', 403);
  }

  const text = (message || '').trim();
  if (!text && !imagePath) {
    throw new ChatError('EMPTY_MESSAGE', 'Message cannot be empty.');
  }
  if (text.length > config.chatMaxMessageLength) {
    throw new ChatError(
      'MESSAGE_TOO_LONG',
      `Message exceeds the ${config.chatMaxMessageLength} character limit.`
    );
  }
  if (text && containsBannedWord(text)) {
    throw new ChatError('BANNED_WORD', 'Message contains a prohibited word.');
  }
  if (replyTo) {
    const parent = db.prepare(`SELECT id FROM chat_messages WHERE id = ?`).get(replyTo);
    if (!parent) throw new ChatError('REPLY_TARGET_NOT_FOUND', 'The message being replied to no longer exists.');
  }

  assertNotRateLimited(wallet, { isImage: !!imagePath });

  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + config.chatMessageTtlMinutes * 60_000).toISOString();

  db.prepare(
    `INSERT INTO chat_messages (id, wallet, message, image_path, reply_to, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, wallet, text ? escapeHtml(text) : null, imagePath || null, replyTo || null, expiresAt);

  markSent(wallet);

  return getMessage(id);
}

export function getMessage(id) {
  return db.prepare(`SELECT * FROM chat_messages WHERE id = ?`).get(id);
}

/** Active = not hidden, not yet expired. This is the only thing ever sent to a freshly-connected client — no permanent history. */
export function getActiveMessages() {
  return db
    .prepare(
      `SELECT * FROM chat_messages
       WHERE hidden = 0 AND expires_at > datetime('now')
       ORDER BY created_at ASC
       LIMIT ?`
    )
    .all(config.chatHistoryLimit);
}

export function getReactionsFor(messageIds) {
  if (messageIds.length === 0) return {};
  const placeholders = messageIds.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT message_id, emoji, COUNT(*) AS count FROM chat_reactions WHERE message_id IN (${placeholders}) GROUP BY message_id, emoji`)
    .all(...messageIds);
  const byMessage = {};
  for (const row of rows) {
    (byMessage[row.message_id] ??= []).push({ emoji: row.emoji, count: row.count });
  }
  return byMessage;
}

// --- Reactions -----------------------------------------------------------
export function toggleReaction({ messageId, wallet, emoji }) {
  const message = getMessage(messageId);
  if (!message) throw new ChatError('MESSAGE_NOT_FOUND', 'Message not found.', 404);

  const existing = db
    .prepare(`SELECT 1 FROM chat_reactions WHERE message_id = ? AND wallet = ? AND emoji = ?`)
    .get(messageId, wallet, emoji);

  if (existing) {
    db.prepare(`DELETE FROM chat_reactions WHERE message_id = ? AND wallet = ? AND emoji = ?`).run(messageId, wallet, emoji);
  } else {
    db.prepare(`INSERT INTO chat_reactions (message_id, wallet, emoji) VALUES (?, ?, ?)`).run(messageId, wallet, emoji);
  }

  const counts = db
    .prepare(`SELECT emoji, COUNT(*) AS count FROM chat_reactions WHERE message_id = ? GROUP BY emoji`)
    .all(messageId);

  return { messageId, reactions: counts };
}

// --- Reports / moderation -------------------------------------------------
export function reportMessage({ messageId, wallet }) {
  const message = getMessage(messageId);
  if (!message) throw new ChatError('MESSAGE_NOT_FOUND', 'Message not found.', 404);

  const already = db.prepare(`SELECT 1 FROM chat_reports WHERE message_id = ? AND wallet = ?`).get(messageId, wallet);
  if (already) throw new ChatError('ALREADY_REPORTED', 'You already reported this message.', 409);

  const applyReport = db.transaction(() => {
    db.prepare(`INSERT INTO chat_reports (message_id, wallet) VALUES (?, ?)`).run(messageId, wallet);
    db.prepare(`UPDATE chat_messages SET reported_count = reported_count + 1 WHERE id = ?`).run(messageId);
  });
  applyReport();

  const updated = getMessage(messageId);
  let hidden = false;
  if (updated.reported_count >= config.chatReportThreshold && !updated.hidden) {
    db.prepare(`UPDATE chat_messages SET hidden = 1 WHERE id = ?`).run(messageId);
    hidden = true;
    logAudit('CHAT_MESSAGE_AUTO_HIDDEN', { wallet, detail: { messageId, reportedCount: updated.reported_count } });
  }

  return { messageId, reportedCount: updated.reported_count, hidden };
}

// --- Expiration sweep ------------------------------------------------------
/**
 * Deletes every expired message (and its image file, reports, and
 * reactions) from disk and the DB. This is the mechanism that keeps the
 * chat's footprint flat forever — there's no archive, no soft-delete, just
 * removal the moment expires_at passes.
 */
export function sweepExpiredMessages() {
  const expired = db
    .prepare(`SELECT id, image_path FROM chat_messages WHERE expires_at <= datetime('now')`)
    .all();
  if (expired.length === 0) return [];

  const purge = db.transaction((rows) => {
    const delMsg = db.prepare(`DELETE FROM chat_messages WHERE id = ?`);
    const delReports = db.prepare(`DELETE FROM chat_reports WHERE message_id = ?`);
    const delReactions = db.prepare(`DELETE FROM chat_reactions WHERE message_id = ?`);
    for (const row of rows) {
      delMsg.run(row.id);
      delReports.run(row.id);
      delReactions.run(row.id);
    }
  });
  purge(expired);

  for (const row of expired) {
    if (row.image_path) deleteImageFile(row.image_path);
  }

  return expired.map((r) => r.id);
}

export function deleteImageFile(relativePath) {
  try {
    const full = path.join(config.chatUploadDir, path.basename(relativePath));
    if (fs.existsSync(full)) fs.unlinkSync(full);
  } catch (err) {
    console.error('[chat] failed to delete image file:', err.message);
  }
}

// --- Admin helpers ---------------------------------------------------------
export function clearAllMessages() {
  const rows = db.prepare(`SELECT id, image_path FROM chat_messages`).all();
  db.exec(`DELETE FROM chat_reactions; DELETE FROM chat_reports; DELETE FROM chat_messages;`);
  for (const row of rows) {
    if (row.image_path) deleteImageFile(row.image_path);
  }
  logAudit('CHAT_CLEARED', { detail: { removed: rows.length } });
  return rows.length;
}

export function getChatStats() {
  const totalMessages = db.prepare(`SELECT COUNT(*) AS c FROM chat_messages`).get().c;
  const reportedMessages = db.prepare(`SELECT COUNT(*) AS c FROM chat_messages WHERE reported_count > 0`).get().c;
  const imageCount = db.prepare(`SELECT COUNT(*) AS c FROM chat_messages WHERE image_path IS NOT NULL`).get().c;

  let storageBytes = 0;
  try {
    for (const file of fs.readdirSync(config.chatUploadDir)) {
      storageBytes += fs.statSync(path.join(config.chatUploadDir, file)).size;
    }
  } catch {
    // upload dir not created yet — 0 bytes is correct
  }

  return { totalMessages, reportedMessages, imageCount, storageBytes };
}

