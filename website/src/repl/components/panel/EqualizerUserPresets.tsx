import { useState, type KeyboardEvent } from 'react';
import { useTranslation } from '@src/i18n';
import {
  USER_PRESET_NAME_MAX,
  deleteUserPreset,
  loadUserPresets,
  renameUserPreset,
  saveUserPreset,
  type EqualizerSettings,
  type UserPreset,
  type UserPresetError,
  type UserPresetResult,
} from '@strudel/equalizer';

interface EqualizerUserPresetsProps {
  /** The user presets, sorted by name. */
  presets: UserPreset[];
  /** The user preset Rename / Overwrite / Delete act on (the last one picked or saved); null: none. */
  target: string | null;
  /** The active slot's settings now, for Save as and Overwrite. */
  currentSettings: EqualizerSettings;
  /**
   * After a change: the presets now, and what happened: `saved` (Save as / Overwrite: the preset now
   * holds the active slot's settings), `renamed` (only the stored preset's name changed), or
   * undefined (a delete, or a refresh after the preset was found missing).
   */
  onChange: (presets: UserPreset[], change?: UserPresetChange) => void;
  /** Phone layout: 44px touch targets. */
  compact: boolean;
}

type Mode = null | 'saveAs' | 'rename' | 'delete';

/** What a user-preset change did (see `onChange`). */
export type UserPresetChange = { kind: 'saved'; name: string } | { kind: 'renamed'; from: string; to: string };

const MESSAGE_KEYS: Record<Exclude<UserPresetError, 'missing'>, string> = {
  invalid: 'equalizerNameInvalid',
  taken: 'equalizerNameTaken',
  full: 'equalizerPresetsFull',
};

/**
 * Named user presets in the EQ panel (spec 028), both layouts: Save as…, and for the target preset
 * Rename, Overwrite and Delete. Names are typed inline; a taken name asks before overwriting, and
 * Delete asks inside the panel (never a browser dialog). UI and storage only: the panel applies a
 * picked preset and owns the active slot.
 */
export function EqualizerUserPresets({
  presets,
  target,
  currentSettings,
  onChange,
  compact,
}: EqualizerUserPresetsProps) {
  const { t } = useTranslation('settings');
  const [mode, setMode] = useState<Mode>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<UserPresetError | null>(null);
  // Spec 028 review: the target was gone (deleted in another tab); shown until the next action.
  const [missing, setMissing] = useState(false);
  const touch = compact ? ' min-h-11 min-w-11' : '';
  const button = `px-3 py-1 rounded-lg border border-gray-700 bg-gray-800 text-sm text-foreground hover:bg-gray-700 transition-colors${touch}`;
  const targetExists = !!target && presets.some((p) => p.name === target);

  const close = () => {
    setMode(null);
    setDraft('');
    setError(null);
  };

  const open = (next: Mode) => {
    setMissing(false);
    setMode(next);
    setDraft(next === 'rename' && target ? target : '');
    setError(null);
  };

  const finish = (result: UserPresetResult, change?: UserPresetChange) => {
    // `=== false`: without strictNullChecks (website tsconfig) `!result.ok` doesn't narrow the union.
    if (result.ok === false) {
      if (result.reason === 'missing') {
        // Gone meanwhile (another tab): say so and show the list as stored now.
        onChange(loadUserPresets());
        close();
        setMissing(true);
        return;
      }
      setError(result.reason);
      return;
    }
    setMissing(false);
    onChange(result.presets, change);
    close();
  };

  /** Save as / Rename; `overwrite` once the user has confirmed a taken name. */
  const submit = (overwrite = false) => {
    const name = draft.trim();
    if (mode === 'saveAs') finish(saveUserPreset(name, currentSettings, { overwrite }), { kind: 'saved', name });
    else if (mode === 'rename' && target) {
      finish(renameUserPreset(target, name, { overwrite }), { kind: 'renamed', from: target, to: name });
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  const overwriteTarget = () => {
    if (target) finish(saveUserPreset(target, currentSettings, { overwrite: true }), { kind: 'saved', name: target });
  };

  return (
    <div className="mt-2 space-y-2" data-eq-user-presets>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" data-eq-user-save-as onClick={() => open('saveAs')} className={button}>
          {t('equalizerSaveAs')}
        </button>
        {targetExists && (
          <>
            <span className="text-xs text-gray-400 truncate max-w-[12rem]" data-eq-user-target title={target!}>
              {target}
            </span>
            <button type="button" data-eq-user-rename onClick={() => open('rename')} className={button}>
              {t('equalizerRename')}
            </button>
            <button type="button" data-eq-user-overwrite onClick={overwriteTarget} className={button}>
              {t('equalizerOverwrite')}
            </button>
            <button type="button" data-eq-user-delete onClick={() => open('delete')} className={button}>
              {t('equalizerDelete')}
            </button>
          </>
        )}
      </div>

      {(mode === 'saveAs' || mode === 'rename') && (
        <div className="space-y-1" data-eq-user-form={mode}>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              data-eq-user-name
              autoFocus
              value={draft}
              maxLength={USER_PRESET_NAME_MAX * 2}
              placeholder={t('equalizerPresetName')}
              aria-label={t('equalizerPresetName')}
              onChange={(e) => {
                setDraft(e.target.value);
                setError(null);
              }}
              onKeyDown={onKeyDown}
              className={`flex-1 min-w-0 px-3 py-1 bg-gray-800 border border-gray-700 rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-green-500${
                compact ? ' min-h-11' : ''
              }`}
            />
            <button type="button" data-eq-user-submit onClick={() => submit()} className={button}>
              {t('common:save')}
            </button>
            <button type="button" data-eq-user-cancel onClick={close} className={button}>
              {t('common:cancel')}
            </button>
          </div>
          {error && error !== 'missing' && (
            <div
              className="flex flex-wrap items-center gap-2 text-xs text-amber-400"
              role="alert"
              data-eq-user-error={error}
            >
              <span>{t(MESSAGE_KEYS[error])}</span>
              {error === 'taken' && (
                <button type="button" data-eq-user-confirm-overwrite onClick={() => submit(true)} className={button}>
                  {t('equalizerOverwrite')}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {missing && (
        <div className="text-xs text-amber-400" role="alert" data-eq-user-error="missing">
          {t('equalizerPresetMissing')}
        </div>
      )}

      {mode === 'delete' && targetExists && (
        <div
          className="flex flex-wrap items-center gap-2 text-sm text-foreground"
          role="alert"
          data-eq-user-confirm-delete
        >
          <span>{t('equalizerDeleteConfirm', { name: target })}</span>
          <button
            type="button"
            data-eq-user-delete-yes
            onClick={() => finish(deleteUserPreset(target!))}
            className={`px-3 py-1 rounded-lg bg-red-700 text-sm text-white hover:bg-red-600 transition-colors${touch}`}
          >
            {t('equalizerDelete')}
          </button>
          <button type="button" data-eq-user-cancel onClick={close} className={button}>
            {t('common:cancel')}
          </button>
        </div>
      )}
    </div>
  );
}
