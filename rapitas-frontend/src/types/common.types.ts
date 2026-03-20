/**
 * common.types
 *
 * Shared primitive type definitions used across multiple domain modules.
 * No domain logic or cross-module imports; safe to import from any other types file.
 */

export type Priority = 'low' | 'medium' | 'high' | 'urgent';

export type Status = 'todo' | 'in-progress' | 'done';
