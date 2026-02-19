// Global type definitions for rapitas-backend

// Extend HeadersInit for WebSocket
declare global {
  type HeadersInit = Headers | Record<string, string> | string[][];
}

// Suppress type errors for @elysiajs/websocket
declare module '@elysiajs/websocket' {
  export const createValidationError: any;
  export const DEFS: any;
  export const TypedSchema: any;
  export const ElysiaInstance: any;
  export const HookHandler: any;
  export const SCHEMA: any;
}

// Extend Elysia types for missing exports
declare module 'elysia' {
  export const createValidationError: any;
  export const DEFS: any;
  export const TypedSchema: any;
  export const ElysiaInstance: any;
  export const HookHandler: any;
  export const SCHEMA: any;
}

// Extend Elysia internal types
declare module 'elysia/dist/types' {
  export type ExtractPath<T = any> = any;
  export type TypedRoute<T = any> = any;
  export type TypedSchemaToRoute<T = any, U = any> = any;
  export type WithArray<T = any> = any;
  export type ElysiaRoute<T = any> = any;
  export type ElysiaInstance<T = any> = any;
  export type NoReturnHandler<T = any> = any;
  export type TypedRouteToEden<T = any> = any;
  export type AnyTypedSchema = any;
  export type UnwrapSchema<T = any, U = any> = any;
}

export {};