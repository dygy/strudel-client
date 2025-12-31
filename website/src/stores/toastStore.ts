import { atom } from 'nanostores';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

// Global toast store
export const toastsStore = atom<Toast[]>([]);

// Toast ID counter
let toastId = 0;

// Track recent toasts to prevent duplicates
const recentToasts = new Map<string, number>();
const activeToasts = new Set<string>();

// Toast actions
export const toastActions = {
  addToast: (toast: Omit<Toast, 'id'>, customId?: string) => {
    const toastKey = `${toast.type}:${toast.title}`;
    const now = Date.now();
    
    // If a custom ID is provided, use it for more specific deduplication
    const effectiveKey = customId || toastKey;
    
    console.log('ToastStore - addToast called:', {
      effectiveKey,
      customId,
      title: toast.title,
      activeToastsCount: activeToasts.size,
      recentToastsCount: recentToasts.size
    });
    
    // Check for recent duplicates (within 3 seconds)
    const lastToastTime = recentToasts.get(effectiveKey);
    if (lastToastTime && now - lastToastTime < 3000) {
      console.log('ToastStore - blocked duplicate toast within 3 seconds:', effectiveKey);
      return; // Don't add duplicate toast within 3 seconds
    }
    
    // Check for existing active toasts with the same key
    if (activeToasts.has(effectiveKey)) {
      console.log('ToastStore - blocked duplicate active toast:', effectiveKey);
      return; // Don't add duplicate active toast
    }
    
    // Check for existing toasts with the same title and type in current toasts array
    const currentToasts = toastsStore.get();
    const isDuplicate = currentToasts.some(existingToast => 
      existingToast.title === toast.title && 
      existingToast.type === toast.type
    );
    
    if (isDuplicate) {
      console.log('ToastStore - blocked duplicate in current toasts array:', toastKey);
      return; // Don't add duplicate toast
    }

    // Record this toast to prevent rapid duplicates
    recentToasts.set(effectiveKey, now);
    activeToasts.add(effectiveKey);
    
    // Clean up old entries (older than 10 seconds)
    const entriesToDelete: string[] = [];
    recentToasts.forEach((time, key) => {
      if (now - time > 10000) {
        entriesToDelete.push(key);
      }
    });
    entriesToDelete.forEach(key => recentToasts.delete(key));

    const id = customId || `toast-${++toastId}`;
    const newToast: Toast = {
      id,
      ...toast,
      duration: toast.duration ?? 3000, // Default 3 seconds if not provided or undefined
    };
    
    console.log('ToastStore - adding new toast:', { id, title: toast.title, effectiveKey });
    
    // Update the store
    const newToasts = [...currentToasts, newToast];
    // Limit to maximum 5 toasts to prevent overflow
    toastsStore.set(newToasts.slice(-5));
    
    return id;
  },

  removeToast: (id: string) => {
    console.log('ToastStore - removing toast:', id);
    
    const currentToasts = toastsStore.get();
    const toastToRemove = currentToasts.find(t => t.id === id);
    
    if (toastToRemove) {
      // Clean up active toasts tracking
      const toastKey = `${toastToRemove.type}:${toastToRemove.title}`;
      activeToasts.delete(id); // Remove by ID
      activeToasts.delete(toastKey); // Remove by key as well
      console.log('ToastStore - cleaned up active toast tracking for:', { id, toastKey });
    }
    
    // Update the store
    toastsStore.set(currentToasts.filter(toast => toast.id !== id));
  },

  clearAllToasts: () => {
    console.log('ToastStore - clearing all toasts');
    toastsStore.set([]);
    recentToasts.clear(); // Also clear the recent toasts cache
    activeToasts.clear(); // Clear active toasts tracking
  },

  success: (title: string, message?: string, duration?: number, customId?: string) => 
    toastActions.addToast({ type: 'success', title, message, duration }, customId),

  error: (title: string, message?: string, duration?: number, customId?: string) => 
    toastActions.addToast({ type: 'error', title, message, duration }, customId),

  warning: (title: string, message?: string, duration?: number, customId?: string) => 
    toastActions.addToast({ type: 'warning', title, message, duration }, customId),

  info: (title: string, message?: string, duration?: number, customId?: string) => 
    toastActions.addToast({ type: 'info', title, message, duration }, customId),
};