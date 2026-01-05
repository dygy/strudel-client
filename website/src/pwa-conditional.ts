// Conditional PWA registration - only loads if PWA is available
if (import.meta.env.MODE !== 'heroku') {
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