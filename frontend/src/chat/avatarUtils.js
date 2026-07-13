function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/** Deterministic HSL color for a wallet address — same wallet always gets the same avatar color. */
export function avatarColorFor(wallet) {
  const hue = hashString(wallet) % 360;
  return `hsl(${hue}, 65%, 45%)`;
}

export function avatarInitialsFor(wallet) {
  return wallet ? wallet.slice(0, 2).toUpperCase() : '??';
}

