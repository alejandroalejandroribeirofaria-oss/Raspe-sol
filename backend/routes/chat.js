import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { ChatError, isWalletBlocked } from '../services/chatService.js';
import { processChatUpload } from '../services/chatImageService.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.chatMaxImageBytes },
});

// Blunt per-IP backstop on top of the per-wallet image rate limit enforced
// when the message is actually sent — this just stops raw upload spam from
// burning CPU on compression before that check ever runs.
const uploadLimiter = rateLimit({ windowMs: 60_000, max: 10 });

router.post('/upload', uploadLimiter, upload.single('image'), async (req, res) => {
  try {
    const wallet = req.body?.wallet;
    if (!wallet) return res.status(400).json({ error: 'INVALID_WALLET', message: 'wallet is required.' });
    if (isWalletBlocked(wallet)) {
      return res.status(403).json({ error: 'WALLET_BLOCKED', message: 'This wallet is temporarily blocked.' });
    }
    if (!req.file) return res.status(400).json({ error: 'NO_FILE', message: 'No image file received.' });

    const filename = await processChatUpload({
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      size: req.file.size,
    });

    res.status(201).json({ imagePath: filename });
  } catch (err) {
    if (err instanceof ChatError) return res.status(err.httpStatus).json({ error: err.code, message: err.message });
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res
        .status(400)
        .json({ error: 'IMAGE_TOO_LARGE', message: `Image exceeds the ${Math.floor(config.chatMaxImageBytes / 1e6)}MB limit.` });
    }
    console.error('[chat upload]', err);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

export default router;

