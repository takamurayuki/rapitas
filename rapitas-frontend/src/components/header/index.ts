/**
 * header/index.ts
 *
 * Barrel re-export for the Header component family.
 * Consumers that previously imported from '@/components/Header' continue to work
 * when they instead import from '@/components/header' (Next.js resolves index.ts).
 */

export { default } from './header';
export { default as Header } from './header';
