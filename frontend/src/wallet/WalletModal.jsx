import { useI18n } from '../i18n/I18nContext';
import { useWallet } from './useWallet.js';
import { WALLET_READY_STATE } from './walletUtils.js';
import { audioManager } from '../audio/AudioManager.js';

export default function WalletModal() {
  const { t } = useI18n();
  const { wallets, modalOpen, closeModal, connect } = useWallet();

  if (!modalOpen) return null;

  const ranked = [...wallets].sort((a, b) => {
    const rank = (w) => (w.readyState === WALLET_READY_STATE.INSTALLED ? 0 : w.readyState === WALLET_READY_STATE.LOADABLE ? 1 : 2);
    return rank(a) - rank(b);
  });

  const handleClose = () => {
    audioManager.play('windowClose');
    closeModal();
  };

  const handlePick = async (adapter) => {
    if (adapter.readyState === WALLET_READY_STATE.NOT_DETECTED) {
      window.open(adapter.url, '_blank');
      return;
    }
    audioManager.play('click');
    try {
      await connect(adapter.name);
    } catch {
      // Error state is already reflected in context.status — modal just closes.
    }
  };

  return (
    <div className="wallet-modal__backdrop" onClick={handleClose}>
      <div className="wallet-modal" onClick={(e) => e.stopPropagation()}>
        <div className="wallet-modal__header">
          <h2 className="wallet-modal__title">{t('connectWallet')}</h2>
          <button className="wallet-modal__close" onClick={handleClose} aria-label="Close">
            ×
          </button>
        </div>
        <ul className="wallet-modal__list">
          {ranked.map((w) => (
            <li key={w.adapter.name}>
              <button className="wallet-modal__item" onClick={() => handlePick(w.adapter)}>
                <img src={w.adapter.icon} alt="" className="wallet-modal__icon" />
                <span className="wallet-modal__name">{w.adapter.name}</span>
                <span className="wallet-modal__status">
                  {w.readyState === WALLET_READY_STATE.INSTALLED ? t('walletDetected') : t('walletInstall')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
