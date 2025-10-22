import useEvent from '@src/useEvent';
import { logger } from '@strudel/core';
import { nanoid } from 'nanoid';
import { atom } from 'nanostores';

interface LogEntry {
  message: string;
  type: string;
  id: string;
  count?: number;
  data?: {
    url?: string;
    hap?: {
      value?: {
        color?: string;
      };
    };
  };
}

interface LogEvent {
  detail: {
    message: string;
    type: string;
    data?: LogEntry['data'];
  };
}

export const $strudel_log_history = atom<LogEntry[]>([]);

function useLoggerEvent(onTrigger: (event: LogEvent) => void) {
  useEvent(logger.key, onTrigger);
}

function getUpdatedLog(log: LogEntry[], event: LogEvent): LogEntry[] {
  const { message, type, data } = event.detail;
  const lastLog = log.length ? log[log.length - 1] : undefined;
  const id = nanoid(12);
  
  if (type === 'loaded-sample') {
    const loadIndex = log.findIndex(({ data: logData, type: logType }) => 
      logType === 'load-sample' && logData?.url === data?.url
    );
    if (loadIndex !== -1) {
      log[loadIndex] = { message, type, id, data };
    }
  } else if (lastLog && lastLog.message === message) {
    log = log.slice(0, -1).concat([{ message, type, count: (lastLog.count ?? 1) + 1, id, data }]);
  } else {
    log = log.concat([{ message, type, id, data }]);
  }
  
  return log.slice(-20);
}

export function useLogger() {
  useLoggerEvent((event: LogEvent) => {
    const log = $strudel_log_history.get();
    const newLog = getUpdatedLog(log, event);
    $strudel_log_history.set(newLog);
  });
}