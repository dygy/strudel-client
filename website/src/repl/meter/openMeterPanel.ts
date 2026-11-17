/**
 * Open Settings → Meter (spec 033 functional §2.5): leave the performance view if it is open, select the
 * Settings tab, open the panel, then scroll the meter section (`id="settings-meter"`) into view once the
 * tab has rendered it.
 */
import { setActiveFooter } from '@src/settings';
import { closePerformance, performanceOpen } from '../performance/performanceStore';
import { openPanel } from '../components/panel/panelLayout';

/** The Settings tab section the strips open. */
export const METER_SETTINGS_ID = 'settings-meter';
/** How many animation frames to wait for the section to appear. */
const MAX_FRAMES = 30;

export interface OpenMeterPanelDeps {
  /** Whether the layout is compact (the panel opens as the phone sheet). */
  compact: boolean;
  documentTarget?: Pick<Document, 'getElementById'> | null;
  requestFrame?: (callback: () => void) => unknown;
}

/** Open the panel on Settings and scroll to the meter. Returns false without a document. */
export function openMeterPanel({ compact, documentTarget, requestFrame }: OpenMeterPanelDeps): boolean {
  const doc = documentTarget ?? (typeof document !== 'undefined' ? document : null);
  if (!doc) return false;
  if (performanceOpen.get()) closePerformance();
  setActiveFooter('settings');
  openPanel(compact);
  const frame =
    requestFrame ??
    ((callback: () => void) =>
      typeof requestAnimationFrame === 'function' ? requestAnimationFrame(callback) : setTimeout(callback, 16));
  let frames = 0;
  const tryScroll = () => {
    const section = doc.getElementById(METER_SETTINGS_ID);
    if (section) {
      section.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
      return;
    }
    if (++frames < MAX_FRAMES) frame(tryScroll);
  };
  frame(tryScroll);
  return true;
}
