/**
 * Header.tsx
 *
 * Backward-compatibility shim. The Header component has been split into smaller
 * sub-components under components/header/. This file re-exports the default so
 * that existing import paths (`@/components/Header`) continue to work unchanged.
 */

export { default } from '../header/header';
