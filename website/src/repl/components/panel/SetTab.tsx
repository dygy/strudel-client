/**
 * The Set tab (spec 022 §2.1–2.3, tech §2.5): the user's sets (new, rename, delete), the open set's
 * items (drag, move up/down, remove, a transition each, "Add track"), and Play set / End set.
 * Signed out: "Sign in to build a set". Not offered in the read-only admin view (Panel.tsx).
 * Logical (start/end) classes only, so it mirrors in Hebrew and Arabic.
 */
import React, { useMemo, useState } from 'react';
import cx from '@src/cx';
import { useTranslation } from '@src/i18n';
import type { SetItem, SetItemTransition, SetList } from '@src/lib/setLists';
import {
  isLengthDisabled,
  TRANSITION_LENGTH_OPTIONS,
  TRANSITION_TYPE_OPTIONS,
  transitionTypeLabelKey,
  type TransitionLength,
  type TransitionType,
} from '../../transitionSettings';
import { useSetPlayerContext, type AddToSetTarget, type SetPlayerContextValue } from '../../sets/useSetPlayer';
import { ConfirmModal } from '../ui/ConfirmModal';
import { itemText, transitionText } from '../set/setLabels';

type T = (key: string, options?: Record<string, unknown>) => string;

const buttonClass =
  'px-2 py-1 text-xs rounded border border-lineHighlight hover:bg-lineHighlight disabled:opacity-40 disabled:cursor-not-allowed';

export function SetTab() {
  const ctx = useSetPlayerContext();
  const { t } = useTranslation('settings');

  if (!ctx || !ctx.signedIn) {
    return (
      <div data-set-tab="" className="h-full p-4 text-foreground">
        <p data-set-signin="" className="text-sm opacity-80">
          {t('setListSignIn')}
        </p>
      </div>
    );
  }
  if (!ctx.enabled) return null;

  const open = ctx.sets.find((set) => set.id === ctx.openSetId) ?? null;
  return (
    <div data-set-tab="" className="h-full overflow-auto p-4 text-foreground">
      {open ? <OpenSet ctx={ctx} set={open} t={t} /> : <SetListView ctx={ctx} t={t} />}
    </div>
  );
}

function SetListView({ ctx, t }: { ctx: SetPlayerContextValue; t: T }) {
  const [error, setError] = useState<string | null>(null);
  const createSet = async () => {
    setError(null);
    const result = await ctx.createSet();
    if ('error' in result) setError(result.error === 'name_taken' ? t('setListNameTaken') : t('setListActionFailed'));
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold grow">{t('setListTitle')}</h3>
        <button type="button" data-set-new="" className={buttonClass} onClick={createSet}>
          {t('setListNew')}
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {ctx.loadFailed && <p className="text-xs text-red-400">{t('setListLoadFailed')}</p>}
      {ctx.loaded && ctx.sets.length === 0 && <p className="text-sm opacity-70">{t('setListEmpty')}</p>}
      <ul className="flex flex-col gap-1">
        {ctx.sets.map((set) => (
          <li key={set.id}>
            <button
              type="button"
              data-set-open={set.id}
              className="w-full text-start px-3 py-2 rounded hover:bg-lineHighlight flex items-center gap-2"
              onClick={() => ctx.setOpenSetId(set.id)}
            >
              <span className="grow truncate">{set.name}</span>
              {ctx.player.setId === set.id && <span className="text-xs text-green-400">{t('setListPlaying')}</span>}
              <span className="text-xs opacity-60">{set.items.length}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OpenSet({ ctx, set, t }: { ctx: SetPlayerContextValue; set: SetList; t: T }) {
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(set.name);
  const [nameError, setNameError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [adding, setAdding] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  // Before Play set: the item the set starts from.
  const [startFrom, setStartFrom] = useState<string | null>(null);
  const playing = ctx.player.setId === set.id;

  const submitRename = async () => {
    const result = await ctx.renameSet(set.id, nameDraft);
    if (result === 'ok') {
      setRenaming(false);
      setNameError(null);
      return;
    }
    setNameError(
      result === 'name_taken'
        ? t('setListNameTaken')
        : result === 'invalid'
          ? t('setListNameInvalid')
          : t('setListActionFailed'),
    );
  };

  const clickItem = (item: SetItem) => {
    if (playing) ctx.selectItem(item.id);
    else setStartFrom(item.id);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" data-set-back="" className={buttonClass} onClick={() => ctx.setOpenSetId(null)}>
          {t('setListAllSets')}
        </button>
        {renaming ? (
          <form
            className="flex items-center gap-2 grow"
            onSubmit={(event) => {
              event.preventDefault();
              void submitRename();
            }}
          >
            <input
              data-set-name-input=""
              aria-label={t('setListRename')}
              className="grow min-w-0 px-2 py-1 text-sm rounded bg-background border border-lineHighlight"
              value={nameDraft}
              maxLength={120}
              autoFocus
              onChange={(event) => setNameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setRenaming(false);
                  setNameDraft(set.name);
                  setNameError(null);
                }
              }}
            />
            <button type="submit" className={buttonClass}>
              {t('setListSave')}
            </button>
          </form>
        ) : (
          <h3 data-set-name="" className="text-sm font-semibold grow truncate">
            {set.name}
          </h3>
        )}
        {!renaming && (
          <button
            type="button"
            data-set-rename=""
            className={buttonClass}
            onClick={() => {
              setNameDraft(set.name);
              setRenaming(true);
            }}
          >
            {t('setListRename')}
          </button>
        )}
        <button type="button" data-set-delete="" className={buttonClass} onClick={() => setConfirmDelete(true)}>
          {t('setListDelete')}
        </button>
      </div>
      {nameError && (
        <p data-set-name-error="" className="text-xs text-red-400">
          {nameError}
        </p>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {playing ? (
          <button type="button" data-set-end="" className={buttonClass} onClick={ctx.endSet}>
            {t('setListEnd')}
          </button>
        ) : (
          <button
            type="button"
            data-set-play=""
            className={cx(buttonClass, 'border-green-600')}
            disabled={set.items.length === 0}
            onClick={() => ctx.playSet(set.id, startFrom)}
          >
            {t('setListPlay')}
          </button>
        )}
        <button type="button" data-set-add-track="" className={buttonClass} onClick={() => setAdding((v) => !v)}>
          {t('setListAddTrack')}
        </button>
      </div>

      {adding && <AddTrackSearch ctx={ctx} t={t} onAdd={(target) => ctx.addItem(set.id, target)} />}

      {set.items.length === 0 ? (
        <p className="text-sm opacity-70">{t('setListNoItems')}</p>
      ) : (
        <ol data-set-items="" className="flex flex-col gap-1">
          {set.items.map((item, index) => {
            const text = itemText(item, ctx.tracks);
            const isNow = playing && ctx.player.nowItemId === item.id;
            const isNext = playing && ctx.player.nextItemId === item.id;
            const isCued = playing && ctx.player.cuedItemId === item.id;
            return (
              <li
                key={item.id}
                data-set-item={item.id}
                draggable
                onDragStart={(event) => {
                  setDragFrom(index);
                  event.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(event) => {
                  if (dragFrom !== null) event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragFrom !== null) ctx.moveItem(set.id, dragFrom, index);
                  setDragFrom(null);
                }}
                onDragEnd={() => setDragFrom(null)}
                className={cx(
                  'flex items-center gap-2 px-2 py-1 rounded border border-transparent',
                  isNow && 'border-green-600',
                  (isNext || (!playing && startFrom === item.id)) && 'border-blue-500',
                  dragFrom === index && 'opacity-50',
                )}
              >
                <span className="text-xs opacity-50 w-5 text-end shrink-0">{index + 1}</span>
                <button
                  type="button"
                  data-set-item-select=""
                  className="grow min-w-0 text-start truncate"
                  onClick={() => clickItem(item)}
                >
                  {text ?? <span className="opacity-60">—</span>}
                  {text === null && (
                    <span data-set-missing="" className="ms-2 text-xs px-1 rounded bg-red-900/50 text-red-300">
                      {t('setListMissing')}
                    </span>
                  )}
                  {isNow && <span className="ms-2 text-xs text-green-400">{t('setListNow')}</span>}
                  {isCued ? (
                    <span className="ms-2 text-xs text-blue-400">{t('setListCued')}</span>
                  ) : (
                    isNext && <span className="ms-2 text-xs text-blue-400">{t('setListUpNext')}</span>
                  )}
                </button>
                <TransitionChoice
                  t={t}
                  value={item.transition}
                  onChange={(transition) => ctx.setItemTransition(set.id, item.id, transition)}
                />
                <button
                  type="button"
                  data-set-move-up=""
                  aria-label={t('setListMoveUp')}
                  title={t('setListMoveUp')}
                  className={buttonClass}
                  disabled={index === 0}
                  onClick={() => ctx.moveItem(set.id, index, index - 1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  data-set-move-down=""
                  aria-label={t('setListMoveDown')}
                  title={t('setListMoveDown')}
                  className={buttonClass}
                  disabled={index === set.items.length - 1}
                  onClick={() => ctx.moveItem(set.id, index, index + 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  data-set-remove=""
                  aria-label={t('setListRemove')}
                  title={t('setListRemove')}
                  className={buttonClass}
                  onClick={() => ctx.removeItem(set.id, item.id)}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ol>
      )}

      <ConfirmModal
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          if (playing) ctx.endSet();
          void ctx.deleteSet(set.id);
        }}
        title={t('setListDelete')}
        message={t('setListDeleteConfirm', { name: set.name })}
        confirmText={t('setListDeleteConfirmButton')}
        cancelText={t('setListCancel')}
      />
    </div>
  );
}

/** Default, or a type with a length (spec 2.2). Snap, glide and match loudness stay global. */
function TransitionChoice({
  t,
  value,
  onChange,
}: {
  t: T;
  value: SetItemTransition | null;
  onChange: (transition: SetItemTransition | null) => void;
}) {
  return (
    <span className="flex items-center gap-1 shrink-0" title={transitionText(t, value)}>
      <select
        data-set-transition-type=""
        aria-label={t('setListTransition')}
        className="text-xs bg-background border border-lineHighlight rounded px-1 py-0.5"
        value={value?.type ?? 'default'}
        onChange={(event) => {
          const type = event.target.value;
          if (type === 'default') onChange(null);
          else onChange({ type: type as TransitionType, length: value?.length ?? 4 });
        }}
      >
        <option value="default">{t('setListTransitionDefault')}</option>
        {TRANSITION_TYPE_OPTIONS.map((type) => (
          <option key={type} value={type}>
            {t(transitionTypeLabelKey(type))}
          </option>
        ))}
      </select>
      <select
        data-set-transition-length=""
        aria-label={t('setListLength')}
        className="text-xs bg-background border border-lineHighlight rounded px-1 py-0.5 disabled:opacity-40"
        disabled={!value || isLengthDisabled(value.type)}
        value={value?.length ?? 4}
        onChange={(event) => {
          if (value) onChange({ type: value.type, length: Number(event.target.value) as TransitionLength });
        }}
      >
        {TRANSITION_LENGTH_OPTIONS.map((length) => (
          <option key={length} value={length}>
            {length}
          </option>
        ))}
      </select>
    </span>
  );
}

const MAX_MATCHES = 50;

/** "Add track": the user's tracks and multitrack steps, filtered by what is typed. */
function AddTrackSearch({
  ctx,
  t,
  onAdd,
}: {
  ctx: SetPlayerContextValue;
  t: T;
  onAdd: (target: AddToSetTarget) => void;
}) {
  const [query, setQuery] = useState('');
  const entries = useMemo(() => {
    const list: Array<{ key: string; label: string; target: AddToSetTarget }> = [];
    for (const track of Object.values(ctx.tracks)) {
      if (!track) continue;
      list.push({ key: track.id, label: track.name, target: { trackId: track.id } });
      if (track.isMultitrack && track.steps) {
        track.steps.forEach((step, stepIndex) => {
          list.push({
            key: `${track.id}#${stepIndex}`,
            label: `${track.name} · ${step.name ?? ''}`,
            target: { trackId: track.id, stepIndex },
          });
        });
      }
    }
    return list.sort((a, b) => a.label.localeCompare(b.label));
  }, [ctx.tracks]);
  const wanted = query.trim().toLocaleLowerCase();
  const matches = (
    wanted ? entries.filter((entry) => entry.label.toLocaleLowerCase().includes(wanted)) : entries
  ).slice(0, MAX_MATCHES);

  return (
    <div data-set-add-search="" className="flex flex-col gap-1 p-2 rounded border border-lineHighlight">
      <input
        data-set-search-input=""
        aria-label={t('setListSearch')}
        placeholder={t('setListSearch')}
        className="px-2 py-1 text-sm rounded bg-background border border-lineHighlight"
        value={query}
        autoFocus
        onChange={(event) => setQuery(event.target.value)}
      />
      {matches.length === 0 ? (
        <p className="text-xs opacity-70">{t('setListNoMatches')}</p>
      ) : (
        <ul className="max-h-48 overflow-auto flex flex-col">
          {matches.map((entry) => (
            <li key={entry.key}>
              <button
                type="button"
                data-set-add-entry={entry.key}
                className="w-full text-start px-2 py-1 text-sm rounded hover:bg-lineHighlight truncate"
                onClick={() => onAdd(entry.target)}
              >
                {entry.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
