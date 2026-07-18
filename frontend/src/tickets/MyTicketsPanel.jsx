import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider'
import { useWallet } from '../wallet/useWallet.js';  // <- ADICIONA ISSO
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

      <div className="tickets-panel__list">
        {!address && <p className="tickets-panel__empty">{t('connectToChat')}</p>}
        {address && loading && <p className="tickets-panel__empty">…</p>}
        {address && error && <p className="tickets-panel__empty">{error}</p>}
        {address && !loading && !error && tickets.length === 0 && (
          <p className="tickets-panel__empty">{t('noTicketsYet')}</p>
        )}

        {tickets.map((ticket) => {
          const badge = statusBadge(ticket, t);
          return (
            <div key={ticket.ticketId} className="ticket-row">
              <div className="ticket-row__main">
                <span className="ticket-row__id">{shortenAddress(ticket.ticketId, 6)}</span>
                <span className="ticket-row__date">{formatDate(ticket.purchasedAt)}</span>
              </div>
              <div className="ticket-row__meta">
                <span>{t('ticketPrice')}: {ticket.amountPaidSol} SOL</span>
                <span>{t('youWon')}: {ticket.revealed ? (ticket.prizeSol > 0 ? `${ticket.prizeSol} SOL` : '—') : '—'}</span>
              </div>
              <span className={`ticket-row__status ticket-row__status--${ticket.claimStatus.toLowerCase()}`}>
                {badge.icon} {badge.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
