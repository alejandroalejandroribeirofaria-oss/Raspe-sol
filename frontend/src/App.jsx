import { useEffect, useState } from 'react';
import { useI18n } from './i18n/I18nContext';
import { useAudioBoot } from './hooks/useAudioBoot';
import { api } from './api';
import LanguageSwitch from './components/LanguageSwitch';
import BuyFlow from './components/BuyFlow';
import VolumeControl from './components/VolumeControl';
import WalletButton from './wallet/WalletButton.jsx';
import WalletModal from './wallet/WalletModal.jsx';
import ChatToggleButton from './chat/ChatToggleButton.jsx';
import ChatWindow from './chat/ChatWindow.jsx';
import MyTicketsPanel from './tickets/MyTicketsPanel.jsx';
import PendingPrizeBanner from './tickets/PendingPrizeBanner.jsx';

export default function App() {
  const { t } = useI18n();
  const [config, setConfig] = useState(null);
  const [ticketsOpen, setTicketsOpen] = useState(false);
  useAudioBoot();

  useEffect(() => {
    api.getConfig().then(setConfig).catch(() => setConfig({ ticketPriceSol: 0.02 }));
  }, []);

  const openTickets = () => setTicketsOpen(true);

  return (
    <div className="page">
      <header className="topbar">
        <div className="topbar__brand">
          RASPE<span className="topbar__brand-accent">SOL</span>
        </div>
        <div className="topbar__right">
          <button className="tickets-toggle" onClick={openTickets} aria-label={t('myTickets')}>
            ðŸŽŸ
          </button>
          <ChatToggleButton />
          <VolumeControl />
          <LanguageSwitch />
          <WalletButton />
        </div>
      </header>

      <main className="hero">
        <div className="hero__foil-strip" aria-hidden="true" />
        <h1 className="hero__title">Raspe SOL</h1>
        <p className="hero__tagline">{t('tagline')}</p>

        <PendingPrizeBanner onViewTickets={openTickets} />

        {config && <BuyFlow config={config} onViewTickets={openTickets} />}
      </main>

      <footer className="footer">
        <p>{t('footerNote')}</p>
      </footer>

      <WalletModal />
      <ChatWindow />
      <MyTicketsPanel open={ticketsOpen} onClose={() => setTicketsOpen(false)} />
    </div>
  );
}
