import React, { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { CheckCircleIcon, ExclamationTriangleIcon, ArrowPathIcon } from '@heroicons/react/24/outline';

interface SessionStatusProps {
  className?: string;
  showOnlyWhenIssues?: boolean;
}

export function SessionStatus({ className = '', showOnlyWhenIssues = false }: SessionStatusProps) {
  const { user, isAuthenticated } = useAuth();
  const [sessionStatus, setSessionStatus] = useState<'healthy' | 'checking' | 'warning' | 'error'>('healthy');
  const [lastCheck, setLastCheck] = useState<Date | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      setSessionStatus('error');
      return;
    }

    let statusInterval: NodeJS.Timeout | null = null;

    const checkSessionStatus = async () => {
      setSessionStatus('checking');
      
      try {
        // Simple health check - just verify we can make an authenticated request
        const response = await fetch('/api/auth/user', {
          credentials: 'include',
        });

        if (response.ok) {
          setSessionStatus('healthy');
          setLastCheck(new Date());
        } else if (response.status === 401) {
          setSessionStatus('error');
        } else {
          setSessionStatus('warning');
        }
      } catch (error) {
        console.error('Session status check failed:', error);
        setSessionStatus('warning');
      }
    };

    // Initial check
    checkSessionStatus();

    // Periodic checks - DISABLED to stop spam
    // statusInterval = setInterval(checkSessionStatus, 120000);

    return () => {
      if (statusInterval) {
        clearInterval(statusInterval);
      }
    };
  }, [isAuthenticated]);

  // Don't show anything if user is not authenticated
  if (!isAuthenticated) {
    return null;
  }

  // Only show when there are issues if showOnlyWhenIssues is true
  if (showOnlyWhenIssues && sessionStatus === 'healthy') {
    return null;
  }

  const getStatusIcon = () => {
    switch (sessionStatus) {
      case 'healthy':
        return <CheckCircleIcon className="w-4 h-4 text-green-500" />;
      case 'checking':
        return <ArrowPathIcon className="w-4 h-4 text-blue-500 animate-spin" />;
      case 'warning':
        return <ExclamationTriangleIcon className="w-4 h-4 text-yellow-500" />;
      case 'error':
        return <ExclamationTriangleIcon className="w-4 h-4 text-red-500" />;
      default:
        return null;
    }
  };

  const getStatusText = () => {
    switch (sessionStatus) {
      case 'healthy':
        return 'Session active';
      case 'checking':
        return 'Checking session...';
      case 'warning':
        return 'Session issues detected';
      case 'error':
        return 'Session expired';
      default:
        return '';
    }
  };

  const getStatusColor = () => {
    switch (sessionStatus) {
      case 'healthy':
        return 'text-green-600';
      case 'checking':
        return 'text-blue-600';
      case 'warning':
        return 'text-yellow-600';
      case 'error':
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  };

  return (
    <div className={`flex items-center gap-2 text-xs ${getStatusColor()} ${className}`}>
      {getStatusIcon()}
      <span>{getStatusText()}</span>
      {lastCheck && sessionStatus === 'healthy' && (
        <span className="text-gray-500">
          ({lastCheck.toLocaleTimeString()})
        </span>
      )}
    </div>
  );
}