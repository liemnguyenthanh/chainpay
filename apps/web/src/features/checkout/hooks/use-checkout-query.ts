'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getCheckout } from '../api';
import type { CheckoutSnapshot } from '../contracts';
export function useCheckoutQuery(token: string) {
  const client = useQueryClient();
  const polls = useRef(0);
  const [pollingPaused, setPollingPaused] = useState(false);
  const queryKey = ['checkout', token];
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      polls.current += 1;
      if (polls.current >= 60) setPollingPaused(true);
      return getCheckout(token);
    },
    structuralSharing: (oldData, newData) => {
      const oldSnapshot = oldData as CheckoutSnapshot | undefined;
      const next = newData as CheckoutSnapshot;
      return oldSnapshot &&
        (oldSnapshot.version > next.version ||
          oldSnapshot.status === 'CONFIRMED')
        ? oldSnapshot
        : next;
    },
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: (current) =>
      polls.current < 60 &&
      current.state.data?.status !== 'CONFIRMED' &&
      current.state.data?.attempt?.status !== 'NEEDS_REVIEW'
        ? 5000
        : false,
    refetchIntervalInBackground: false,
  });
  useEffect(() => {
    const refresh = () => {
      if (polls.current < 60)
        void client.invalidateQueries({ queryKey: ['checkout', token] });
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [client, token]);
  async function refresh() {
    polls.current = 0;
    setPollingPaused(false);
    const latest = await getCheckout(token);
    client.setQueryData(queryKey, latest);
    return client.getQueryData<CheckoutSnapshot>(queryKey) ?? latest;
  }
  return { query, pollingPaused, refresh };
}
