import { useState } from 'react';
import { avatarColorFor, avatarInitialsFor } from './avatarUtils.js';
import { chatImageUrl } from './chatApi.js';
import { shortenAddress, copyToClipboard } from '../wallet/walletUtils.js';
import { QUICK_REACTIONS } from './emojiData.js';
import { audioManager } from '../audio/AudioManager.js';

function formatTime(iso) {
  try {
    return new Date(iso.replace(' ', 'T') + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export default function ChatMessage({ message, isOwn, replyPreview, onReply, onReact, onReport, onImageClick, t }) {
  const [showReactions, setShowReactions] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await copyToClipboard(message.wallet);
    if (ok) {
      setCopied(true);
      audioManager.play('click');
      setTimeout(() => setCopied(false), 1200);
    }
  };

  return (
    <div className={`chat-message ${isOwn ? 'chat-message--own' : ''}`}>
      <div className="chat-message__avatar" style={{ background: avatarColorFor(message.wallet) }}>
        {avatarInitialsFor(message.wallet)}
      </div>

      <div className="chat-message__body">
        <div className="chat-message__meta">
          <button className="chat-message__wallet" onClick={handleCopy} title={t('copyAddress')}>
            {copied ? t('copied') : shortenAddress(message.wallet)}
          </button>
          <span className="chat-message__time">{formatTime(message.createdAt)}</span>
        </div>

        {replyPreview && (
          <div className="chat-message__reply-preview">
            <span className="chat-message__reply-wallet">{shortenAddress(replyPreview.wallet)}</span>
            <span className="chat-message__reply-text">{replyPreview.message || t('imageMessage')}</span>
          </div>
        )}

        {message.message && <p className="chat-message__text">{message.message}</p>}

        {message.imagePath && (
          <img
            src={chatImageUrl(message.imagePath)}
            alt=""
            className="chat-message__image"
            loading="lazy"
            onClick={() => onImageClick(chatImageUrl(message.imagePath))}
          />
        )}

        {message.reactions?.length > 0 && (
          <div className="chat-message__reactions">
            {message.reactions.map((r) => (
              <button key={r.emoji} className="chat-message__reaction" onClick={() => onReact(message.id, r.emoji)}>
                {r.emoji} {r.count}
              </button>
            ))}
          </div>
        )}

        <div className="chat-message__actions">
          <button onClick={() => onReply(message)}>â†© {t('reply')}</button>
          <button onClick={() => setShowReactions((s) => !s)}>ðŸ˜€</button>
          {!message.reportedByMe && !isOwn && (
            <button onClick={() => onReport(message.id)}>âš‘ {t('report')}</button>
          )}
          {message.reportedByMe && <span className="chat-message__reported-tag">{t('reported')}</span>}
        </div>

        {showReactions && (
          <div className="chat-message__quick-reactions">
            {QUICK_REACTIONS.map((e) => (
              <button
                key={e}
                onClick={() => {
                  onReact(message.id, e);
                  setShowReactions(false);
                }}
              >
                {e}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

