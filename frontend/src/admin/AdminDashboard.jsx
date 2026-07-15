import { useState } from 'react';
import {
  fetchDashboard,
  fetchChatStats,
  clearChat,
  kickChatWallet,
  blockChatWallet,
  fetchClaims,
  markClaimPaid,
  fetchLots,
} from './adminApi.js';

function fmt(dt) {
  if (!dt) return '—';
  return new Date(dt.replace(' ', 'T') + 'Z').toLocaleString();
}

function fmtBytes(bytes) {
  if (!bytes) return '0 MB';
  return `${(bytes / 1e6).toFixed(2)} MB`;
}

export default function AdminDashboard() {
  const [token, setToken] = useState('');
  const [data, setData] = useState(null);
  const [chat, setChat] = useState(null);
  const [claims, setClaims] = useState(null);
  const [lots, setLots] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState(null);
  const [targetWallet, setTargetWallet] = useState('');
  const [blockMinutes, setBlockMinutes] = useState(60);
  const [adminName, setAdminName] = useState('');

  const loadAll = async () => {
    const [dashboard, chatStats, claimsData, lotsData] = await Promise.all([
      fetchDashboard(token),
      fetchChatStats(token),
      fetchClaims(token),
      fetchLots(token),
    ]);
    setData(dashboard);
    setChat(chatStats);
    setClaims(claimsData.claims);
    setLots(lotsData);
  };

  const load = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await loadAll();
    } catch (err) {
      setError(err.message);
      setData(null);
      setChat(null);
      setClaims(null);
      setLots(null);
    } finally {
      setLoading(false);
    }
  };

  const runAction = async (fn) => {
    setActionMsg(null);
    try {
      const result = await fn();
      setActionMsg(JSON.stringify(result));
      await loadAll();
    } catch (err) {
      setActionMsg(`Erro: ${err.message}`);
    }
  };

  const handleMarkPaid = (ticketId, prizeLabel, wallet) => {
    const confirmed = window.confirm(
      `Confirma o pagamento manual de ${prizeLabel} para a carteira ${wallet}?\n\n` +
        `Esta ação NÃO envia SOL automaticamente — ela apenas registra que você já pagou manualmente. ` +
        `Você já transferiu o prêmio pela sua própria carteira?`
    );
    if (!confirmed) return;
    runAction(() => markClaimPaid(token, ticketId, adminName));
  };

  return (
    <div className="admin-page">
      <h1 className="admin-page__title">Raspe SOL — Admin</h1>

      <form className="admin-login" onSubmit={load}>
        <input
          type="password"
          placeholder="Admin token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="admin-login__input"
        />
        <button className="btn btn--primary" type="submit" disabled={loading || !token}>
          {loading ? '…' : 'Entrar'}
        </button>
      </form>

      {error && <p className="admin-error">{error}</p>}

      {/* Estatísticas Gerais */}
      {data?.stats && (
        <section className="admin-card">
          <h2>Estatísticas Gerais</h2>
          <div className="admin-stats">
            <Stat label="Lotes criados" value={data.stats.lotesCriados} />
            <Stat label="Lotes finalizados" value={data.stats.lotesFinalizados} />
            <Stat label="Tickets vendidos" value={data.stats.ticketsVendidos} />
            <Stat label="Tickets restantes" value={data.stats.ticketsRestantes} />
            <Stat label="Total arrecadado" value={`${data.stats.totalArrecadadoSol} SOL`} />
            <Stat label="Total pago em prêmios" value={`${data.stats.totalPagoEmPremiosSol} SOL`} />
          </div>
        </section>
      )}

      {/* Lote Atual */}
      {data && (
        <>
          <section className="admin-card">
            <h2>Lote Atual</h2>
            {data.currentLot ? (
              <div className="admin-stats">
                <Stat label="Lote" value={`#${data.currentLot.lote}`} />
                <Stat label="Quantidade inicial" value={data.currentLot.quantidadeInicial} />
                <Stat label="Tickets vendidos" value={data.currentLot.vendidos} />
                <Stat label="Tickets restantes" value={data.currentLot.quantidadeDisponivel} />
                <Stat label="Status" value={data.currentLot.ativo ? 'Ativo' : 'Encerrado'} />
                <Stat label="Criado em" value={fmt(data.currentLot.criadoEm)} />
              </div>
            ) : (
              <p>Nenhum lote encontrado.</p>
            )}

            <p className="admin-note">
              Próximo lote automático: <strong>#{data.proximoLote}</strong>
            </p>
            <p className="admin-note">
              Total de tickets disponíveis agora:{' '}
              <strong>{data.totalTicketsDisponiveisAgora}</strong>
              {data.lotesVendendoSimultaneamente?.length > 1 && (
                <> — lotes {data.lotesVendendoSimultaneamente.map((l) => `#${l}`).join(', ')}</>
              )}
            </p>
          </section>

          {/* Histórico de Lotes */}
          <section className="admin-card">
            <h2>Histórico de Lotes</h2>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Lote</th>
                  <th>Inicial</th>
                  <th>Vendidos</th>
                  <th>Restante</th>
                  <th>Status</th>
                  <th>Criado em</th>
                  <th>Encerrado em</th>
                </tr>
              </thead>
              <tbody>
                {data.historico?.map((l) => (
                  <tr key={l.lote}>
                    <td>#{l.lote}</td>
                    <td>{l.quantidadeInicial}</td>
                    <td>{l.vendidos}</td>
                    <td>{l.quantidadeDisponivel}</td>
                    <td>{l.ativo ? 'Ativo' : 'Encerrado'}</td>
                    <td>{fmt(l.criadoEm)}</td>
                    <td>{fmt(l.encerradoEm)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      {/* Lotes (com prêmios restantes usando optional chaining) */}
      {lots && (
        <section className="admin-card">
          <h2>Lotes</h2>

          {lots.activeLot ? (
            <>
              <div className="admin-stats">
                <Stat label="Lote ativo" value={`#${lots.activeLot.lote}`} />
                <Stat label="Tickets vendidos" value={lots.activeLot.vendidos} />
                <Stat label="Tickets restantes" value={lots.activeLot.quantidadeDisponivel} />
                <Stat label="Percentual vendido" value={`${lots.activeLot.percentualVendido}%`} />
                <Stat label="Receita estimada" value={`${lots.activeLot.receitaEstimadaSol} SOL`} />
                <Stat label="Valor total distribuído" value={`${lots.activeLot.valorTotalDistribuidoSol} SOL`} />
              </div>

              <h3 className="admin-subheading">Prêmios restantes por categoria</h3>
              <div className="admin-stats">
                {lots.activeLot?.premiosRestantes?.map((p) => (
                  <Stat key={p.label} label={p.label} value={p.remaining} />
                ))}
              </div>
            </>
          ) : (
            <p>Nenhum lote ativo encontrado.</p>
          )}

          <h3 className="admin-subheading">Últimos lotes finalizados</h3>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Lote</th>
                <th>Vendidos</th>
                <th>Receita estimada</th>
                <th>Criado em</th>
                <th>Encerrado em</th>
              </tr>
            </thead>
            <tbody>
              {lots.lotesFinalizados?.length === 0 ? (
                <tr>
                  <td colSpan={5}>Nenhum lote finalizado ainda.</td>
                </tr>
              ) : (
                lots.lotesFinalizados.map((l) => (
                  <tr key={l.lote}>
                    <td>#{l.lote}</td>
                    <td>{l.vendidos}</td>
                    <td>{l.receitaEstimadaSol} SOL</td>
                    <td>{fmt(l.criadoEm)}</td>
                    <td>{fmt(l.encerradoEm)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      )}

      {/* Claims */}
      {claims && (
        <section className="admin-card">
          <h2>Claims — Pagamento Manual de Prêmios</h2>
          <p className="admin-note">
            Esta área nunca envia SOL automaticamente. O administrador paga manualmente e marca como pago aqui.
          </p>

          <div className="admin-chat-mod">
            <input
              className="admin-login__input"
              placeholder="Seu nome/identificação (paid_by)"
              value={adminName}
              onChange={(e) => setAdminName(e.target.value)}
            />
          </div>

          <table className="admin-table">
            <thead>
              <tr>
                <th>Ticket ID</th>
                <th>Wallet</th>
                <th>Prêmio</th>
                <th>Data</th>
                <th>Transaction Signature</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {claims.length === 0 ? (
                <tr>
                  <td colSpan={7}>Nenhum claim registrado ainda.</td>
                </tr>
              ) : (
                claims.map((c) => (
                  <tr key={c.ticketId}>
                    <td>{c.ticketId}</td>
                    <td>{c.wallet}</td>
                    <td>{c.prizeSol} SOL</td>
                    <td>{fmt(c.claimedAt)}</td>
                    <td className="admin-table__mono">{c.txSignature}</td>
                    <td>
                      {c.claimStatus === 'PAID' 
                        ? `🟢 Pago (${c.claimPaidBy}, ${fmt(c.claimPaidAt)})` 
                        : '🟡 Pendente'}
                    </td>
                    <td>
                      {c.claimStatus === 'PENDING' && (
                        <button 
                          className="btn btn--ghost" 
                          onClick={() => handleMarkPaid(c.ticketId, `${c.prizeSol} SOL`, c.wallet)}
                        >
                          Marcar como Pago
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {actionMsg && <p className="admin-note">{actionMsg}</p>}
        </section>
      )}

      {/* Chat Global */}
      {chat && (
        <section className="admin-card">
          <h2>Chat Global</h2>
          <div className="admin-stats">
            <Stat label="Usuários online" value={`🟢 ${chat.onlineCount}`} />
            <Stat label="Mensagens ativas" value={chat.totalMessages} />
            <Stat label="Denunciadas" value={chat.reportedMessages} />
            <Stat label="Imagens" value={chat.imageCount} />
            <Stat label="Armazenamento" value={fmtBytes(chat.storageBytes)} />
          </div>

          <div className="admin-chat-actions">
            <button className="btn btn--ghost" onClick={() => runAction(() => clearChat(token))}>
              Limpar Chat
            </button>
          </div>

          <div className="admin-chat-mod">
            <input
              className="admin-login__input"
              placeholder="Endereço da carteira"
              value={targetWallet}
              onChange={(e) => setTargetWallet(e.target.value)}
            />
            <input
              className="admin-login__input admin-login__input--small"
              type="number"
              min="1"
              value={blockMinutes}
              onChange={(e) => setBlockMinutes(e.target.value)}
            />
            <button
              className="btn btn--ghost"
              disabled={!targetWallet}
              onClick={() => runAction(() => kickChatWallet(token, targetWallet))}
            >
              Expulsar
            </button>
            <button
              className="btn btn--ghost"
              disabled={!targetWallet}
              onClick={() => runAction(() => blockChatWallet(token, targetWallet, Number(blockMinutes)))}
            >
              Bloquear (min)
            </button>
          </div>

          {actionMsg && <p className="admin-note">{actionMsg}</p>}

          <h3 className="admin-subheading">Online agora</h3>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Carteira</th>
                <th>Conectado em</th>
                <th>Última atividade</th>
                <th>Conexões</th>
              </tr>
            </thead>
            <tbody>
              {chat.onlineWallets?.map((w) => (
                <tr key={w.wallet}>
                  <td>{w.wallet}</td>
                  <td>{new Date(w.connectedAt).toLocaleTimeString()}</td>
                  <td>{new Date(w.lastSeen).toLocaleTimeString()}</td>
                  <td>{w.connections}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="admin-stat">
      <span className="admin-stat__label">{label}</span>
      <span className="admin-stat__value">{value}</span>
    </div>
  );
}
