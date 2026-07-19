import { useEffect, useState } from 'react';
import { useWallet } from '../wallet/WalletProvider'
import { useI18n } from '../i18n/I18nProvider'
import { api } from '../api.js';

export default function PendingPrizeBanner({ onViewTickets }) {
  const { t } = useI18n();
  const { address } = useWallet();
  const [notice, setNotice] = useState(null); // 'pending' | 'paid' | null
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setNotice(null);
    setDismissed(false);
    if (!address) return;
    api
      .getMyTickets(address)
      .then((res) => {
        const tickets = res.tickets || [];
        if (tickets.some((t) => t.claimStatus === 'PENDING')) setNotice('pending');
        else if (tickets.some((t) => t.claimStatus === 'PAID')) setNotice('paid');
      })
      .catch(() => {});
  }, [address]);

  if (!notice || dismissed) return null;

  return (
    <div className={`prize-banner prize-banner--${notice}`}>
      <span>{notice === 'pending' ? t('hasPendingPrize') : `✅ ${t('prizeWasPaid')}`}</span>
      <div className="prize-banner__actions">
        <button className="prize-banner__link" onClick={onViewTickets}>
          {t('viewMyTickets')}
        </button>
        <button className="prize-banner__dismiss" onClick={() => setDismissed(true)} aria-label="Dismiss">
          ×
        </button>
      </div>
    </div>
  );
}
