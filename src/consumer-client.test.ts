import { describe, it, expect, beforeEach, vi, afterEach, afterAll } from 'vitest';
import { createConsumerAuthClient } from './consumer-client';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { ConsumerAuthState, OpenGameLink } from './types';

describe('Consumer Auth Client', () => {
  // Mock server setup
  const server = setupServer(
    // GET /opengame-link
    http.get('http://localhost/opengame-link', () => {
      return HttpResponse.json({
        isLinked: true,
        openGameUserId: 'og-user-123',
        linkedAt: '2023-01-01T00:00:00Z',
        profile: {
          displayName: 'OpenGame User',
          avatarUrl: 'https://example.com/avatar.png'
        }
      });
    }),
    
    // POST /verify-link-token
    http.post('http://localhost/verify-link-token', () => {
      return HttpResponse.json({
        valid: true,
        openGameUserId: 'og-user-123',
        email: 'user@opengame.com'
      });
    }),
    
    // POST /verify-link-token (invalid)
    http.post('http://localhost/verify-link-token', ({ request }) => {
      const url = new URL(request.url);
      const searchParams = new URLSearchParams(url.search);
      if (searchParams.get('token') === 'invalid-token') {
        return HttpResponse.json({
          valid: false
        });
      }
      return HttpResponse.json({
        valid: true,
        openGameUserId: 'og-user-123',
        email: 'user@opengame.com'
      });
    }),
    
    // POST /confirm-link
    http.post('http://localhost/confirm-link', () => {
      return HttpResponse.json({
        success: true
      });
    })
  );
  
  beforeEach(() => {
    server.listen();
  });
  
  afterEach(() => {
    server.resetHandlers();
  });
  
  afterAll(() => {
    server.close();
  });
  
  it('should initialize with default state', () => {
    const client = createConsumerAuthClient({
      host: 'http://localhost',
      userId: 'test-user',
      sessionToken: 'test-token'
    });
    
    expect(client.getState().userId).toBe('test-user');
    expect(client.getState().sessionToken).toBe('test-token');
    expect(client.getState().openGameLink).toBeUndefined();
  });
  
  it('should fetch OpenGame link status', async () => {
    const client = createConsumerAuthClient({
      host: 'http://localhost',
      userId: 'test-user',
      sessionToken: 'test-token'
    });
    
    const status = await client.getOpenGameLinkStatus();
    
    // Type guard to check if isLinked is true
    expect(status.isLinked).toBe(true);
    
    if (status.isLinked) {
      expect(status.openGameUserId).toBe('og-user-123');
      expect(status.profile?.displayName).toBe('OpenGame User');
      expect(client.getState().openGameLink?.openGameUserId).toBe('og-user-123');
    }
  });
  
  it('should verify a link token', async () => {
    const client = createConsumerAuthClient({
      host: 'http://localhost',
      userId: 'test-user',
      sessionToken: 'test-token'
    });
    
    const result = await client.verifyLinkToken('test-token');
    
    // Type guard to check if valid is true
    expect(result.valid).toBe(true);
    
    if (result.valid) {
      expect(result.openGameUserId).toBe('og-user-123');
      expect(result.email).toBe('user@opengame.com');
    }
  });
  
  it('should handle invalid link tokens', async () => {
    // Mock server to return invalid token response
    server.use(
      http.post('http://localhost/verify-link-token', () => {
        return HttpResponse.json({
          valid: false
        });
      })
    );
    
    const client = createConsumerAuthClient({
      host: 'http://localhost',
      userId: 'test-user',
      sessionToken: 'test-token'
    });
    
    const result = await client.verifyLinkToken('invalid-token');
    
    expect(result.valid).toBe(false);
  });
  
  it('should confirm a link between accounts', async () => {
    // Mock server to return success
    server.use(
      http.post('http://localhost/confirm-link', () => {
        return HttpResponse.json({
          success: true,
          openGameUserId: 'og-user-123'
        }, { status: 200 });
      })
    );
    
    const client = createConsumerAuthClient({
      host: 'http://localhost',
      userId: 'test-user',
      sessionToken: 'test-token'
    });
    
    const success = await client.confirmLink('test-token', 'game-user-123');
    
    expect(success).toBe(true);
    expect(client.getState().openGameLink).toBeDefined();
    expect(client.getState().openGameLink?.openGameUserId).toBe('og-user-123');
  });
  
  it('should handle errors when confirming links', async () => {
    // Mock server to return error
    server.use(
      http.post('http://localhost/confirm-link', () => {
        throw new Error('Network error');
      })
    );
    
    const client = createConsumerAuthClient({
      host: 'http://localhost',
      userId: 'test-user',
      sessionToken: 'test-token'
    });
    
    await expect(client.confirmLink('invalid-token', 'game-user-123')).rejects.toThrow();
    expect(client.getState().openGameLink).toBeUndefined();
  });
}); 