// Conditional PWA registration - only loads if PWA is available.
// These builds omit the AstroPWA integration, so `virtual:pwa-register` does
// not exist and must not be imported (see astro.config.{static,cloudflare}.mjs).
const PWA_DISABLED_MODES = ['static', 'cloudflare'];

if (!PWA_DISABLED_MODES.includes(import.meta.env.MODE)) {
  try {
    // @ts-ignore
    import('virtual:pwa-register').then(({ registerSW }) => {
      registerSW({
        immediate: true,
        onRegisteredSW(swScriptUrl) {
          // console.log('SW registered: ', swScriptUrl)
        },
        onOfflineReady() {
          // console.log('PWA application ready to work offline')
        },
      });
    }).catch(() => {
      // PWA not available, silently ignore
    });
  } catch {
    // PWA not available, silently ignore
  }
}