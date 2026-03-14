// Global type definitions for rapitas-backend

// Extend HeadersInit for WebSocket
declare global {
  type HeadersInit = Headers | Record<string, string> | string[][];
}

// Suppress type errors for @elysiajs/websocket
// Note: These any types are required due to Elysia framework constraints
declare module '@elysiajs/websocket' {
  export const createValidationError: any; // Elysia framework constraint
  export const DEFS: any; // Elysia framework constraint
  export const TypedSchema: any; // Elysia framework constraint
  export const ElysiaInstance: any; // Elysia framework constraint
  export const HookHandler: any; // Elysia framework constraint
  export const SCHEMA: any; // Elysia framework constraint
}

// Extend Elysia types for missing exports
// Note: These any types are required due to Elysia framework constraints
declare module 'elysia' {
  export const createValidationError: any; // Elysia framework constraint
  export const DEFS: any; // Elysia framework constraint
  export const TypedSchema: any; // Elysia framework constraint
  export const ElysiaInstance: any; // Elysia framework constraint
  export const HookHandler: any; // Elysia framework constraint
  export const SCHEMA: any; // Elysia framework constraint
}

// Extend Elysia internal types
// Note: These any types are required due to Elysia framework internal type constraints
declare module 'elysia/dist/types' {
  export type ExtractPath<T = any> = any; // Elysia internal constraint
  export type TypedRoute<T = any> = any; // Elysia internal constraint
  export type TypedSchemaToRoute<T = any, U = any> = any; // Elysia internal constraint
  export type WithArray<T = any> = any; // Elysia internal constraint
  export type ElysiaRoute<T = any> = any; // Elysia internal constraint
  export type ElysiaInstance<T = any> = any; // Elysia internal constraint
  export type NoReturnHandler<T = any> = any; // Elysia internal constraint
  export type TypedRouteToEden<T = any> = any; // Elysia internal constraint
  export type AnyTypedSchema = any; // Elysia internal constraint - used for schema definitions
  export type UnwrapSchema<T = any, U = any> = any; // Elysia internal constraint
}

export {};
