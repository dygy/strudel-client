import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@nanostores/react';
import { CheckCircleIcon, ExclamationCircleIcon, InformationCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';
import { toastsStore, toastActions, type Toast, type ToastType } from '../stores/toastStore';

interface ToastItemProps {
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

function ToastItem({ toast, onRemove }: ToastItemProps) {
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

export function GlobalToastContainer() {
  const toasts = useStore(toastsStore);

  if (toasts.length === 0) return null;

  return createPortal(
    <div className="fixed bottom-8 right-4 z-[10001] space-y-2 pointer-events-none">
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastItem toast={toast} onRemove={toastActions.removeToast} />
        </div>
      ))}
    </div>,
    document.body
  );
}