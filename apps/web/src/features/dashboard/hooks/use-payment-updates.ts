'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { acceptPaymentEvent } from '../realtime';
import { apiUrl } from '../../api-origin';
export function usePaymentUpdates(
  merchant: { id: string },
  versions: RefObject<Map<string, number>>,
  pending: boolean | undefined,
) {
  const client = useQueryClient();
  const pollBudget = useRef(60);
  const [pollPaused, setPollPaused] = useState(false);
  const [streamState, setStreamState] = useState('Connecting');
  useEffect(() => {
    const refreshQuery = async (queryKey: string[]) => {
      // Cancel initial requests too: an event can add a row absent from an older
      // empty response. Default invalidation alone deduplicates that first fetch.
      await client.cancelQueries({ queryKey });
      await client.invalidateQueries({ queryKey });
    };
    const refresh = () => {
      void refreshQuery(['merchant', merchant.id]);
      void client.invalidateQueries({ queryKey: ['merchant-session'] });
    };
    let stream: EventSource;
    let reconnectTimer: number | undefined;
    let failures = 0;
    let stopped = false;
    const connect = () => {
      if (stopped) return;
      stream = new EventSource(apiUrl('merchant/events'), {
        withCredentials: true,
      });
      stream.addEventListener('ready', () => {
        failures = 0;
        setStreamState('Live');
        refresh();
      });
      stream.addEventListener('payment', (message: MessageEvent<string>) => {
        const event = acceptPaymentEvent(message.data, versions.current);
        if (!event) return;
        // A changed row can enter or leave any visible filter.
        void refreshQuery(['merchant', merchant.id, 'list']);
        void refreshQuery(['merchant', merchant.id, 'detail', event.paymentId]);
      });
      stream.onerror = () => {
        stream.close();
        setStreamState('Reconnecting');
        void client.invalidateQueries({ queryKey: ['merchant-session'] });
        // Non-200 responses can permanently close native EventSource. Explicit
        // bounded backoff also recovers after Redis/API outages, without reload.
        window.clearTimeout(reconnectTimer);
        reconnectTimer = window.setTimeout(
          connect,
          Math.min(30000, 1000 * 2 ** Math.min(failures++, 5)),
        );
      };
    };
    connect();
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    return () => {
      stopped = true;
      window.clearTimeout(reconnectTimer);
      stream.close();
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [client, merchant.id, versions]);
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => {
      if (
        document.visibilityState !== 'visible' ||
        !navigator.onLine ||
        pollBudget.current <= 0
      )
        return;
      // Each active HTTP query consumes a request, not merely a timer tick.
      const keys = client
        .getQueryCache()
        .findAll({ queryKey: ['merchant', merchant.id], type: 'active' });
      for (const query of keys) {
        if (pollBudget.current <= 0) break;
        if (query.state.fetchStatus !== 'idle') continue;
        pollBudget.current -= 1;
        void client.invalidateQueries({
          queryKey: query.queryKey,
          exact: true,
        });
      }
      if (pollBudget.current <= 0) setPollPaused(true);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [client, merchant.id, pending]);
  return {
    pollPaused,
    streamState,
    refreshPayments() {
      pollBudget.current = 60;
      setPollPaused(false);
      void client.invalidateQueries({ queryKey: ['merchant', merchant.id] });
    },
  };
}
