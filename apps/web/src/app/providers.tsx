'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { baseSepolia, berachain } from 'viem/chains';
import { createConfig, http, WagmiProvider } from 'wagmi';
import { injected } from 'wagmi/connectors';
function makeConfig() {
  return createConfig({
    chains: [baseSepolia, berachain],
    connectors: [injected()],
    multiInjectedProviderDiscovery: false,
    ssr: true,
    transports: { [baseSepolia.id]: http(), [berachain.id]: http() },
  });
}

export function Providers({ children }: { children: ReactNode }) {
  const [config] = useState(makeConfig);
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
