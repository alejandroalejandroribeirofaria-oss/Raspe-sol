import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider'
import { useWallet } from '../wallet/useWallet.js';
import { shortenAddress } from '../wallet/walletUtils.js';
import { api } from '../api.js';

function statusBadge(ticket, t) {
  if (!ticket.revealed) return { icon: '⏳', label: t('claimAwaitingScratch') };
  if (ticket.claimStatus === 'PAID') return { icon: '🟢', label: t('claimPaid') };
  if (ticket.claimStatus === 'PENDING') return { icon: '🟡', label: t('claimPending') };
  return { icon: '⚪', label: t('claimNone') };
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso.replace(' ', 'T') + 'Z').toLocaleString();
  } catch {
    return iso;
  }
}

export default function MyTicketsPanel({ open, onClose }) {
  const { t } = useI18n();
  const { address } = useWallet();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open || !address) return;
    setLoading(true);
    setError(null);
    api
      .getMyTickets(address)
      .then((res) => setTickets(res.tickets))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [open, address]);

  if (!open) return null;

  return (
    <div className="tickets-panel">
      <div className="tickets-panel__header">
        <h2 className="tickets-panel__title">{t('myTickets')}</h2>
        <button className="tickets-panel__close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      {/* ... resto do código ... */}
    </div>
  );
}
