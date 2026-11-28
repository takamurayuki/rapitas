/**
 * check-catalog
 *
 * Barrel for the shared mechanical-check catalog (task 1602): the list, the
 * runners the self-verifier adds from it, the failure hints and the pre-save
 * screens.
 */
export * from './catalog';
export { attributeWorkingTree, scanForSecrets } from './presave-scan';
export { runCatalogChecks } from './catalog-checks';
export { attachFailureHints, extractFailureFiles } from './failure-hints';
