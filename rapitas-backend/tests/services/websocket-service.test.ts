/**
 * WebSocket Service テスト
 * WebSocketManagerのルーム管理・メッセージングのテスト
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test';

mock.module('../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

mock.module('../../config', () => ({
  prisma: {
    task: { findUnique: mock(() => Promise.resolve(null)) },
    category: { findUnique: mock(() => Promise.resolve(null)) },
  },
}));

mock.module('./cache-service', () => ({
  cacheService: {
    clear: mock(() => Promise.resolve()),
    get: mock(() => Promise.resolve(null)),
    set: mock(() => Promise.resolve()),
  },
}));

const { wsManager } = await import('../../services/websocket-service');

function createMockWs(readyState: number = 1) {
  return {
    send: mock(() => {}),
    close: mock(() => {}),
    readyState,
  };
}

describe('WebSocketManager', () => {
  beforeEach(() => {
    wsManager.shutdown();
  });

  describe('addClient / removeClient / getClient', () => {
    test('クライアントを追加できること', () => {
      const ws = createMockWs();
      wsManager.addClient('c1', ws);
      expect(wsManager.getClient('c1')).toBeDefined();
    });

    test('クライアントを削除できること', () => {
      const ws = createMockWs();
      wsManager.addClient('c1', ws);
      wsManager.removeClient('c1');
      expect(wsManager.getClient('c1')).toBeUndefined();
    });

    test('メタデータ付きでクライアントを追加できること', () => {
      const ws = createMockWs();
      wsManager.addClient('c1', ws, { userId: 'user1', sessionId: 'sess1' });
      const client = wsManager.getClient('c1');
      expect(client?.metadata?.userId).toBe('user1');
    });
  });

  describe('joinRoom / leaveRoom', () => {
    test('ルームに参加できること', () => {
      const ws = createMockWs();
      wsManager.addClient('c1', ws);
      wsManager.joinRoom('c1', 'room1');
      const client = wsManager.getClient('c1');
      expect(client?.subscriptions.has('room1')).toBe(true);
    });

    test('ルームから退出できること', () => {
      const ws = createMockWs();
      wsManager.addClient('c1', ws);
      wsManager.joinRoom('c1', 'room1');
      wsManager.leaveRoom('c1', 'room1');
      const client = wsManager.getClient('c1');
      expect(client?.subscriptions.has('room1')).toBe(false);
    });

    test('クライアント削除時にルームからも退出すること', () => {
      const ws = createMockWs();
      wsManager.addClient('c1', ws);
      wsManager.joinRoom('c1', 'room1');
      wsManager.removeClient('c1');
      const stats = wsManager.getStats();
      expect(stats.totalRooms).toBe(0);
    });

    test('空になったルームは自動削除されること', () => {
      const ws = createMockWs();
      wsManager.addClient('c1', ws);
      wsManager.joinRoom('c1', 'room1');
      wsManager.leaveRoom('c1', 'room1');
      const stats = wsManager.getStats();
      expect(stats.totalRooms).toBe(0);
    });
  });

  describe('sendToRoom', () => {
    test('ルーム内のクライアントにメッセージを送信すること', () => {
      const ws1 = createMockWs();
      const ws2 = createMockWs();
      wsManager.addClient('c1', ws1);
      wsManager.addClient('c2', ws2);
      wsManager.joinRoom('c1', 'room1');
      wsManager.joinRoom('c2', 'room1');

      wsManager.sendToRoom('room1', { type: 'test' });
      expect(ws1.send).toHaveBeenCalled();
      expect(ws2.send).toHaveBeenCalled();
    });

    test('ルームに参加していないクライアントには送信しないこと', () => {
      const ws1 = createMockWs();
      const ws2 = createMockWs();
      wsManager.addClient('c1', ws1);
      wsManager.addClient('c2', ws2);
      wsManager.joinRoom('c1', 'room1');

      wsManager.sendToRoom('room1', { type: 'test' });
      expect(ws1.send).toHaveBeenCalled();
      expect(ws2.send).not.toHaveBeenCalled();
    });

    test('readyStateがOPENでないクライアントには送信しないこと', () => {
      const ws = createMockWs(3); // CLOSED
      wsManager.addClient('c1', ws);
      wsManager.joinRoom('c1', 'room1');

      wsManager.sendToRoom('room1', { type: 'test' });
      expect(ws.send).not.toHaveBeenCalled();
    });

    test('存在しないルームへの送信は何もしないこと', () => {
      wsManager.sendToRoom('nonexistent', { type: 'test' });
      // no error
    });
  });

  describe('sendToClient', () => {
    test('特定クライアントにメッセージを送信すること', () => {
      const ws = createMockWs();
      wsManager.addClient('c1', ws);
      wsManager.sendToClient('c1', { type: 'test' });
      expect(ws.send).toHaveBeenCalled();
    });

    test('存在しないクライアントには何もしないこと', () => {
      wsManager.sendToClient('nonexistent', { type: 'test' });
      // no error
    });
  });

  describe('broadcast', () => {
    test('全クライアントにブロードキャストすること', () => {
      const ws1 = createMockWs();
      const ws2 = createMockWs();
      wsManager.addClient('c1', ws1);
      wsManager.addClient('c2', ws2);

      wsManager.broadcast({ type: 'test' });
      expect(ws1.send).toHaveBeenCalled();
      expect(ws2.send).toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    test('統計情報を正しく返すこと', () => {
      const ws = createMockWs();
      wsManager.addClient('c1', ws);
      wsManager.joinRoom('c1', 'room1');

      const stats = wsManager.getStats();
      expect(stats.totalClients).toBe(1);
      expect(stats.totalRooms).toBe(1);
      expect(stats.clients.length).toBe(1);
      expect(stats.rooms.length).toBe(1);
      expect(stats.rooms[0].name).toBe('room1');
      expect(stats.rooms[0].clientCount).toBe(1);
    });
  });

  describe('shutdown', () => {
    test('シャットダウンで全クライアントをクローズすること', () => {
      const ws = createMockWs();
      wsManager.addClient('c1', ws);
      wsManager.shutdown();
      expect(ws.send).toHaveBeenCalled(); // shutdown message
      expect(ws.close).toHaveBeenCalled();
      expect(wsManager.getStats().totalClients).toBe(0);
    });
  });
});
