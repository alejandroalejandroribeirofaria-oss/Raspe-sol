export const TICKET_STATUS = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  SOLD: 'SOLD',
  SCRATCHED: 'SCRATCHED',
  PRIZE_PAID: 'PRIZE_PAID'
});

export const BATCH_STATUS = Object.freeze({
  OPEN: 'OPEN',
  CLOSED: 'CLOSED'
});

export const TICKETS_PER_BATCH = 5_000;
export const LAMPORTS_PER_SOL_BIGINT = 1_000_000_000n;
export const TICKET_PRICE_LAMPORTS = 20_000_000n;

export const PRIZE_DISTRIBUTION = [
  { count: 1, lamports: 5_000_000_000n },
  { count: 1, lamports: 2_000_000_000n },
  { count: 1, lamports: 1_000_000_000n },
  { count: 10, lamports: 20_000_000n }
];

export const LOSER_MESSAGES = [
  'Tente novamente.',
  'Quase!',
  'A sorte pode estar no próximo.',
  'Não desista.',
  'Hoje não foi dessa vez.',
  'Sua sorte pode mudar.',
  'Continue tentando.',
  'Nunca pare de acreditar.',
  'Boa tentativa.',
  'Quem sabe no próximo bilhete?'
];

