import { atom } from 'nanostores';

// Store for the CodeMirror editor instance
export const editorInstanceStore = atom<any>(null);

// Store for pending code that needs to be loaded into the editor
export const pendingCodeStore = atom<string | null>(null);

// Store for the current active code
export const activeCodeStore = atom<string>('');

// Helper functions
export const setEditorInstance = (editor: any) => {
  editorInstanceStore.set(editor);
};

export const getEditorInstance = () => {
  return editorInstanceStore.get();
};

export const setPendingCode = (code: string) => {
  pendingCodeStore.set(code);
};

export const getPendingCode = () => {
  return pendingCodeStore.get();
};

export const clearPendingCode = () => {
  pendingCodeStore.set(null);
};

export const setActiveCode = (code: string) => {
  activeCodeStore.set(code);
};

export const getActiveCode = () => {
  return activeCodeStore.get();
};

// Test function for debugging
export const testCodeMirror = (testCode = 'console.log("test from nano store")') => {
  console.log('Testing CodeMirror with code:', testCode);
  const editor = getEditorInstance();
  if (editor && editor.setCode) {
    editor.setCode(testCode);
    setActiveCode(testCode);
    console.log('CodeMirror setCode called successfully');
  } else {
    console.error('CodeMirror editor or setCode method not available');
  }
};

// Make test function globally available for debugging
if (typeof window !== 'undefined') {
  (window as any).testCodeMirror = testCodeMirror;
}