// Bun test module type definitions
declare module 'bun:test' {
  export function describe(name: string, fn: () => void | Promise<void>): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
  export function beforeAll(fn: () => void | Promise<void>): void;
  export function afterAll(fn: () => void | Promise<void>): void;

  export interface Mock<T extends (...args: any[]) => any = (...args: any[]) => any> {
    (...args: Parameters<T>): ReturnType<T>;
    mock: {
      calls: Array<Parameters<T>>;
      results: Array<{ type: 'return' | 'throw'; value: ReturnType<T> | Error }>;
    };
    mockClear(): void;
    mockReset(): this;
    mockReturnValue(value: ReturnType<T>): this;
    mockImplementation(fn: T): this;
  }

  export function mock<T extends (...args: any[]) => any>(fn: T): Mock<T>;

  export namespace mock {
    function module(moduleName: string, factory: () => Record<string, any>): void;
    function restore(): void;
  }

  interface Matchers<T> {
    toBe(expected: T): void;
    toEqual(expected: T): void;
    toBeDefined(): void;
    toBeUndefined(): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toBeNull(): void;
    toBeGreaterThan(expected: number): void;
    toBeLessThan(expected: number): void;
    toBeGreaterThanOrEqual(expected: number): void;
    toBeLessThanOrEqual(expected: number): void;
    toHaveLength(expected: number): void;
    toHaveProperty(propertyName: string, value?: any): void;
    toHaveBeenCalled(): void;
    toHaveBeenCalledWith(...args: any[]): void;
    toHaveBeenCalledTimes(expected: number): void;
    toContain(item: any): void;
    toMatch(pattern: string | RegExp): void;
    toBeInstanceOf(expected: any): void;
    toThrow(expected?: string | RegExp | Error): void;
    not: Matchers<T>;
  }

  export function expect<T>(actual: T): Matchers<T>;
}
