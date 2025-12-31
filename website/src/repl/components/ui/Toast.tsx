import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircleIcon, ExclamationCircleIcon, InformationCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastProps {
  toast: Toast;
  onRemove: (id: string) => void;
}

const toastIcons = {
  success: CheckCircleIcon,
  error: XCircleIcon,
  warning: ExclamationCircleIcon,
  info: InformationCircleIcon,
};

const toastStyles = {
  success: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-800 dark:text-green-200',
  error: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200',
  warning: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-200',
  info: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200',
};

const iconStyles = {
  success: 'text-green-400 dark:text-green-300',
  error: 'text-red-400 dark:text-red-300',
  warning: 'text-yellow-400 dark:text-yellow-300',
  info: 'text-blue-400 dark:text-blue-300',
};

function ToastItem({ toast, onRemove }: ToastProps) {
  const duration = toast.duration || 3000; // Ensure we always have a duration
  const [isVisible, setIsVisible] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [timeLeft, setTimeLeft] = useState(duration);
  const [isPaused, setIsPaused] = useState(false);
  const Icon = toastIcons[toast.type];

  const handleRemove = useCallback(() => {
    if (isLeaving) return; // Prevent multiple removal calls
    setIsLeaving(true);
    setTimeout(() => onRemove(toast.id), 300);
  }, [isLeaving, onRemove, toast.id]);

  useEffect(() => {
    // Trigger entrance animation
    const timer = setTimeout(() => setIsVisible(true), 10);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (duration > 0 && !isPaused) {
      // Update countdown every 100ms for smooth progress bar
      const interval = setInterval(() => {
        setTimeLeft(prev => {
          const newTime = prev - 100;
          if (newTime <= 0) {
            clearInterval(interval);
            handleRemove();
            return 0;
          }
          return newTime;
        });
      }, 100);

      return () => clearInterval(interval);
    }
  }, [duration, toast.id, handleRemove, isPaused]);

  const progressPercentage = (timeLeft / duration) * 100;

  return (
    <div
      className={`
        transform transition-all duration-300 ease-in-out mb-2
        ${isVisible && !isLeaving ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}
      `}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <div className={`
        max-w-sm w-full border rounded-lg shadow-lg overflow-hidden relative
        ${toastStyles[toast.type]}
      `}>
        {/* Progress bar */}
        {duration > 0 && (
          <div className="absolute bottom-0 left-0 h-1 bg-black/20 w-full">
            <div 
              className="h-full bg-current transition-all duration-100 ease-linear"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
        )}
        
        <div className="p-4 flex items-start space-x-3">
          <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${iconStyles[toast.type]}`} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">{toast.title}</p>
            {toast.message && (
              <p className="text-sm opacity-90 mt-1">{toast.message}</p>
            )}
          </div>
          <div className="flex items-center space-x-2">
            {/* Countdown display */}
            {duration > 0 && (
              <span className="text-xs opacity-60 font-mono">
                {Math.ceil(timeLeft / 1000)}s
              </span>
            )}
            <button
              onClick={handleRemove}
              className="flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity"
            >
              <XCircleIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Toast container component
interface ToastContainerProps {
  toasts: Toast[];
  onRemove: (id: string) => void;
}

export function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return createPortal(
    <div className="fixed bottom-8 right-4 z-[10001] space-y-2 pointer-events-none">
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastItem toast={toast} onRemove={onRemove} />
        </div>
      ))}
    </div>,
    document.body
  );
}

// Toast manager hook
let toastId = 0;
const recentToasts = new Map<string, number>(); // Track recent toasts to prevent rapid duplicates
const activeToasts = new Set<string>(); // Track currently active toasts

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = (toast: Omit<Toast, 'id'>, customId?: string) => {
    const toastKey = `${toast.type}:${toast.title}`;
    const now = Date.now();
    
    // If a custom ID is provided, use it for more specific deduplication
    const effectiveKey = customId || toastKey;
    
    console.log('Toast - addToast called:', {
      effectiveKey,
      customId,
      title: toast.title,
      activeToasts: Array.from(activeToasts),
      recentToasts: Array.from(recentToasts.entries())
    });
    
    // Check for recent duplicates (within 2 seconds)
    const lastToastTime = recentToasts.get(effectiveKey);
    if (lastToastTime && now - lastToastTime < 2000) {
      console.log('Toast - blocked duplicate toast within 2 seconds:', effectiveKey);
      return; // Don't add duplicate toast within 2 seconds
    }
    
    // Check for existing active toasts with the same key
    if (activeToasts.has(effectiveKey)) {
      console.log('Toast - blocked duplicate active toast:', effectiveKey);
      return; // Don't add duplicate active toast
    }
    
    // Check for existing toasts with the same title and type in current toasts array
    const isDuplicate = toasts.some(existingToast => 
      existingToast.title === toast.title && 
      existingToast.type === toast.type
    );
    
    if (isDuplicate) {
      console.log('Toast - blocked duplicate in current toasts array:', toastKey);
      return; // Don't add duplicate toast
    }

    // Record this toast to prevent rapid duplicates
    recentToasts.set(effectiveKey, now);
    activeToasts.add(effectiveKey);
    
    // Clean up old entries (older than 10 seconds)
    for (const [key, time] of recentToasts.entries()) {
      if (now - time > 10000) {
        recentToasts.delete(key);
      }
    }

    const id = customId || `toast-${++toastId}`;
    const newToast: Toast = {
      id,
      ...toast,
      duration: toast.duration ?? 3000, // Default 3 seconds if not provided or undefined
    };
    
    console.log('Toast - adding new toast:', { id, title: toast.title, effectiveKey });
    
    setToasts(prev => {
      // Limit to maximum 5 toasts to prevent overflow
      const newToasts = [...prev, newToast];
      return newToasts.slice(-5);
    });
    return id;
  };

  const removeToast = (id: string) => {
    console.log('Toast - removing toast:', id);
    
    setToasts(prev => {
      const toastToRemove = prev.find(t => t.id === id);
      if (toastToRemove) {
        // Clean up active toasts tracking
        const toastKey = `${toastToRemove.type}:${toastToRemove.title}`;
        activeToasts.delete(id); // Remove by ID
        activeToasts.delete(toastKey); // Remove by key as well
        console.log('Toast - cleaned up active toast tracking for:', { id, toastKey });
      }
      
      return prev.filter(toast => toast.id !== id);
    });
  };

  const clearAllToasts = () => {
    console.log('Toast - clearing all toasts');
    setToasts([]);
    recentToasts.clear(); // Also clear the recent toasts cache
    activeToasts.clear(); // Clear active toasts tracking
  };

  const success = (title: string, message?: string, duration?: number, customId?: string) => 
    addToast({ type: 'success', title, message, duration }, customId);

  const error = (title: string, message?: string, duration?: number, customId?: string) => 
    addToast({ type: 'error', title, message, duration }, customId);

  const warning = (title: string, message?: string, duration?: number, customId?: string) => 
    addToast({ type: 'warning', title, message, duration }, customId);

  const info = (title: string, message?: string, duration?: number, customId?: string) => 
    addToast({ type: 'info', title, message, duration }, customId);

  return {
    toasts,
    addToast,
    removeToast,
    clearAllToasts,
    success,
    error,
    warning,
    info,
    ToastContainer: () => <ToastContainer toasts={toasts} onRemove={removeToast} />,
  };
}