// Plain Unicode characters — rendered by the OS/browser's own emoji font,
// so there's zero asset weight and no network dependency. Two categories,
// matching the "hand gestures" and "smileys" picker screens the person
// shared as reference.
export const EMOJI_CATEGORIES = [
  {
    key: 'gestures',
    label: '✋',
    emoji: ['👏', '🤝', '👍', '👎', '👊', '✊', '🤛', '🤜', '✋', '🤚', '🖐️', '🤞', '✌️', '🤟', '🤘', '👌', '🤏', '👈', '👉', '🤙', '🖖', '👋'],
  },
  {
    key: 'smileys',
    label: '😀',
    emoji: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂',
      '🙂', '🙃', '🫠', '😉', '😊', '😇', '🥰', '😍',
      '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜',
      '🤪', '🥲', '🤑', '🤗', '🤭', '🫢', '🤫', '🤔',
      '🫡', '😶', '🙄', '😏', '😬', '😴', '🤤', '😪',
    ],
  },
];

// Bonus quick-reactions on messages (Discord/Telegram-style), per spec.
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '🎉', '🚀'];

