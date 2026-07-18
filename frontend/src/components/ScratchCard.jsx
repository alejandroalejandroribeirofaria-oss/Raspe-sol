import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider'
import { audioManager } from '../audio/AudioManager.js';
import { resultEffectForPrize } from '../audio/config.js';

const { T } = useri18n()
const REVEAL_THRESHOLD = 0.55; // fraction of foil scratched before auto-clearing

export default function ScratchCard({ prizeLabel, prizeLamports = 0, onRevealed }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const scratching = useRef(false);
  const [revealed, setRevealed] = useState(false);
  const { t } = useI18n();
  const won = prizeLamports > 0;

  const paintFoil = useCallback((canvas) => {
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, '#e4e8f0');
    grad.addColorStop(0.5, '#aab2c4');
    grad.addColorStop(1, '#c8cdd6');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Fine noise lines to sell the "brushed foil" texture.
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = '#5a6072';
    for (let i = 0; i < width; i += 3) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 20, height);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#5a6072';
    ctx.font = '600 15px Rajdhani, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(t('scratchToReveal').toUpperCase(), width / 2, height / 2);
  }, [t]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const resize = () => {
      canvas.width = wrap.clientWidth;
      canvas.height = wrap.clientHeight;
      paintFoil(canvas);
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [paintFoil]);

  const scratchAt = (x, y) => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(x, y, 22, 0, Math.PI * 2);
    ctx.fill();
  };

  const checkRevealProgress = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const { data } = ctx.getImageData(0, 0, width, height);
    let cleared = 0;
    for (let i = 3; i < data.length; i += 4 * 8) {
      // sample every 8th pixel's alpha channel for performance
      if (data[i] === 0) cleared++;
    }
    const total = data.length / (4 * 8);
    if (cleared / total > REVEAL_THRESHOLD && !revealed) {
      setRevealed(true);
      audioManager.play(resultEffectForPrize(prizeLamports));
      if (won) audioManager.play('confetti');
      onRevealed?.();
    }
  };

  const pointFromEvent = (evt) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const point = evt.touches ? evt.touches[0] : evt;
    return { x: point.clientX - rect.left, y: point.clientY - rect.top };
  };

  const handleStart = (evt) => {
    scratching.current = true;
    audioManager.startLoop('scratchLoop');
    const { x, y } = pointFromEvent(evt);
    scratchAt(x, y);
  };
  const handleMove = (evt) => {
    if (!scratching.current) return;
    const { x, y } = pointFromEvent(evt);
    scratchAt(x, y);
  };
  const handleEnd = () => {
    if (!scratching.current) return;
    scratching.current = false;
    audioManager.stopLoop('scratchLoop');
    checkRevealProgress();
  };

  // Safety net: stop the scratch loop if the component unmounts mid-scratch.
  useEffect(() => () => audioManager.stopLoop('scratchLoop'), []);

  return (
    <div className={`scratch-card ${won ? 'scratch-card--win' : ''}`}>
      <div className="scratch-card__prize">
        <span className="scratch-card__prize-label">{won ? t('youWon') : t('betterLuck')}</span>
        <span className="scratch-card__prize-value">{prizeLabel}</span>
      </div>
      <div className="scratch-card__foil-wrap" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className={`scratch-card__canvas ${revealed ? 'is-cleared' : ''}`}
          onMouseDown={handleStart}
          onMouseMove={handleMove}
          onMouseUp={handleEnd}
          onMouseLeave={handleEnd}
          onTouchStart={handleStart}
          onTouchMove={handleMove}
          onTouchEnd={handleEnd}
        />
      </div>
      <p className="scratch-card__hint">{t('scratchInstructions')}</p>
    </div>
  );
}
