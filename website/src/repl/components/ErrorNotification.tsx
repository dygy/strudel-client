/**
 * ErrorNotification - Display mixer error notifications
 * 
 * Shows error messages with type-specific styling and dismiss functionality.
 * Automatically dismisses recoverable errors after 5 seconds.
 * 
 * @component
 * @example
 * ```tsx
 * <ErrorNotification errorNotifier={mixer.errorNotifier} />
 * ```
 */

import { useState, useEffect } from 'react';
import cx from '@src/cx';

/**
 * Props for ErrorNotification component
 * 
 * @interface ErrorNotificationProps
 * @property {any} errorNotifier - ErrorNotifier instance from AudioMixer
 */
interface ErrorNotificationProps {
  errorNotifier: any; // ErrorNotifier instance
}

interface ErrorMessage {
  type: string;
  message: string;
  details?: string;
  recoverable: boolean;
  action?: string;
  timestamp: number;
}

export function ErrorNotification({ errorNotifier }: ErrorNotificationProps) {
  const [errors, setErrors] = useState<ErrorMessage[]>([]);

  useEffect(() => {
    if (!errorNotifier || !errorNotifier.addListener) {
      console.warn('ErrorNotification: errorNotifier not available or missing addListener method');
      return;
    }

    const handleError = (error: ErrorMessage) => {
      setErrors(prev => [...prev, { ...error, timestamp: Date.now() }]);

      // Auto-dismiss recoverable errors after 5 seconds
      if (error.recoverable) {
        setTimeout(() => {
          setErrors(prev => prev.filter(e => e.timestamp !== error.timestamp));
        }, 5000);
      }
    };

    errorNotifier.addListener(handleError);

    return () => {
      if (errorNotifier.removeListener) {
        errorNotifier.removeListener(handleError);
      }
    };
  }, [errorNotifier]);

  const dismissError = (timestamp: number) => {
    setErrors(prev => prev.filter(e => e.timestamp !== timestamp));
  };

  if (errors.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2 max-w-md">
      {errors.map((error) => (
        <div
          key={error.timestamp}
          className={cx(
            'p-4 rounded-lg shadow-lg border-l-4 animate-slide-in',
            error.type === 'device-error' && 'bg-red-900/90 border-red-500',
            error.type === 'evaluation-error' && 'bg-orange-900/90 border-orange-500',
            error.type === 'resource-warning' && 'bg-yellow-900/90 border-yellow-500',
            error.type === 'resource-limit' && 'bg-red-900/90 border-red-500',
            !['device-error', 'evaluation-error', 'resource-warning', 'resource-limit'].includes(error.type) &&
              'bg-gray-900/90 border-gray-500'
          )}
        >
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center space-x-2 mb-1">
                <span className="text-lg">
                  {error.type === 'device-error' && '🔌'}
                  {error.type === 'evaluation-error' && '⚠️'}
                  {error.type === 'resource-warning' && '⚡'}
                  {error.type === 'resource-limit' && '🚨'}
                </span>
                <h4 className="font-semibold text-white text-sm">
                  {error.type.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                </h4>
              </div>
              <p className="text-white text-sm mb-1">{error.message}</p>
              {error.details && (
                <p className="text-gray-300 text-xs mb-2">{error.details}</p>
              )}
              {error.action && (
                <p className="text-blue-300 text-xs italic">💡 {error.action}</p>
              )}
            </div>
            <button
              onClick={() => dismissError(error.timestamp)}
              className="ml-4 text-white hover:text-gray-300 transition-colors"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
      <style>{`
        @keyframes slide-in {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        .animate-slide-in {
          animation: slide-in 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}
