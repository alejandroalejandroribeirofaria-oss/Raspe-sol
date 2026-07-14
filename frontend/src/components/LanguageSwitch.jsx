import { LANGUAGES, useI18n } from '../i18n/I18nContext';
import { audioManager } from '../audio/AudioManager.js';

export default function LanguageSwitch() {
  const { lang, setLang } = useI18n();
  return (
    <div className="lang-switch" role="group" aria-label="Language">
      {LANGUAGES.map((l) => (
        <button
          key={l.code}
          className={`lang-switch__btn ${lang === l.code ? 'is-active' : ''}`}
          onClick={() => {
            audioManager.play('click');
            setLang(l.code);
          }}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
