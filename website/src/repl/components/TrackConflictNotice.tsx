/**
 * "This track was changed elsewhere": shown while saving is paused for the open track (spec 018,
 * functional 2.5). Neither button touches audio, so the music carries on however long this stays up.
 */
import { useStore } from '@nanostores/react';
import { useTranslation } from '@src/i18n';
import cx from '@src/cx';
import { trackConflictStore, type TrackConflictController } from '../trackConflict';
import { usePanelViewport } from './panel/panelViewport';

export function TrackConflictNotice({ controller }: { controller: TrackConflictController | null }) {
  const state = useStore(trackConflictStore);
  const { t } = useTranslation('files');
  const { compact } = usePanelViewport();
  if (!state || !controller) return null;

  const button = cx(
    'px-3 py-1 rounded-md text-sm font-medium border border-foreground text-foreground',
    'hover:bg-lineHighlight disabled:opacity-50 whitespace-nowrap',
    compact && 'min-h-11',
  );
  const detail =
    state.kind === 'deleted'
      ? 'trackConflict.deletedDetail'
      : state.restored
        ? 'trackConflict.restoredDetail'
        : 'trackConflict.detail';

  return (
    <div
      role="alert"
      data-testid="track-conflict-notice"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 bg-lineHighlight border-b border-foreground text-foreground"
    >
      <div className="flex-1 min-w-[12rem]">
        <p className="text-sm font-semibold">{t('trackConflict.message')}</p>
        <p className="text-xs opacity-80">{t(detail, { name: state.trackName })}</p>
        {state.failed && <p className="text-xs font-medium">{t('trackConflict.failed')}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {state.kind === 'deleted' ? (
          <button
            type="button"
            data-testid="track-conflict-discard"
            disabled={state.busy}
            onClick={() => controller.discard()}
            className={button}
          >
            {t('trackConflict.discard')}
          </button>
        ) : (
          <button
            type="button"
            data-testid="track-conflict-load"
            disabled={state.busy}
            onClick={() => void controller.loadNewVersion()}
            className={button}
          >
            {t('trackConflict.loadNew')}
          </button>
        )}
        <button
          type="button"
          data-testid="track-conflict-keep"
          disabled={state.busy}
          onClick={() => void controller.keepMine()}
          className={button}
        >
          {t('trackConflict.keepMine')}
        </button>
      </div>
    </div>
  );
}
