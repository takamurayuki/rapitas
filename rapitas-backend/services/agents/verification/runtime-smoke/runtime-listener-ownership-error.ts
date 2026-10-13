/**
 * runtime-listener-ownership-error
 *
 * Error thrown when a started runtime server's listener is not owned by the
 * launched process tree, carrying the PIDs needed to tell why. It is NOT
 * responsible for the ownership decision itself (ownsRuntimePort() decides).
 */
import type { RuntimeProcessSnapshot } from './runtime-process-snapshot';

/** PID evidence captured when listener ownership could not be confirmed. */
export interface ListenerOwnershipDiagnostics {
  port: number;
  /** PIDs listening on `port`; empty when none or when listeners were not read. */
  listenerPids: number[];
  /** Live PIDs of the process tree this launch owns. */
  ownedPids: number[];
  /** False when the OS snapshot carried no listener table at all. */
  listenersKnown: boolean;
}

export class ListenerOwnershipError extends Error {
  readonly diagnostics: ListenerOwnershipDiagnostics;

  // The message is fixed on purpose: the log-health signature (K-12548) and its
  // suppression rule match on it, so detail goes into `diagnostics` instead.
  constructor(diagnostics: ListenerOwnershipDiagnostics) {
    super('Listener ownership is unconfirmed');
    this.name = 'ListenerOwnershipError';
    this.diagnostics = diagnostics;
  }
}

/**
 * Builds the diagnostics for a failed ownership check.
 *
 * @param snapshot - OS snapshot taken after the server became healthy / 起動後のOSスナップショット
 * @param ownedPids - live PIDs of the owned tree / 所有ツリーの生存PID
 * @param port - port allocated to the launch / 割り当てたポート
 * @returns diagnostics for ListenerOwnershipError / 診断情報
 */
export function describeListenerOwnership(
  snapshot: RuntimeProcessSnapshot,
  ownedPids: number[],
  port: number,
): ListenerOwnershipDiagnostics {
  return {
    port,
    listenerPids: (snapshot.listeners ?? [])
      .filter((listener) => listener.port === port)
      .map((listener) => listener.pid),
    ownedPids,
    listenersKnown: snapshot.listeners !== undefined,
  };
}
