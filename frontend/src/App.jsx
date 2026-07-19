import ChatWindow from './chat/ChatWindow.jsx';
import { useEffect, useState } from 'react';
import { useI18n } from './i18n/I18nProvider';
import { useAudioBoot } from './hooks/useAudioBoot';
import { useChat } from './chat/ChatProvider';
import { api } from './api';

import LanguageSwitch from './components/LanguageSwitch';
import BuyFlow from './components/BuyFlow';
import VolumeControl from './components/VolumeControl';

import WalletButton from './wallet/WalletButton';
import WalletModal from './wallet/WalletModal';

import MyTicketsPanel from './tickets/MyTicketsPanel';
import PendingPrizeBanner from './tickets/PendingPrizeBanner';

export default function App() {
  const { t } = useI18n();

  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [ticketsOpen, setTicketsOpen] = useState(false);

  const { togglePanel } = useChat();

  useAudioBoot();

  useEffect(() => {
    let cancelled = false;

    const loadConfig = async () => {
      try {
        const config = await api.getConfig();

        if (!cancelled) {
          setConfig(config);
        }
      } catch (err) {
        console.error('Erro ao carregar configuração:', err);

        if (!cancelled) {
          setConfig({
            ticketPriceSol: 0.02,
          });
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadConfig();

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div
        className="page"
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
        }}
      >
        <h2>{t('loading') || 'Carregando...'}</h2>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="topbar">
        <div className="topbar__brand">
          RASPE<span className="topbar__brand-accent">SOL</span>
        </div>

        <div className="topbar__right">
          <button
            className="tickets-toggle"
            aria-label={t('myTickets')}
            onClick={() => setTicketsOpen(true)}
          >
            🎟️
          </button>

          <button
            className="chat-toggle"
            aria-label={t('chat') || 'Chat'}
            onClick={togglePanel}
          >
            💬
          </button>

          <VolumeControl />
          <LanguageSwitch />
          <WalletButton />
        </div>
      </header>

      <main className="hero">
        <div className="hero__foil-strip" aria-hidden="true" />

        <h1 className="hero__title">Raspe SOL</h1>

        <p className="hero__tagline">
          {t('tagline')}
        </p>

        <PendingPrizeBanner
          onViewTickets={() => setTicketsOpen(true)}
        />

        {config && (
          <BuyFlow
            config={config}
            onViewTickets={() => setTicketsOpen(true)}
          />
        )}
      </main>

      <footer className="footer">
        <p>{t('footerNote')}</p>
      </footer>

      <WalletModal />

      <ChatWindow />

      <MyTicketsPanel
        open={ticketsOpen}
        onClose={() => setTicketsOpen(false)}
      />
    </div>
  );
}
