import { useEAOSStore } from '../store/eaos-store';

/** Push a transient toast + persistent bell notification from anywhere (no hook needed). */
export function notify(type: 'success' | 'error' | 'warning' | 'info', title: string, message = ''): void {
  useEAOSStore.getState().addNotification({
    id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    title,
    message,
    timestamp: new Date(),
    read: false,
  });
}
