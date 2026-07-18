import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider'
import { useWallet } from '../wallet/useWallet.js';
import { WALLET_READY_STATE } from '../wallet/walletUtils.js';
import { audioManager } from '../audio/AudioManager.js';
import { api, subscribeOrderUpdates } from '../api';
import ScratchCard from './ScratchCard';
import PrizeClaimResult from '../tickets/PrizeClaimResult.jsx';

const STAGE = {
  IDLE: 'idle',
  CREATING_ORDER: 'creating_order',
  WAITING_WALLET: 'waiting_wallet',
  SENDING_TX: 'sending_tx',
  WAITING_CHAIN: 'waiting_chain',
  PAID: 'paid',
  REVEALED: 'revealed',
  ERROR: 'error',
};

const ERROR_KEY_BY_CODE = {
  ORDER_EXPIRED: 'orderExpired',
  TRANSACTION_EXPIRED: 'orderExpired',
  VERIFICATION_FAILED: 'errorGeneric',
  SIGNATURE_ALREADY_USED: 'errorSignatureUsed',
  WALLET_MISMATCH: 'errorGeneric',
  INSUFFICIENT_PAYMENT: 'errorAmountMismatch',
  AMOUNT_MISMATCH: 'errorAmountMismatch',
  SOLD_OUT: 'errorGeneric',
  MAX_TICKETS_EXCEEDED: 'errorGeneric',
};

export default function BuyFlow({ config, onViewTickets = () => {} }) {
  const { t } = useI18n();
  const wallet = useWallet();
  const [stage, setStage] = useState(STAGE.IDLE);
  const [order, setOrder] = useState(null);
  const [ticketUuids, setTicketUuids] = useState([]);
  const [ticket, setTicket] = useState(null);
  const [errorKey, setErrorKey] = useState(null);
  const [finishedScratching, setFinishedScratching] = useState(false);
  const unsubscribeRef = useRef(null);

  useEffect(() => () => unsubscribeRef.current?.(), []);

  const reset = () => {
    setStage(STAGE.IDLE);
    setOrder(null);
    setTicketUuids([]);
    setTicket(null);
    setErrorKey(null);
    setFinishedScratching(false);
    unsubscribeRef.current?.();
  };

  const fail = (code) => {
    setErrorKey(ERROR_KEY_BY_CODE[code] || 'errorGeneric');
    setStage(STAGE.ERROR);
  };

  // Same "skip the modal if there's only one installed wallet" rule as the
  // header's connect button, so Buy Ticket behaves consistently whichever
  // entry point the user taps.
  const ensureConnected = async () => {
    const installed = wallet.wallets.filter((w) => w.readyState === WALLET_READY_STATE.INSTALLED);
    if (installed.length === 1) {
      await wallet.connect(installed[0].adapter.name);
      audioManager.play('walletConnect');
    } else {
      wallet.openModal();
    }
  };

  const buy = async () => {
    audioManager.play('click');
    if (!wallet.address) {
      await ensureConnected();
      return;
    }

    try {
      audioManager.play('purchaseStart');
      setStage(STAGE.CREATING_ORDER);
      const newOrder = await api.createOrder(wallet.address, 1);
      setOrder(newOrder);

      unsubscribeRef.current = subscribeOrderUpdates(newOrder.orderId, (msg) => {
        if (msg.status === 'PAID') setStage(STAGE.PAID);
        if (msg.status === 'REJECTED') fail(msg.reason);
      });

      setStage(STAGE.WAITING_WALLET);
      let signature;
      try {
        signature = await wallet.sendPayment({
          toWallet: newOrder.treasuryWallet,
          lamports: newOrder.expectedLamports,
        });
      } catch (err) {
        audioManager.play('paymentError');
        return fail('errorCancelled');
      }

      setStage(STAGE.SENDING_TX);
      api.watchOrder(newOrder.orderId, signature).catch(() => {});

      setStage(STAGE.WAITING_CHAIN);
      const result = await api.confirmOrder(newOrder.orderId, {
        signature,
        wallet: wallet.address,
      });
      setTicketUuids(result.tickets || []);
      wallet.refreshBalance();
      audioManager.play('paymentConfirmed');
      audioManager.play('purchaseSuccess');
      setStage(STAGE.PAID);
    } catch (err) {
      audioManager.play('paymentError');
      fail(err.code);
    }
  };

  const reveal = async () => {
    audioManager.play('click');
    const ticketUuid = ticketUuids[0];
    if (!ticketUuid) return fail('errorGeneric');
    try {
      const revealedTicket = await api.revealTicket(ticketUuid, wallet.address);
      setTicket(revealedTicket);
      setStage(STAGE.REVEALED);
    } catch (err) {
      fail(err.code);
    }
  };

  return (
    <div className="buy-flow">
      {stage === STAGE.IDLE && (
        <>
          <div className="price-tag">
            <span className="price-tag__label">{t('ticketPrice')}</span>
            <span className="price-tag__value">{config.ticketPriceSol} SOL</span>
          </div>
          <button
            className="btn btn--primary"
            onClick={buy}
            onMouseEnter={() => audioManager.play('hover')}
            disabled={wallet.connecting}
          >
            {wallet.address ? t('buyTicket') : t('connectWallet')}
          </button>
        </>
      )}

      {[STAGE.CREATING_ORDER, STAGE.WAITING_WALLET, STAGE.SENDING_TX, STAGE.WAITING_CHAIN].includes(stage) && (
        <div className="status-panel">
          <div className="spinner" aria-hidden="true" />
          <p className="status-panel__text">
            {stage === STAGE.CREATING_ORDER && t('creatingOrder')}
            {stage === STAGE.WAITING_WALLET && t('waitingWallet')}
            {stage === STAGE.SENDING_TX && t('sendingTx')}
            {stage === STAGE.WAITING_CHAIN && t('waitingChain')}
          </p>
          {order && <p className="status-panel__meta">{t('orderId')}: {order.orderId}</p>}
        </div>
      )}

      {stage === STAGE.PAID && (
        <div className="status-panel status-panel--success">
          <p className="status-panel__text">{t('paymentConfirmed')}</p>
          <p className="status-panel__text">{t('ticketReady')}</p>
          <button className="btn btn--primary" onClick={reveal}>
            {t('scratchToReveal')}
          </button>
        </div>
      )}

      {stage === STAGE.REVEALED && ticket && (
        <>
          <ScratchCard
            prizeLabel={ticket.prizeLabel}
            prizeLamports={ticket.prizeLamports}
            onRevealed={() => setFinishedScratching(true)}
          />
          {finishedScratching && ticket.prizeLamports > 0 && (
            <PrizeClaimResult prizeSol={ticket.prizeLamports / 1e9} onViewTickets={onViewTickets} />
          )}
          <button className="btn btn--ghost" onClick={() => { audioManager.play('click'); reset(); }}>
            {t('playAgain')}
          </button>
        </>
      )}

      {stage === STAGE.ERROR && (
        <div className="status-panel status-panel--error">
          <p className="status-panel__text">{t(errorKey)}</p>
          <button className="btn btn--ghost" onClick={() => { audioManager.play('click'); reset(); }}>
            {t('playAgain')}
          </button>
        </div>
      )}
    </div>
  );
}
