import { useChat } from './useChat.js';
import { I18nProvider } from '../i18n/I18nProvider'
import { audioManager } from '../audio/AudioManager.js';

export default function ChatToggleButton() {
  const { t } = useI18n();
  const { togglePanel, unreadCount, panelOpen } = useChat();

  return (
    <button
      className="chat-toggle"
      onClick={() => {
        audioManager.play(panelOpen ? 'windowClose' : 'windowOpen');
        togglePanel();
      }}
      aria-label={t('globalChat')}
    >
      ðŸ’¬
      {unreadCount > 0 && <span className="chat-toggle__badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
    </button>
  );
}

