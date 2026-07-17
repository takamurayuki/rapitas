/**
 * SimpleLogEntry
 *
 * Backward-compatibility re-export shim. The renderer was split into
 * simple-log-entry/ (rows / icons / styles) per COMPONENT_SPLITTING_POLICY;
 * import from './simple-log-entry' in new code.
 */

export { SimpleLogEntry, SimpleLogEntryList, default } from './simple-log-entry';
