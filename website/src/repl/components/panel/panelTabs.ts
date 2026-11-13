/**
 * The panel's tabs: keys route to the tab content, values are the translated labels.
 * The Set tab (spec 022) is not offered in the read-only admin view: an admin never sees anyone's sets.
 */
export function getTabNames(
  t: (key: string) => string,
  { readOnly = false, tauri = false }: { readOnly?: boolean; tauri?: boolean } = {},
): Record<string, string> {
  const tabs: Record<string, string> = {
    welcome: t('welcome'),
    patterns: t('patterns'),
    ...(readOnly ? {} : { set: t('set') }),
    sounds: t('sounds'),
    reference: t('reference'),
    shortcuts: t('shortcuts'),
    console: t('console'),
    settings: t('settings'),
  };

  if (tauri) {
    tabs.files = t('files');
  }

  return tabs;
}
