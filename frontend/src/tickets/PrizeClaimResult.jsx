import { useI18n } from '../i18n/I18nProvider'

export default function PrizeClaimResult({ prizeSol, onViewTickets }) {
  const { t } = useI18n()

  return (
    <div className="claim-result">
      <p className="claim-result__headline">🎉 {t('congrats')}</p>
      <p className="claim-result__amount-label">{t('youWon')}</p>
      <p className="claim-result__amount">{prizeSol} SOL</p>
      <p className="claim-result__note">{t('prizeAwaitingApproval')}</p>
      <p className="claim-result__status">
        🟡 {t('claimPending')}
      </p>
      <button className="btn btn--primary" onClick={onViewTickets}>
        {t('viewMyTickets')}
      </button>
    </div>
  );
}
