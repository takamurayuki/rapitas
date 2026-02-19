declare module "@elysiajs/websocket" {
  import type { Elysia } from "elysia";
  import type { ServerWebSocket } from "bun";

  export interface ElysiaWS<T = any> extends ServerWebSocket<T> {
    id?: string;
    data: any;
    publish(topic: string, data: string | Bun.BufferSource): number;
    send(data: string | Bun.BufferSource, compress?: boolean): number;
    close(code?: number, reason?: string): void;
    subscribe(topic: string): void;
    unsubscribe(topic: string): void;
  }

  export interface ElysiaWSContext<T = any> {
    body: any;
    query: Record<string, string>;
    params: Record<string, string>;
    headers: Record<string, string | undefined>;
    cookie: Record<string, any>;
    server: any;
    redirect: (url: string, status?: number) => Response;
    set: {
      headers: any;
      status?: any;
    };
    path: string;
    request: Request;
    store: any;
    decorators: any;
    error: (code: number, message?: string) => Response;
    status: any;
  }

  export interface WSTypedSchema<Path extends string> {
    body?: any;
    query?: any;
    params?: any;
    headers?: any;
    response?: any;
  }

  export interface WebSocketHandler<T = any> {
    open?: (ws: ElysiaWS<T>) => void | Promise<void>;
    message?: (
      ws: ElysiaWS<T>,
      message: string | ArrayBuffer,
    ) => void | Promise<void>;
    close?: (
      ws: ElysiaWS<T>,
      code: number,
      reason: string,
    ) => void | Promise<void>;
    drain?: (ws: ElysiaWS<T>) => void | Promise<void>;
    error?: (ws: ElysiaWS<T>, error: Error) => void | Promise<void>;
  }

  export interface ElysiaWSRoute<T = any> {
    path: string;
    handler: WebSocketHandler<T>;
  }

  // 主要なエクスポートは、互換性のためにいくつかの型を省略
  export const createValidationError: any;
  export const DEFS: any;
  export const TypedSchema: any;
  export const ElysiaInstance: any;
  export const HookHandler: any;
  export const SCHEMA: any;

  export function websocket<T extends Elysia = Elysia>(config?: {
    idleTimeout?: number;
    maxPayloadLength?: number;
    compression?: boolean;
    perMessageDeflate?: boolean;
  }): (app: T) => T;

  export default websocket;
}
