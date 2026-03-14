'use client';

import { Suspense } from 'react';
import SearchClient from './SearchClient';

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-3xl mx-auto p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-12 bg-zinc-200 dark:bg-zinc-700 rounded-lg" />
            <div className="flex gap-2">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-8 w-20 bg-zinc-200 dark:bg-zinc-700 rounded"
                />
              ))}
            </div>
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-24 bg-zinc-200 dark:bg-zinc-700 rounded-lg"
              />
            ))}
          </div>
        </div>
      }
    >
      <SearchClient />
    </Suspense>
  );
}
