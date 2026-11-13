/**
 * "Add to set" with no set open (spec 022 §2.2): which set to add the track to, or a new one.
 * The chosen set opens in the Set tab.
 */
import { useState } from 'react';
import { useTranslation } from '@src/i18n';
import { useSetPlayerContext } from '../../sets/useSetPlayer';
import { Modal } from '../ui/Modal';

export function AddToSetChooser() {
  const ctx = useSetPlayerContext();
  const { t } = useTranslation('settings');
  const [error, setError] = useState<string | null>(null);
  if (!ctx || !ctx.enabled || !ctx.chooserTarget) return null;
  const target = ctx.chooserTarget;

  const addTo = (setId: string) => {
    ctx.addItem(setId, target);
    ctx.setOpenSetId(setId);
    ctx.closeChooser();
  };

  return (
    <Modal isOpen onClose={ctx.closeChooser} title={t('setListChooserTitle')} size="sm">
      <div data-set-chooser="" className="flex flex-col gap-1">
        {ctx.sets.map((set) => (
          <button
            key={set.id}
            type="button"
            data-set-chooser-set={set.id}
            className="w-full text-start px-3 py-2 rounded hover:bg-lineHighlight"
            onClick={() => addTo(set.id)}
          >
            {set.name}
          </button>
        ))}
        <button
          type="button"
          data-set-chooser-new=""
          className="w-full text-start px-3 py-2 rounded hover:bg-lineHighlight font-semibold"
          onClick={async () => {
            setError(null);
            const result = await ctx.createSet();
            if ('set' in result) addTo(result.set.id);
            else setError(result.error === 'name_taken' ? t('setListNameTaken') : t('setListActionFailed'));
          }}
        >
          {t('setListNew')}
        </button>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </Modal>
  );
}
