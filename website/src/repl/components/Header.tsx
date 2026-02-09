import PlayCircleIcon from '@heroicons/react/20/solid/PlayCircleIcon';
import StopCircleIcon from '@heroicons/react/20/solid/StopCircleIcon';
import { Bars3Icon } from '@heroicons/react/24/outline';
import cx from '@src/cx';
import { useSettings, setIsZen, setIsFileManagerOpen } from '../../settings';
import { useTranslation } from '@src/i18n';
import { AuthButton } from '../../components/auth/AuthButton';
import '../Repl.css';

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
  mixer?: any;
  isPreviewing?: boolean;
  handlePreviewToggle?: () => void;
}

interface HeaderProps {
  context: ReplContext;
  embedded?: boolean;
}

export function Header({ context, embedded = false }: HeaderProps) {
  const { started, pending, isDirty, activeCode, handleTogglePlay, handleEvaluate, handleShuffle, handleShare, mixer, isPreviewing, handlePreviewToggle } =
    context;
  const isEmbedded = typeof window !== 'undefined' && (embedded || window.location !== window.parent.location);
  const { isZen, isButtonRowHidden, isCSSAnimationDisabled, fontFamily, isFileManagerOpen } = useSettings();
  const { t } = useTranslation('common');

  return (
    <header
      id="header"
      className={cx(
        'flex-none text-black  z-[100] text-lg select-none h-20 md:h-14',
        !isZen && !isEmbedded && 'bg-lineHighlight',
        isZen ? 'h-12 w-8 fixed top-0 left-0' : 'sticky top-0 w-full py-1 justify-between',
        isEmbedded ? 'flex' : 'md:flex',
      )}
      style={{ fontFamily }}
    >
        <div className="px-4 flex space-x-2 md:pt-0 select-none">
          <h1
            dir="ltr"
            onClick={() => {
              if (isEmbedded) window.open(window.location.href.replace('embed', ''));
            }}
            className={cx(
              isEmbedded ? 'text-l cursor-pointer' : 'text-xl',
              'text-foreground font-bold flex space-x-2 items-center',
            )}
          >
            <div
              className={cx(
                'mt-[1px]',
                started && !isCSSAnimationDisabled && 'animate-spin',
                'cursor-pointer text-blue-500',
                isZen && 'fixed top-2 right-4',
              )}
              onClick={() => {
                if (!isEmbedded) {
                  setIsZen(!isZen);
                }
              }}
            >
              <span className="block text-foreground rotate-90">꩜</span>
            </div>
            {!isZen && (
              <div className="space-x-2">
                <span className="">strudel</span>
                <span className="text-sm font-medium">by Dygy</span>
              </div>
            )}
          </h1>
        </div>
        
        {/* Main controls and auth button container */}
        <div className="flex items-center">
          {!isZen && !isButtonRowHidden && (
            <div className="flex max-w-full overflow-auto text-foreground px-1 md:px-2">
              {!isEmbedded && (
                <button
                  onClick={() => setIsFileManagerOpen(!isFileManagerOpen)}
                  title={t('toggleFileManager')}
                  className={cx('p-2 hover:opacity-50 flex items-center space-x-1')}
                >
                  <Bars3Icon className="w-5 h-5" />
                  <span>{t('files')}</span>
                </button>
              )}
              <button
                onClick={handleTogglePlay}
                title={started ? t('stop') : t('play')}
                className={cx(
                  !isEmbedded ? 'p-2' : 'px-2',
                  'hover:opacity-50',
                  !started && !isCSSAnimationDisabled && 'animate-pulse',
                )}
              >
                {!pending ? (
                  <span className={cx('flex items-center space-x-2')}>
                    {started ? <StopCircleIcon className="w-6 h-6" /> : <PlayCircleIcon className="w-6 h-6" />}
                    {!isEmbedded && <span>{started ? t('stop') : t('play')}</span>}
                  </span>
                ) : (
                  <>{t('loading')}</>
                )}
              </button>
              <button
                onClick={handleEvaluate}
                title={t('update')}
                className={cx(
                  'flex items-center space-x-1',
                  !isEmbedded ? 'p-2' : 'px-2',
                  !isDirty || !activeCode ? 'opacity-50' : 'hover:opacity-50',
                )}
              >
                {!isEmbedded && <span>{t('update')}</span>}
              </button>
              {mixer && mixer.isInitialized && handlePreviewToggle && (
                <button
                  onClick={handlePreviewToggle}
                  title={isPreviewing ? t('stopPreview') : t('playPreview')}
                  className={cx(
                    'p-2 hover:opacity-50 flex items-center space-x-1',
                    isPreviewing && 'bg-blue-500 bg-opacity-20'
                  )}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M12 12h.01M9 9l-6 6M9 15l-6-6" />
                  </svg>
                  {!isEmbedded && <span>{isPreviewing ? t('stopPreview') : t('playPreview')}</span>}
                </button>
              )}
            </div>
          )}
          
          {/* Auth Button - always visible when not embedded or zen mode */}
          {!isZen && !isEmbedded && (
            <div className="px-4">
              <AuthButton />
            </div>
          )}
        </div>
      </header>
    );
  }