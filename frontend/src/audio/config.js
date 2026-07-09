export const AUDIO_STORAGE_KEY = 'raspe_sol_audio_preferences';

export const audioConfig = {
  defaultVolume: 0.75,
  defaultMusic: 'solanaNight',
  soundEnabled: true,
  musicEnabled: false,
  musicVolumeRatio: 0.22,
  preloadedEffects: [
    'buttonClick',
    'buttonHover',
    'walletConnect',
    'walletDisconnect',
    'paymentConfirmed',
    'paymentError',
    'lose',
    'smallWin'
  ],
  volumeOptions: [
    { label: '100%', value: 1 },
    { label: '75%', value: 0.75 },
    { label: '50%', value: 0.5 },
    { label: '25%', value: 0.25 },
    { label: 'Mudo', value: 0 }
  ]
};
