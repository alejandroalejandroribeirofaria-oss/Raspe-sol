import { useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { useWallet } from './WalletProvider';
import {
  shortenAddress,
  formatSol,
  copyToClipboard,
  WALLET_READY_STATE,
} from './walletUtils.js';
import { audioManager } from '../audio/AudioManager.js';

export default function WalletButton() {
  const { t } = useI18n();

  const {
    address,
    balanceLamports,
    status,
    walletName,
    walletIcon,
    wallets = [],
    openModal,
    connect,
    select,
    disconnect,
    networkMismatch,
  } = useWallet();

  const [copied, setCopied] = useState(false);

  const handleConnectClick = async () => {
    try {
      audioManager.play('click');
    } catch {}

    const installed = wallets.filter(
      (wallet) => wallet.readyState === WALLET_READY_STATE.INSTALLED
    );

    try {
      if (installed.length === 1) {
        select(installed[0].adapter.name);
        await connect();

        try {
          audioManager.play('walletConnect');
        } catch {}

        return;
      }

      openModal();
    } catch (err) {
      console.error('Erro ao conectar carteira:', err);
    }
  };

  const handleDisconnect = async () => {
    try {
      audioManager.play('walletDisconnect');
    } catch {}

    try {
      await disconnect();
    } catch (err) {
      console.error(err);
    }
  };

  const handleCopy = async () => {
    if (!address) return;

    const ok = await copyToClipboard(address);

    if (!ok) return;

    try {
      audioManager.play('click');
    } catch {}

    setCopied(true);

    setTimeout(() => {
      setCopied(false);
    }, 1500);
  };

  if (status === 'connected' && address) {
    return (
      <div className="wallet-panel">
        {networkMismatch && (
          <span
            className="wallet-panel__warning"
            title={t('networkMismatch')}
          >
            ⚠️
          </span>
        )}

        {walletIcon && (
          <img
            src={walletIcon}
            alt={walletName}
            className="wallet-panel__icon"
          />
        )}

        <span className="wallet-panel__balance">
          {formatSol(balanceLamports)}
        </span>

        <button
          className="wallet-panel__address"
          onClick={handleCopy}
        >
          {copied ? t('copied') : shortenAddress(address)}
        </button>

        <button
          className="wallet-panel__disconnect"
          onClick={handleDisconnect}
          aria-label={t('disconnect')}
        >
          ⏻
        </button>
      </div>
    );
  }

  if (status === 'locked') {
    return (
      <div className="wallet-panel wallet-panel--warning">
        <span>{t('walletLocked')}</span>
      </div>
    );
  }

  return (
    <button
      className="wallet-pill"
      onClick={handleConnectClick}
    >
      {t('connectWallet')}
    </button>
  );
}
