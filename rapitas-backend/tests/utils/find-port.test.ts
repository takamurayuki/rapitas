#!/usr/bin/env bun
/**
 * Tests for port detection utility functions.
 * Tests port availability checking and dynamic port finding.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createServer, type Server } from 'net';
import { isPortAvailable, findAvailablePort } from '../../utils/find-port';

describe('Port Detection Utilities', () => {
  let testServers: Server[] = [];

  // Helper to create a server on a specific port for testing
  const occupyPort = (port: number): Promise<Server> => {
    return new Promise((resolve, reject) => {
      const server = createServer();
      server.listen(port, () => {
        testServers.push(server);
        resolve(server);
      });
      server.on('error', reject);
    });
  };

  // Helper to close a server
  const closeServer = (server: Server): Promise<void> => {
    return new Promise((resolve) => {
      server.close(() => resolve());
    });
  };

  afterEach(async () => {
    // Clean up all test servers
    for (const server of testServers) {
      await closeServer(server);
    }
    testServers = [];
  });

  describe('isPortAvailable', () => {
    test('should return true for an available port', async () => {
      // Use a high port number to avoid conflicts
      const port = 45000;
      const available = await isPortAvailable(port);
      expect(available).toBe(true);
    });

    test('should return false for an occupied port', async () => {
      const port = 45001;
      await occupyPort(port);

      const available = await isPortAvailable(port);
      expect(available).toBe(false);
    });

    test('should handle invalid port numbers gracefully', async () => {
      // Port numbers above 65535 are invalid
      const available = await isPortAvailable(70000);
      expect(available).toBe(false);
    });
  });

  describe('findAvailablePort', () => {
    test('should return the starting port if it is available', async () => {
      const startPort = 45100;
      const foundPort = await findAvailablePort(startPort, 5);
      expect(foundPort).toBe(startPort);
    });

    test('should find the next available port when starting port is occupied', async () => {
      const startPort = 45200;
      const expectedPort = startPort + 2;

      // Occupy the starting port and the next one
      await occupyPort(startPort);
      await occupyPort(startPort + 1);

      const foundPort = await findAvailablePort(startPort, 5);
      expect(foundPort).toBe(expectedPort);
    });

    test('should respect the maxTries limit', async () => {
      const startPort = 45300;
      const maxTries = 3;

      // Occupy all ports in the range
      for (let i = 0; i < maxTries; i++) {
        await occupyPort(startPort + i);
      }

      await expect(findAvailablePort(startPort, maxTries)).rejects.toThrow(
        `No available port found after trying ${maxTries} ports starting from ${startPort}`
      );
    });

    test('should use default parameters when not provided', async () => {
      const foundPort = await findAvailablePort();
      expect(foundPort).toBeGreaterThanOrEqual(3001);
      expect(foundPort).toBeLessThan(3011); // default maxTries is 10
    });

    test('should handle edge case with maxTries = 1', async () => {
      const startPort = 45400;
      const foundPort = await findAvailablePort(startPort, 1);
      expect(foundPort).toBe(startPort);
    });

    test('should find port when some ports in range are occupied', async () => {
      const startPort = 45500;

      // Occupy ports 45500, 45502, 45504 (leaving 45501, 45503 available)
      await occupyPort(startPort);
      await occupyPort(startPort + 2);
      await occupyPort(startPort + 4);

      const foundPort = await findAvailablePort(startPort, 10);
      expect(foundPort).toBe(startPort + 1); // Should find 45501
    });
  });
});