---- status---
  
import { useI18n } from '../i18n/I18nProvider'
import { useChat } from './ChatProvider'
import { useEffect, useMemo, useRef, useState } from 'react';
import { useWallet } from '../wallet/WalletProvider'
import ChatMessage from './ChatMessage.jsx';
import ChatInput from './ChatInput.jsx';
import ImageLightbox from './ImageLightbox.jsx';
import { shortenAddress } from '../wallet/walletUtils.js';
import { audioManager } from '../audio/AudioManager.js';

const MAX_MESSAGE_LENGTH = 200;

export default function ChatWindow() {
  const { t } = useI18n();
  const { address, openModal } = useWallet();
  const {
    messages,
    onlineCount,
    typingWallets,
    connectionStatus,
    lastError,
    clearError,
    panelOpen,
    closePanel,
    sendMessage,
    sendTyping,
    react,
    report,
    uploadImage,
  } = useChat();

  const [replyingTo, setReplyingTo] = useState(null);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const listRef = useRef(null);
  const shouldAutoScroll = useRef(true);

  const messageById = useMemo(() => {
    const map = new Map();
    for (const e of messages) {
      if (e.kind === 'message') map.set(e.id, e);
    }
    return map;
  }, [messages]);

  useEffect(() => {
    if (!panelOpen) return;
    const el = listRef.current;
    if (el && shouldAutoScroll.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, panelOpen]);

  useEffect(() => {
    if (!lastError) return;
    const timer = setTimeout(clearError, 4000);
    return () => clearTimeout(timer);
  }, [lastError, clearError]);

  if (!panelOpen) return null;

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    shouldAutoScroll.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const handleSend = (text, opts) => {
    sendMessage(text, opts);
    setReplyingTo(null);
  };

  const handleReport = (messageId) => {
    report(messageId);
    audioManager.play('click');
  };

  return (
    <div className="chat-panel">
      <div className="chat-panel__header">
        <div>
          <h2 className="chat-panel__title">{t('globalChat')}</h2>
          <span className="chat-panel__online">
            🟢 {onlineCount} {t('online')}
          </span>
        </div>

        <button
          className="chat-panel__close"
          onClick={closePanel}
          aria-label="Close chat"
        >
          ×
        </button>
      </div>

      {!address ? (
        <div className="chat-panel__gate">
          <p>{t('connectToChat')}</p>

          <button className="btn btn--primary" onClick={openModal}>
            {t('connectWallet')}
          </button>
        </div>
      ) : (
        <>
          <div
            className="chat-panel__list"
            ref={listRef}
            onScroll={handleScroll}
          >
            {messages.length === 0 && (
              <p className="chat-panel__empty">
                {t('noMessagesYet')}
              </p>
            )}

            {messages.map((e) =>
              e.kind === 'system' ? (
                <p key={e.id} className="chat-panel__system-event">
                  {shortenAddress(e.wallet)}{' '}
                  {e.type === 'join'
                    ? t('userJoined')
                    : t('userLeft')}
                </p>
              ) : (
                <ChatMessage
                  key={e.id}
                  message={e}
                  isOwn={e.wallet === address}
                  replyPreview={
                    e.replyTo ? messageById.get(e.replyTo) : null
                  }
                  onReply={setReplyingTo}
                  onReact={react}
                  onReport={handleReport}
                  onImageClick={setLightboxSrc}
                  t={t}
                />
              )
            )}

            {typingWallets.length > 0 && (
              <p className="chat-panel__typing">
                {typingWallets
                  .map(shortenAddress)
                  .join(', ')}{' '}
                {t('typing')}
              </p>
            )}
          </div>

          {lastError && (
            <div className="chat-panel__error">
              {lastError.message}
            </div>
          )}

          {connectionStatus === 'connecting' && (
            <div className="chat-panel__status">
              {t('connecting')}
            </div>
          )}

          {connectionStatus === 'closed' && (
            <div className="chat-panel__status">
              {t('reconnecting')}
            </div>
          )}

          <ChatInput
            maxLength={MAX_MESSAGE_LENGTH}
            replyingTo={replyingTo}
            onCancelReply={() => setReplyingTo(null)}
            onSend={handleSend}
            onTyping={sendTyping}
            uploadImage={uploadImage}
            t={t}
          />
        </>
      )}

      <ImageLightbox
        src={lightboxSrc}
        onClose={() => setLightboxSrc(null)}
      />
    </div>
  );
          }
