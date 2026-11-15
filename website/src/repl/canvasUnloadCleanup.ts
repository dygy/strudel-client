/**
 * The canvas cleanup when the page really goes away (spec 030 review #1).
 *
 * It used to run on `beforeunload`, which also fires when the user then answers "Stay" to the
 * browser's "Leave site?" (the close-tab guard asks it whenever music plays). On "Stay" the music
 * kept going while the draw loop was cancelled and Hydra, the pianoroll and the scope were cleared.
 * `pagehide` fires only when the page is actually unloaded (or put in the back/forward cache).
 */
export function installCanvasUnloadCleanup(cleanup: () => Promise<void> | void, win: Window = window): () => void {
  const onPageHide = () => {
    try {
      void Promise.resolve(cleanup()).catch((error: unknown) => {
        console.warn('[canvas-cleanup] Error during page-exit cleanup:', error);
      });
    } catch (error: unknown) {
      console.warn('[canvas-cleanup] Error during page-exit cleanup:', error);
    }
  };
  win.addEventListener('pagehide', onPageHide);
  return () => win.removeEventListener('pagehide', onPageHide);
}
