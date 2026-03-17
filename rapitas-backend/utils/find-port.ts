#!/usr/bin/env bun
/**
 * Port Detection Utility
 *
 * Finds the next available port starting from a given port number.
 * Used by the dev script to handle port conflicts automatically.
 */

import { createServer } from 'net';

/**
 * Checks if a port is available for use.
 *
 * @param port - The port number to check
 * @returns Promise<boolean> - True if the port is available, false otherwise
 */
export async function isPortAvailable(port: number): Promise<boolean> {
  // Check for invalid port ranges
  if (port <= 0 || port >= 65536) {
    return false;
  }

  return new Promise((resolve) => {
    const server = createServer();

    server.listen(port, () => {
      server.close(() => {
        resolve(true);
      });
    });

    server.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * Finds the next available port starting from the given port.
 *
 * @param startPort - The starting port number (default: 3001)
 * @param maxTries - Maximum number of ports to try (default: 10)
 * @returns Promise<number> - The first available port number
 * @throws Error if no available port is found within maxTries attempts
 */
export async function findAvailablePort(startPort: number = 3001, maxTries: number = 10): Promise<number> {
  for (let i = 0; i < maxTries; i++) {
    const portToTry = startPort + i;

    if (await isPortAvailable(portToTry)) {
      return portToTry;
    }
  }

  throw new Error(`No available port found after trying ${maxTries} ports starting from ${startPort}`);
}