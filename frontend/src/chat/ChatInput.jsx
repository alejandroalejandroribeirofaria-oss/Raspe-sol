import { useRef, useState } from 'react';
import EmojiPicker from './EmojiPicker.jsx';
import { shortenAddress } from '../wallet/walletUtils.js';
import { audioManager } from '../audio/AudioManager.js';

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_BYTES = 5 * 1024 * 1024;

export default function ChatInput({
  maxLength,
  replyingTo,
  onCancelReply,
  onSend,
  onTyping,
  uploadImage,
  t
}) {
  const [text, setText] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const handleChange = (e) => {
    setText(e.target.value.slice(0, maxLength));
    onTyping();
  };

  const handlePickEmoji = (emoji) => {
    setText((t) => (t + emoji).slice(0, maxLength));
  };

  const handleAttachClick = () => fileInputRef.current?.click();

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setError(null);

    if (!ALLOWED_TYPES.includes(file.type)) {
      setError(t('errorImageType'));
      return;
    }

    if (file.size > MAX_BYTES) {
      setError(t('errorImageSize'));
      return;
    }

    setUploading(true);

    try {
      const imagePath = await uploadImage(file);

      onSend('', {
        imagePath,
        replyTo: replyingTo?.id
      });

      audioManager.play('click');
    } catch (err) {
      setError(err.message || t('errorImageUpload'));
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    const trimmed = text.trim();
    if (!trimmed) return;

    onSend(trimmed, {
      replyTo: replyingTo?.id
    });

    setText('');
    audioManager.play('click');
  };

  return (
    <div className="chat-input">
      {replyingTo && (
        <div className="chat-input__reply-banner">
          <span>
            {t('replyingTo')}{' '}
            <strong>{shortenAddress(replyingTo.wallet)}</strong>
          </span>

          <button
            onClick={onCancelReply}
            aria-label="Cancel reply"
          >
            ×
          </button>
        </div>
      )}

      {error && (
        <div className="chat-input__error">
          {error}
        </div>
      )}

      {pickerOpen && (
        <EmojiPicker
          onPick={handlePickEmoji}
          onClose={() => setPickerOpen(false)}
        />
      )}

      <form
        className="chat-input__row"
        onSubmit={handleSubmit}
      >
        <button
          type="button"
          className="chat-input__icon-btn"
          onClick={() => setPickerOpen((o) => !o)}
          aria-label="Emoji"
        >
          😀
        </button>

        <button
          type="button"
          className="chat-input__icon-btn"
          onClick={handleAttachClick}
          disabled={uploading}
          aria-label="Attach image"
        >
          {uploading ? '…' : '📎'}
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_TYPES.join(',')}
          hidden
          onChange={handleFileChange}
        />

        <input
          className="chat-input__text"
          type="text"
          value={text}
          onChange={handleChange}
          placeholder={t('typeMessage')}
          maxLength={maxLength}
        />

        <span className="chat-input__counter">
          {text.length}/{maxLength}
        </span>

        <button
          type="submit"
          className="chat-input__send"
          disabled={!text.trim()}
        >
          {t('send')}
        </button>
      </form>
    </div>
  );
  }
