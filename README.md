# Raspe SOL

Scratch-ticket platform priced at **0.01 SOL** per ticket, paid via Phantom
Wallet and settled on Solana. The backend is the single source of truth for
every payment — it never trusts anything the frontend claims, it re-verifies
each transaction directly against the chain before releasing a ticket.

## Structure

```
backend/    Node.js + Express + SQLite (better-sqlite3) + ws
frontend/   React + Vite, i18n in EN / PT / ZH
```

## Backend setup

```bash
cd backend
npm install
cp .env.example .env
# edit .env: set TREASURY_WALLET, SOLANA_RPC_URL (use a paid RPC provider
# in production — the public endpoint rate-limits hard), CORS_ORIGIN, etc.
npm run dev
```

On first boot it seeds a batch of 10,000 tickets (`db.js: seedTicketBatch`)
with a fixed, hash-committed prize table — outcomes are decided at ticket
creation time, not at reveal time, so nothing can be adjusted after a
purchase.

## Frontend setup

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Requires the [Phantom Wallet](https://phantom.app/) browser extension.

## Payment flow (what actually enforces safety)

1. `POST /api/orders { wallet, quantity }` reserves nothing yet — it just
   records how many tickets the buyer *intends* to buy and computes
   `expectedLamports = quantity × ticketPrice`. The order expires in 5
   minutes if never paid.
2. Frontend asks Phantom to sign and send a native SOL transfer to
   `TREASURY_WALLET`.
3. Frontend sends the resulting signature to
   `POST /api/orders/:id/confirm`. This is the only endpoint that can mark an
   order `PAID`, and it:
   - fetches the transaction from the RPC itself (never trusts the frontend),
   - rejects it if older than `MAX_TRANSACTION_AGE_SECONDS`,
   - confirms the wallet is both the **signer** and the **fee payer**, not
     just some account mentioned in the transaction ("Wallet does not match
     transaction signer."),
   - re-derives the transferred amount from the transaction's own pre/post
     balance deltas (never from a client-supplied number),
   - confirms the recipient is exactly the treasury wallet,
   - rejects reused signatures both via an early lookup and via a `UNIQUE`
     constraint on `processed_transactions.tx_signature` ("Transaction
     already used." — the constraint is what actually closes the race
     between concurrent requests, not the early check),
   - computes **how many tickets the payment actually earned**
     (`floor(receivedLamports / ticketPrice)`), honoring
     `ALLOW_OVERPAYMENT` and capped by `MAX_TICKETS_PER_PURCHASE` — an
     underpayment is rejected outright, an overpayment grants as many whole
     tickets as it covers, never a partial one,
   - only then claims that many tickets, records the transaction, and
     updates the order to `PAID`, all inside a single SQLite transaction —
     if any step throws, the whole thing rolls back.
4. `POST /api/orders/:id/watch` additionally subscribes to the RPC
   websocket so the client gets a live "confirmed on-chain" push.
5. `POST /api/tickets/:uuid/reveal` is gated on ticket ownership
   (`owner_wallet` must match) and `status = SOLD` — this is what the
   scratch-card UI calls to fetch a ticket's already-decided prize.

A 30-second sweep (`sweepExpiredOrders`) releases orders that went
`PENDING` and were never paid.

## Security hardening (backend)

- `config.js` centralizes every security-relevant environment variable —
  commitment level, max transaction age, overpayment policy, per-purchase
  ticket cap.
- `services/solanaVerify.js` uses a **singleton** `Connection` (never
  recreated per request) and verifies signer + fee payer + source account,
  not just "does this transaction exist."
- `SOLANA_COMMITMENT` defaults to `confirmed` for local iteration; set it to
  `finalized` in production so a cluster re-org can never invalidate a
  payment that already granted tickets.
- Every accepted payment is recorded in `processed_transactions`, whose
  `tx_signature` column is the actual replay guard (`PRIMARY KEY`, so a
  second insert throws — same guarantee Prisma's `P2002` gives you, just at
  the SQLite level).
- `audit_log` records wallet, IP, user agent, and a JSON detail blob for
  every order creation, payment, rejection, and expiry sweep.
- `backend/test/orderService.test.js` covers quantity validation, the
  underpayment/exact/overpayment math, signature reuse, wallet mismatch,
  order expiry, and the DB-level uniqueness guarantee. Run with
  `node --test test/` after `npm install`.

## Audio system (frontend)

- `src/audio/AudioManager.js` is the single choke point for every sound —
  components never touch an `<audio>` element directly, they call
  `audioManager.play('click')`, `.startLoop('scratchLoop')`, etc.
- Autoplay-policy safe: nothing plays until the first user gesture
  (`useAudioBoot` hook), and background music only starts after that.
- One shared volume preference (100/75/50/25/Mute), persisted to
  `localStorage`, exposed via the 🔊 control in the top-right corner.
- Wired in: button clicks/hover, wallet connect/disconnect, purchase
  started/confirmed/failed, a continuous scratch sound synced to pointer
  movement that stops the instant you lift off, and a prize-tier-aware
  result sound + confetti cue on reveal.
- See `frontend/public/audio/README.md` for the full file list. Placeholder
  sounds are already generated and present (synthesized offline via
  `frontend/scripts/generate-placeholder-audio.sh`) — the app ships audible
  out of the box; swap any file for real sound design whenever you're ready.

## Production checklist (Render deployment, mainnet-beta)

Official values for this deployment:

| Setting | Value |
|---|---|
| API base URL | `https://raspe-sol#xxxx??????.com` |
| Treasury wallet | `BFxAnfdAxxxxxx????????????E129ex2bimSc8cDnLhZ` |
| Cluster | `mainnet-beta` |
| Ticket price | `0.01 SOL` (`10,000,000` lamports) |
| Lot size | `20,000` tickets, auto-creates next lot at `1,000` remaining |

Copy `backend/.env.production.example` and `frontend/.env.production.example`
into your host's environment settings (don't commit a real `.env`).

1. **Set `NODE_ENV=production`.** `config.js` exports
   `assertProductionReady()`, called at the top of `server.js` — the process
   **refuses to start** if, while `NODE_ENV=production`:
   - `SOLANA_CLUSTER` isn't `mainnet-beta`,
   - `SOLANA_COMMITMENT` isn't `finalized`,
   - `REQUIRE_CHAIN_CONFIRMATION` is false,
   - `ADMIN_TOKEN` isn't set.

   It also validates `TREASURY_WALLET` is a well-formed Solana address at
   import time, in every environment — a typo fails immediately with a
   clear error instead of surfacing later as a confusing web3.js exception.

2. **Get a paid RPC provider before real traffic** (Helius, QuickNode,
   Triton…) and set `SOLANA_RPC_URL` / `VITE_SOLANA_RPC_URL` to it. The
   public endpoint is fine for a first smoke test — the server logs a
   warning at boot if it's still in use — but it rate-limits hard and *will*
   drop payment verification requests under real load.

3. **Set `CORS_ORIGIN`** to the frontend's actual deployed origin. It isn't
   `https://raspe-sol.#xxx?????` unless the frontend is also served from
   that exact domain — check `backend/.env.production.example` for the
   placeholder to replace.

4. **Generate `ADMIN_TOKEN`**: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

5. **`finalized` commitment means slower confirmation** (~13–20s typical,
   sometimes more). `services/solanaVerify.js` retries fetching the
   transaction with backoff (up to ~42s total) specifically so a real,
   already-paid purchase doesn't get falsely rejected just because
   `finalized` status hadn't propagated to the RPC yet the instant the
   frontend called `/confirm`. The 5-minute order expiry gives this room to
   resolve.

6. **`GET /health`** is a dependency-free 200 endpoint for Render's health
   checks / uptime monitors — it never touches the DB or RPC, so it can't
   false-negative on a transient hiccup elsewhere.

7. **Every route the frontend calls, verified present and matching:**
   `GET /api/config`, `POST /api/orders`, `GET /api/orders/:id`,
   `GET /api/orders/:id/tickets`, `POST /api/orders/:id/confirm`,
   `POST /api/orders/:id/watch`, `POST /api/tickets/:uuid/reveal`,
   `GET /api/admin/dashboard` (needs `x-admin-token`), plus the `/ws`
   WebSocket upgrade. `frontend/src/api.js` and `frontend/src/admin/adminApi.js`
   are the only two files that construct these URLs.

8. **Known limitation, by design, not yet solved:** if ticket inventory
   sells out in the handful of seconds between a payment landing on-chain
   and this backend claiming a ticket for it (extremely rare — lots
   auto-create at a 1,000-ticket buffer specifically to make this unlikely),
   the payment is still accepted (it's irreversibly on-chain) but the order
   can end up with fewer granted tickets than paid for. This is logged as
   `PARTIAL_FILL` in `audit_log` for manual reconciliation — there is no
   automatic refund flow. Worth building before very high-volume launch.

## Lot & prize model (exact-count distribution)

Every lot now contains a fixed, guaranteed prize mix — not a probability.
All three knobs live in one place, `backend/config.js`:

```js
export const LOT_SIZE = 20000;              // tickets per lot
export const AUTO_CREATE_THRESHOLD = 1000;  // auto-create the next lot at this many remaining
export const TICKET_PRICE_SOL = 0.01;

export const PRIZES = [
  { label: '0.02 SOL', sol: 0.02, count: 30 },
  { label: '1 SOL',    sol: 1,    count: 1 },
  { label: '2 SOL',    sol: 2,    count: 1 },
  { label: '5 SOL',    sol: 5,    count: 1 },
   { label: '1000 usdt',    usdt: 1000,    count: 1 },
];
```

All three are env-overridable (`LOT_SIZE`, `AUTO_CREATE_THRESHOLD` — 
`LOT_LOW_WATERMARK` still works too, as an alias — and `TICKET_PRICE_SOL`).
`PRIZES` deliberately isn't env-driven — the prize mix is significant
enough that changing it should mean editing and reviewing code, not a
silent env var flip at deploy time.

**How the exact-count guarantee works** (`db.js`'s `generateTickets`): for
a new lot, one slot is created for each entry in `PRIZES` (30 slots at
0.02 SOL, 1 at 1 SOL, 1 at 2 SOL, 1 at 5 SOL — 33 total), every remaining
slot up to `LOT_SIZE` is a zero-prize slot, and the whole array is
Fisher–Yates shuffled with Node's CSPRNG before being assigned to tickets
one-for-one. Because there is only ever *one* 5 SOL slot to begin with,
it's mechanically impossible for two 5 SOL tickets to land in the same lot
— same reasoning covers the single 2 SOL and single 1 SOL guarantees. Each
lot also gets its own random `lot_seed`, folded into every ticket's
existing SHA-256 commitment hash alongside the per-ticket seed, batch key,
and prize — an additional layer of the same "fixed and hash-committed at
creation, never decided at reveal" property the scratch mechanic already
had.

**Auto-creation** is unchanged in mechanism (`lotService.js`'s
`settleLotThresholds`, which already ran after every ticket claim) — only
the threshold moved from 500 to `AUTO_CREATE_THRESHOLD` (1,000), and lot
size from 5,000 to `LOT_SIZE` (20,000). The old lot keeps selling
concurrently until it actually hits zero, exactly as before.

**Data model** — additive only, migrated safely for existing databases
(same `PRAGMA table_info` + `ALTER TABLE` pattern used for the claim
columns): `ticket_lots.lot_id` (a UUID — the actual globally-unique
identifier the spec calls for, distinct from `lote`, the sequential
number already used everywhere internally) and `ticket_lots.lot_seed`.

**Admin — new "Lotes" section** (`AdminDashboard.jsx`, same page as the
existing Claims/Chat sections, consistent with how those were added):
active lot's units sold/remaining, percent sold, estimated revenue,
total prize pool for the lot, and remaining count per prize category
(0.02 / 1 / 2 / 5 SOL) — backed by `GET /api/admin/lots`. The existing
"Lote Atual" / "Histórico de Lotes" cards are untouched.

**Dashboard — new stats block**, additive on the existing
`GET /api/admin/dashboard` response (`stats` field, old fields unchanged):
lots created, lots finished, tickets sold/remaining, total raised (the
*actual* sum of verified on-chain payments, not an estimate), and total
already paid out in prizes (sum of `PAID` claims).

**New/changed files**: `backend/config.js` (+`LOT_SIZE`,
`AUTO_CREATE_THRESHOLD`, `TICKET_PRICE_SOL`, `PRIZES` exports),
`backend/db.js` (exact-distribution generator replaces the old weighted
random picker; `+lot_id`/`+lot_seed` columns and migration),
`backend/services/lotService.js` (`+getPrizeInventoryForLot`,
`+getPrizePoolSol`, `+getLotOverview`, `+getGlobalStats`; `createLot` now
also generates `lot_id`/`lot_seed`), `backend/routes/admin.js` (`+GET
/api/admin/lots`, `dashboard` response gains a `stats` field),
`backend/test/lotPrizes.test.js` (new — asserts the exact 30/1/1/1
distribution on a full 20,000-ticket lot, `lot_id`/`lot_seed` presence,
and the new stats helpers); `frontend/src/admin/AdminDashboard.jsx` +
`adminApi.js` (+global stats block, +Lotes section). Scratch mechanic,
reveal, manual claim, wallets, chat, audio, and i18n are untouched.

## Manual prize claim (no automatic payout)

Winning a scratch ticket does **not** trigger any automatic SOL transfer.
Prizes are paid manually, by an administrator, from their own wallet,
outside this system — this feature only organizes that process and keeps
an audit trail. Nothing here touches the scratch mechanic, prize
generation, wallet module, chat, or ticket purchase flow; it's a pure
addition hooked onto the existing reveal step.

**Flow**
1. Ticket purchase is unchanged — same lot claiming, same atomic payment
   verification as before.
2. When a ticket is revealed (`orderService.revealTicket`, untouched
   otherwise) and it's a winner, one additive line calls
   `claimService.markClaimPendingIfWinner()`, which sets
   `tickets.claim_status = 'PENDING'` and `claimed_at = now`. A losing
   ticket is unaffected — `claim_status` stays `NONE`.
3. The user sees a "🎉 Congratulations! Your prize is awaiting approval —
   🟡 Payment Pending" screen, with a **View My Tickets** button. There is
   deliberately no claim/withdraw button anywhere in the frontend.
4. An admin opens **Admin Dashboard > Claims**, sees the pending prize
   (Ticket ID, wallet, amount, date, transaction signature), pays the
   winner manually from their own wallet, then clicks **Marcar como Pago**
   — which asks for confirmation before doing anything.
5. Confirming calls `POST /api/admin/claims/:ticketUuid/mark-paid`
   (admin-token gated), which sets `claim_status = 'PAID'`,
   `claim_paid_at = now`, `claim_paid_by = <admin>`, and writes a
   `CLAIM_MARKED_PAID` entry to the existing `audit_log` table (admin,
   ticket, wallet, prize amount, timestamp, IP).
6. On reconnecting, the wallet's owner sees a small banner if they have a
   pending or newly-paid prize (`PendingPrizeBanner`).

**Data model** — additive columns only, migrated safely for databases that
already existed before this feature (`PRAGMA table_info` check +
`ALTER TABLE ... ADD COLUMN`, so it's safe to deploy over existing data):
`tickets.claim_status` (`NONE | PENDING | PAID`), `claimed_at`,
`claim_paid_at`, `claim_paid_by`.

**Security** — `claim_status` can only ever change through
`services/claimService.js`, called only from `orderService.revealTicket`
(NONE → PENDING, automatic, no money moved) and from the admin routes in
`routes/admin.js` (PENDING → PAID, behind the same `x-admin-token` gate as
the rest of the admin API). There is no frontend code path, authenticated
or not, that can set a claim's status directly — `GET /api/tickets/mine`
is read-only, and the reveal endpoint only ever reports the status the
backend already decided.

**New/changed files**: `backend/services/claimService.js` (new),
`backend/db.js` (+columns, +migration), `backend/services/orderService.js`
(+1 hook call in `revealTicket`), `backend/routes/orders.js` (+`GET
/api/tickets/mine`, reveal response gains a `claimStatus` field),
`backend/routes/admin.js` (+`GET /api/admin/claims`, +`POST
/api/admin/claims/:id/mark-paid`), `backend/test/claimService.test.js`
(new); `frontend/src/tickets/*` (new: `MyTicketsPanel`,
`PrizeClaimResult`, `PendingPrizeBanner`), `frontend/src/components/
ScratchCard.jsx` (+`onRevealed` callback prop only), `frontend/src/
components/BuyFlow.jsx` (+result panel, existing flow otherwise
unchanged), `frontend/src/App.jsx`, `frontend/src/admin/AdminDashboard.jsx`
+ `adminApi.js` (+Claims section), `frontend/src/api.js`
(+`getMyTickets`), i18n files, `styles/index.css`.

## Real-time global chat (ephemeral, 1-hour TTL)

A Telegram/Discord-style global chat, identified purely by connected wallet
(no accounts, no login) — and deliberately temporary: every message and
image is hard-deleted exactly one hour after it was sent, so the system's
footprint never grows no matter how long it's been running.

**Backend**
- `services/chatService.js` — message validation (length, empty, banned
  words), HTML-escaping, per-wallet rate limiting (1 msg/sec, 3 images/min,
  both in-memory), reports/auto-hide, and `sweepExpiredMessages()` — the
  function that actually deletes expired rows *and* their image files from
  disk.
- `services/chatImageService.js` — validates type/size, compresses
  PNG/JPG/WEBP to WebP via `sharp` (GIFs pass through untouched so animation
  isn't destroyed by re-encoding).
- `services/chatHub.js` — the chat WebSocket (`/ws/chat?wallet=...`,
  separate from the existing order-status socket at `/ws`): join/leave,
  `chat:send`/`chat:typing`/`chat:react`/`chat:report`, and broadcasts.
- `services/presenceService.js` — online users, **kept entirely in memory**
  (not a DB table) since presence is high-churn, disposable state; writing
  every connect/heartbeat to SQLite would be pure overhead for something
  that's meaningless after a restart anyway. This is a deliberate deviation
  from a literal "OnlineUsers table" — same information, without the
  write cost.
- `routes/chat.js` — `POST /api/chat/upload` (the one thing that has to be
  REST, since multipart doesn't fit over a WebSocket frame cleanly).
- `db.js` — `chat_messages`, `chat_reports` (`PRIMARY KEY(message_id, wallet)`
  is what actually stops report-spam), `chat_reactions`, `chat_blocked_wallets`.
- A 15-second sweep in `server.js` calls `sweepExpiredMessages()` and pushes
  `chat:expired` to every connected client with the removed IDs, so clients
  prune locally instead of ever re-fetching "history."
- Admin additions in `routes/admin.js`: `GET /api/admin/chat` (online count,
  message/report/image counts, storage bytes), `POST /api/admin/chat/clear`,
  `/kick`, `/block`.

**Frontend** (`src/chat/`)
- `ChatProvider.jsx` / `ChatContext.jsx` / `useChat.js` — owns the socket,
  reconnects with backoff, keeps a capped in-memory event list
  (`MAX_CLIENT_EVENTS = 300`) so a tab left open for days doesn't grow
  unbounded even before the server-side sweep would have cleaned things up.
- `ChatWindow.jsx`, `ChatMessage.jsx`, `ChatInput.jsx`, `EmojiPicker.jsx`,
  `ImageLightbox.jsx`, `ChatToggleButton.jsx` — the UI. Reactions, reply,
  copy-address, report, fullscreen image viewer, typing indicator, online
  count, all wired to the existing audio system for clicks/open/close.
- `emojiData.js` — the two emoji categories (gestures, smileys) as plain
  Unicode characters, matching the picker screenshots — no image assets, no
  network, renders via the OS's own emoji font.
- `avatarUtils.js` — deterministic color+initials avatar from the wallet
  address (no identicon library, no network).
- Added to the main menu via `ChatToggleButton` in the topbar (unread
  badge) — opens a Telegram-style slide-in panel; doesn't touch the
  existing ticket-purchase UI.
- `AdminDashboard.jsx` gained a "Chat Global" section: stats, clear-chat,
  and per-wallet kick/block controls, reusing the existing admin-token gate.

**Why this stays lightweight forever:** there's no archive table and no
soft-delete — a message's only two states are "exists with a future
`expires_at`" or "gone." The sweep runs on a fixed interval regardless of
message volume, so query cost stays proportional to *current* live messages
(capped at `CHAT_HISTORY_LIMIT`, default 200), never to total messages ever
sent. Presence and rate-limit state live in memory, not the DB. Image files
are deleted from disk in the same sweep that deletes their DB row — nothing
lingers in `uploads/chat/` past an hour.

**Known limitation:** on Render, `uploads/chat/` needs to be on a persistent
disk or images vanish on every redeploy (same caveat as `data/raspesol.db` —
see the production checklist above). Chat itself doesn't need this (it's
ephemeral anyway), but a redeploy shouldn't be what deletes an image early.



- **This is a real-money system.** Depending on your jurisdiction, operating
  a paid scratch-ticket / chance-based game may require a gambling license
  or fall under consumer-protection and anti-money-laundering rules — worth
  a legal check before launch, independent of the code.
- SQLite + WAL is fine for a single backend instance; if you scale
  horizontally (multiple Render instances), move to Postgres so the
  `UNIQUE` constraint on `tx_signature` still works as the race-condition
  guard across instances — and so `data/raspesol.db` isn't lost on a
  redeploy unless it's on a persistent disk.
- Consider a max-exposure check (sum of unclaimed prize liability vs.
  treasury balance) before selling more tickets from a lot.
