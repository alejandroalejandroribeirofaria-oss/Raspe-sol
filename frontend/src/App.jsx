import { useEffect, useMemo, useState } from 'react';
import {
  Activity, Coins, Languages, Search, ShieldCheck,
  Sparkles, Ticket, Trophy, Loader2, LockKeyhole
} from 'lucide-react';
import { api } from './api/client.js';
import { languages, translations } from './i18n/translations.js';
import { useWallet } from './wallet/WalletContext.jsx';
import ConnectButton from './components/ConnectButton';

const FALLBACK_STATS = {
  open: { number: 1, status: 'OPEN' },
  available: 5000, sold: 0, scratched: 0, prized: 0, history: []
};

const formatSol = (lamports) => {
  if (lamports === undefined || lamports === null) return '—';
  const value = Number(lamports) / 1_000_000_000;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 4 })} SOL`;
};

const short = (value = '') => {
  if (!value) return '—';
  return value.length > 14? `${value.slice(0, 6)}…${value.slice(-6)}` : value;
};

function StatCard({ icon: Icon, label, value }) {
  return (
    <article className="stat-card">
      <div className="stat-icon"><Icon size={20} /></div>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function TicketCard({ ticket, onScratch, busy, t }) {
  const revealed = ['SCRATCHED', 'PRIZE_PAID'].includes(ticket.status);
  const won = revealed && Number(ticket.prizeLamports) > 0;

  return (
    <article className={`ticket-card ${revealed? 'revealed' : ''} ${won? 'winner' : ''}`}>
      <div className="ticket-topline">
        <span>{t.ticket}</span>
        <code>{short(ticket.id)}</code>
      </div>
      <div className="scratch-surface">
        <div className="scratch-glow" />
        <strong>
          {revealed
          ? (won? formatSol(ticket.prizeLamports) : (ticket.loserMessage || t.loser))
            : '████ ████'}
        </strong>
        <small>{revealed? t.prize : t.revealHint}</small>
      </div>
      <dl>
        <div><dt>{t.batch}</dt><dd>#{ticket.batchNumber}</dd></div>
        <div><dt>{t.status}</dt><dd>{ticket.status}</dd></div>
        <div><dt>{t.price}</dt><dd>{formatSol(ticket.ticketPriceLamports)}</dd></div>
      </dl>
      {!revealed && (
        <button className="secondary-action" disabled={busy} onClick={() => onScratch(ticket.id)}>
          {busy? <Loader2 size={16} className="animate-spin" /> : t.scratch}
        </button>
      )}
    </article>
  );
}

function AdminPanel({ t }) {
  const [token, setToken] = useState(localStorage.getItem('raspe_sol_admin') || '');
  const [query, setQuery] = useState({ uuid: '', wallet: '', batch: '' });
  const [results, setResults] = useState([]);
  const [message, setMessage] = useState('');

  const saveToken = (value) => {
    setToken(value);
    localStorage.setItem('raspe_sol_admin', value);
  };

  const runSearch = async () => {
    setMessage('');
    try {
      const data = await api.searchTickets(query, token);
      setResults(data);
    } catch (e) { setMessage(e.message); }
  };

  const downloadReport = async () => {
    try {
      const csv = await api.exportReport(token);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'raspe-sol-report.csv';
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (e) { setMessage(e.message); }
  };

  const createBatch = async (mode) => {
    try {
      const batch = mode === 'manual'
      ? await api.createManualBatch(token)
        : await api.createAutomaticBatch(token);
      setMessage(`Lote ${batch.number} pronto.`);
    } catch (e) { setMessage(e.message); }
  };

  return (
    <section className="panel admin-panel">
      <div className="section-title"><LockKeyhole /><h2>{t.admin}</h2></div>
      <label className="field">
        <span>{t.adminToken}</span>
        <input value={token} onChange={(e) => saveToken(e.target.value)} type="password" placeholder="Cole o token aqui" />
      </label>
      <div className="admin-actions">
        <button onClick={() => createBatch('manual')}>{t.manualBatch}</button>
        <button onClick={() => createBatch('auto')}>{t.autoBatch}</button>
        <button onClick={downloadReport}>{t.exportReport}</button>
      </div>
      <div className="search-grid">
        <input placeholder={t.uuid} value={query.uuid} onChange={(e) => setQuery({...query, uuid: e.target.value })} />
        <input placeholder={t.wallet} value={query.wallet} onChange={(e) => setQuery({...query, wallet: e.target.value })} />
        <input placeholder={t.batch} value={query.batch} onChange={(e) => setQuery({...query, batch: e.target.value })} />
        <button onClick={runSearch}><Search size={16} /> {t.search}</button>
      </div>
      {message && <p className="notice">{message}</p>}
      <div className="result-table">
        {results.map((ticket) => (
          <div className="result-row" key={ticket.id}>
            <code>{short(ticket.id)}</code>
            <span>{short(ticket.buyerWallet)}</span>
            <span>{ticket.status}</span>
            <strong>{formatSol(ticket.prizeLamports)}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

export function App() {
  const [language, setLanguage] = useState(() => localStorage.getItem('raspe_lang') || 'pt');
  const [config, setConfig] = useState(null);
  const [stats, setStats] = useState(FALLBACK_STATS);
  const [leaderboard, setLeaderboard] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState('');
  const [solPrice, setSolPrice] = useState(null);
  const [error, setError] = useState('');

  const { publicKey, balance, connect, payForTicket } = useWallet();
  const t = translations[language];

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

  useEffect(() => {
    fetch(`${API_URL}/api/price`)
    .then(res => res.json())
    .then(data => setSolPrice(data.price))
    .catch(() => setError("Erro ao buscar preço do SOL"));
  }, [API_URL]);

  const loadPublicData = async () => {
    try {
      const [cfg, statData, leaders] = await Promise.all([
        api.config().catch(() => null),
        api.stats().catch(() => FALLBACK_STATS),
        api.leaderboard().catch(() => [])
      ]);
      if (cfg) setConfig(cfg);
      setStats(statData);
      setLeaderboard(leaders);
    } catch (error) {
      setToast(error.message);
    }
  };

  const loadTickets = async () => {
    if (!publicKey) return;
    try {
      setTickets(await api.tickets(publicKey));
    } catch (error) {
      setToast(error.message);
    }
  };

  useEffect(() => { loadPublicData(); }, []);
  useEffect(() => { loadTickets(); }, [publicKey]);

  const activeConfig = useMemo(() => config || {
    ticketPriceLamports: '20000000',
    treasuryWallet: import.meta.env.VITE_TREASURY_WALLET || '',
    cluster: import.meta.env.VITE_DEFAULT_CLUSTER || 'devnet'
  }, [config]);

  const handleLanguageChange = (e) => {
    const newLang = e.target.value;
    setLanguage(newLang);
    localStorage.setItem('raspe_lang', newLang);
  };

  const handleConnect = async () => {
    setBusy('connect');
    try {
      await connect(activeConfig.cluster);
      setToast(t.connected);
    } catch (error) {
      setToast(error.message);
    } finally {
      setBusy('');
    }
  };

  const buyTicket = async () => {
    if (!publicKey) return handleConnect();
    setBusy('buy');
    try {
      if (!activeConfig.treasuryWallet) throw new Error(t.treasuryError);
      const signature = await payForTicket({
        treasuryWallet: activeConfig.treasuryWallet,
        ticketPriceLamports: activeConfig.ticketPriceLamports,
        cluster: activeConfig.cluster
      });
      const ticket = await api.purchase({ wallet: publicKey, signature, cluster: activeConfig.cluster });
      setTickets((current) => [ticket,...current]);
      await loadPublicData();
      setToast(`${t.ticket}: ${short(ticket.id)}`);
    } catch (error) {
      setToast(error.message);
    } finally {
      setBusy('');
    }
  };

  const scratch = async (ticketId) => {
    setBusy(ticketId);
    try {
      const ticket = await api.scratch(ticketId, publicKey);
      setTickets((current) => current.map((item) => item.id === ticket.id? ticket : item));
      await loadPublicData();
    } catch (error) {
      setToast(error.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <main className="app-shell">
      <div className="orb orb-a" />
      <div className="orb orb-b" />

      <header style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem'}}>
        <h1>Raspe SOL</h1>
        <div style={{display: 'flex', gap: '1rem', alignItems: 'center'}}>
          <Languages size={18} />
          <select
            value={language}
            onChange={handleLanguageChange}
            className="bg-transparent border border-white/20 rounded px-2 py-1"
          >
            {languages.map(lang => (
              <option key={lang.code} value={lang.code} style={{background: '#111', color: '#fff'}}>
                {lang.label}
              </option>
            ))}
          </select>
          <ConnectButton />
        </div>
      </header>

      <section className="hero">
        <p className="eyebrow"><ShieldCheck size={16} /> HMAC SHA-256 · Solana · Prisma</p>
        <h1>{t.title}</h1>
        <p className="subtitle">{t.subtitle}</p>
        <div className="hero-actions">
          <button className="primary-action" disabled={busy === 'buy'} onClick={buyTicket}>
            <Sparkles size={18} />
            {busy === 'buy'? <Loader2 size={18} className="animate-spin" /> : t.buy}
          </button>
          <span className="price-pill">
            {t.price}: {formatSol(activeConfig.ticketPriceLamports)}
            {solPrice && ` (~R$ ${solPrice.toFixed(2)})`}
          </span>
        </div>
        {error && <p style={{color: 'red'}}>{error}</p>}
      </section>

      <section className="stats-grid">
        <StatCard icon={Ticket} label={t.remaining} value={stats.available} />
        <StatCard icon={Coins} label={t.sold} value={stats.sold} />
        <StatCard icon={Activity} label={t.scratched} value={stats.scratched} />
        <StatCard icon={Trophy} label={t.prized} value={stats.prized} />
      </section>

      <section className="workspace">
        <section className="panel">
          <div className="section-title">
            <Ticket />
            <h2>{t.history}</h2>
            {publicKey && <span>{t.balance}: {balance?.toFixed(4)?? '—'} SOL</span>}
          </div>
          <div className="tickets-grid">
            {!publicKey && <p className="empty-state">{t.connectWallet}</p>}
            {publicKey && tickets.length === 0 && <p className="empty-state">{t.noTickets}</p>}
            {tickets.map((ticket) => (
              <TicketCard
                key={ticket.id}
                ticket={ticket}
                onScratch={scratch}
                busy={busy === ticket.id}
                t={t}
              />
            ))}
          </div>
        </section>

        <aside className="panel leaderboard">
          <div className="section-title">
            <Trophy />
            <h2>{t.leaderboard}</h2>
          </div>
          {leaderboard.length === 0 && <p className="empty-state">—</p>}
          {leaderboard.map((ticket, index) => (
            <div className="leader-row" key={ticket.id}>
              <span>#{index + 1}</span>
              <code>{short(ticket.buyerWallet)}</code>
              <strong>{formatSol(ticket.prizeLamports)}</strong>
            </div>
          ))}
        </aside>
      </section>

      <AdminPanel t={t} />

      {toast && (
        <button className="toast" onClick={() => setToast('')}>
          {toast}
        </button>
      )}
    </main>
  );
        }
