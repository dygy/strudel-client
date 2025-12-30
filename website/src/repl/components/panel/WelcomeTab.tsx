import { useSettings } from '@src/settings';
import { useTranslation } from '@src/i18n';

const { BASE_URL } = import.meta.env;
const baseNoTrailing = BASE_URL.endsWith('/') ? BASE_URL.slice(0, -1) : BASE_URL;

interface ReplContext {
  started?: boolean;
  pending?: boolean;
  isDirty?: boolean;
  activeCode?: string;
  handleTogglePlay: () => void;
  handleEvaluate: () => void;
  handleShuffle: () => void;
  handleShare: () => void;
}

interface WelcomeTabProps {
  context: ReplContext;
}

export function WelcomeTab({ context }: WelcomeTabProps) {
  const { fontFamily } = useSettings();
  const { t } = useTranslation('welcome');
  
  return (
    <div className="prose dark:prose-invert min-w-full pt-2 font-sans pb-8 px-4 " style={{ fontFamily }}>
      <h3>꩜ {t('title')}</h3>
      <p>
        {t('description')}
        <br />
        <br />
        <div className="underline whitespace-pre-line">{t('steps')}</div>
      </p>
      <p>
        {t('getStarted')}{' '}
        <a href={`${baseNoTrailing}/workshop/getting-started/`} target="_blank">
          {t('interactiveTutorial')}
        </a>
        . {t('joinDiscord')}{' '}
        <a href="https://discord.com/invite/HGEdXmRkzT" target="_blank">
          {t('discordChannel')}
        </a>{' '}
        {t('discordText')}
      </p>
      <h3>꩜ {t('aboutTitle')}</h3>
      <p>
        {t('aboutDescription')}{' '}
        <a href="https://tidalcycles.org/" target="_blank">
          {t('tidalcycles')}
        </a>
        {t('tidalDescription')}{' '}
        <a href="https://codeberg.org/uzu/strudel/src/branch/main/LICENSE" target="_blank">
          {t('license')}
        </a>
        . {t('sourceCode')}{' '}
        <a href="https://codeberg.org/uzu/strudel" target="_blank">
          {t('codeberg')}
        </a>
        . {t('licensingInfo')}{' '}
        <a href="https://github.com/felixroos/dough-samples/blob/main/README.md">{t('licensingInfo')}</a>{' '}
        {t('defaultSounds')}
      </p>
    </div>
  );
}