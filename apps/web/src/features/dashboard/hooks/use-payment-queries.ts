'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MerchantPaymentDetail, PaymentPage } from '@chainpay/shared';
import { MerchantApiError, merchantRequest } from '../api';
import { rememberVersion } from '../realtime';
import { usePaymentUpdates } from './use-payment-updates';
export function usePaymentQueries(merchant: { id: string }) {
  const client = useQueryClient();
  const scope = ['merchant', merchant.id];
  const versions = useRef(new Map<string, number>());
  const [filter, setFilter] = useState('');
  const [limit, setLimit] = useState(30);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [selected, setSelected] = useState<string | null>(null);
  const queryKey = [...scope, 'list', filter, limit, cursors.at(-1)];
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (filter) params.set('status', filter);
      if (cursors.at(-1)) params.set('cursor', cursors.at(-1)!);
      const page = await merchantRequest<PaymentPage>(`payments?${params}`, {
        signal,
      });
      if (
        page.data.some(
          (row) => row.version < (versions.current.get(row.id) ?? -1),
        )
      )
        throw new Error(
          'A newer payment update is available. Refresh payments to synchronize.',
        );
      for (const row of page.data)
        rememberVersion(versions.current, row.id, row.version);
      return page;
    },
    retry: false,
    staleTime: 0,
    gcTime: 60000,
  });
  const detail = useQuery({
    queryKey: [...scope, 'detail', selected],
    enabled: !!selected,
    queryFn: async ({ signal }) => {
      const row = await merchantRequest<MerchantPaymentDetail>(
        `payments/${selected}`,
        { signal },
      );
      if (row.version < (versions.current.get(row.id) ?? -1))
        throw new Error(
          'A newer payment update is available. Refresh payments to synchronize.',
        );
      rememberVersion(versions.current, row.id, row.version);
      return row;
    },
    retry: false,
    structuralSharing: (old, next) => {
      const previous = old as MerchantPaymentDetail | undefined;
      const current = next as MerchantPaymentDetail;
      return previous && previous.version > current.version
        ? previous
        : current;
    },
  });
  const pending =
    query.data?.data.some((row) => row.status !== 'CONFIRMED') ||
    (detail.data && detail.data.status !== 'CONFIRMED');
  useEffect(() => {
    if (
      [query.error, detail.error].some(
        (error) => error instanceof MerchantApiError && error.status === 401,
      )
    )
      void client.invalidateQueries({ queryKey: ['merchant-session'] });
  }, [client, query.error, detail.error]);
  const updates = usePaymentUpdates(merchant, versions, pending);
  return {
    query,
    detail,
    filter,
    setFilter,
    limit,
    setLimit,
    cursors,
    setCursors,
    selected,
    setSelected,
    ...updates,
  };
}
