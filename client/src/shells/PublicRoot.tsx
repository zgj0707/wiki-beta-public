import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { ThemeProvider } from 'next-themes';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Toaster } from '@client/src/components/ui/sonner';
import { THEME_STORAGE_KEY } from '@client/src/lib/theme';
import { queryClient } from '@client/src/query/query-client';
import { publicCachePersistOptions } from '@client/src/query/persist-public-cache';

/** Public shell. Platform authentication and admin runtime stay below the route boundary. */
export default function PublicRoot({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey={THEME_STORAGE_KEY}
      disableTransitionOnChange
    >
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={publicCachePersistOptions}
      >
        {children}
      </PersistQueryClientProvider>
      {createPortal(<Toaster />, document.body)}
    </ThemeProvider>
  );
}
