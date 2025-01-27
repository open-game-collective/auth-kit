import { describe, it, expect, beforeEach } from 'vitest';
import { createAuthClient } from './client';
import { http, HttpResponse } from 'msw';
import { server } from './test/setup';

// Setup default handlers
beforeEach(() => {
  server.use(
    // Mock request-code endpoint
    http.post('http://localhost/auth/request-code', () => {
      return HttpResponse.json({
        userId: 'test-user',
        sessionToken: 'test-session',
        refreshToken: 'test-refresh',
      });
    }),

    // Mock verify endpoint
    http.post('http://localhost/auth/verify', () => {
      return HttpResponse.json({
        success: true,
        userId: 'test-user',
        sessionToken: 'test-session',
        refreshToken: 'test-refresh',
      });
    }),

    // Mock refresh endpoint
    http.post('http://localhost/auth/refresh', () => {
      return HttpResponse.json({
        userId: 'test-user',
        sessionToken: 'new-session',
        refreshToken: 'new-refresh',
      });
    }),

    // Mock logout endpoint
    http.post('http://localhost/auth/logout', () => {
      return HttpResponse.json({});
    }),

    // Mock anonymous user creation
    http.post('http://localhost/auth/user', () => {
      return HttpResponse.json({
        userId: 'anon-user',
        sessionToken: 'anon-session',
        refreshToken: 'anon-refresh',
      });
    })
  );
});

describe('AuthClient', () => {
  it('should initialize with correct state', () => {
    const client = createAuthClient({
      baseUrl: 'http://localhost',
      initialState: {
        userId: 'test-user',
        sessionToken: 'test-session',
        refreshToken: 'test-refresh',
        isVerified: false
      }
    });

    const state = client.getState();
    expect(state).toEqual({
      isInitializing: false,
      isLoading: false,
      error: undefined,
      userId: 'test-user',
      sessionToken: 'test-session',
      refreshToken: 'test-refresh',
      isVerified: false,
      baseUrl: 'http://localhost'
    });
  });

  it('should create anonymous user', async () => {
    const client = createAuthClient({
      baseUrl: 'http://localhost'
    });

    const states: any[] = [];
    client.subscribe((state) => states.push(state));

    await client.createAnonymousUser();

    expect(states).toHaveLength(3); // Initial -> Loading -> Success
    expect(states[states.length - 1]).toEqual({
      isInitializing: false,
      isLoading: false,
      error: undefined,
      userId: 'anon-user',
      sessionToken: 'anon-session',
      refreshToken: 'anon-refresh',
      isVerified: false,
      baseUrl: 'http://localhost',
    });
  });

  it('should notify subscribers of state changes', async () => {
    const client = createAuthClient({
      baseUrl: 'http://localhost',
    });

    const states: any[] = [];
    client.subscribe((state) => states.push(state));

    await client.requestCode('test@example.com');

    expect(states).toHaveLength(3); // Initial -> Loading -> Success
    expect(states[states.length - 1]).toEqual({
      isInitializing: false,
      isLoading: false,
      error: undefined,
      userId: 'test-user',
      sessionToken: 'test-session',
      refreshToken: 'test-refresh',
      isVerified: false,
      baseUrl: 'http://localhost',
    });
  });

  it('should handle email verification flow', async () => {
    const client = createAuthClient({
      baseUrl: 'http://localhost',
    });

    // First request the code to get a userId
    await client.requestCode('test@example.com');
    
    // Then verify the email
    const result = await client.verifyEmail('test@example.com', '123456');

    expect(result).toEqual({ success: true });
    expect(client.getState()).toEqual({
      isInitializing: false,
      isLoading: false,
      error: undefined,
      userId: 'test-user',
      sessionToken: 'test-session',
      refreshToken: 'test-refresh',
      isVerified: true,
      baseUrl: 'http://localhost',
    });
  });

  it('should handle logout by creating new anonymous user', async () => {
    const client = createAuthClient({
      baseUrl: 'http://localhost',
      initialState: {
        userId: 'test-user',
        sessionToken: 'test-session',
        refreshToken: 'test-refresh',
        isVerified: false
      }
    });

    await client.logout();

    expect(client.getState()).toEqual({
      isInitializing: false,
      isLoading: false,
      error: undefined,
      userId: 'anon-user',
      sessionToken: 'anon-session',
      refreshToken: 'anon-refresh',
      isVerified: false,
      baseUrl: 'http://localhost',
    });
  });

  it('should handle refresh token flow', async () => {
    const client = createAuthClient({
      baseUrl: 'http://localhost',
      initialState: {
        userId: 'test-user',
        sessionToken: 'test-session',
        refreshToken: 'test-refresh',
        isVerified: false
      }
    });

    await client.refresh();

    expect(client.getState()).toEqual({
      isInitializing: false,
      isLoading: false,
      error: undefined,
      userId: 'test-user',
      sessionToken: 'new-session',
      refreshToken: 'new-refresh',
      isVerified: false,
      baseUrl: 'http://localhost',
    });
  });

  it('should handle API errors', async () => {
    server.use(
      http.post('http://localhost/auth/request-code', () => {
        return new HttpResponse('Invalid email', {
          status: 400,
          headers: {
            'Content-Type': 'text/plain'
          }
        });
      })
    );

    const client = createAuthClient({
      baseUrl: 'http://localhost',
    });

    await expect(client.requestCode('invalid')).rejects.toThrow();

    expect(client.getState()).toEqual({
      isInitializing: false,
      isLoading: false,
      error: 'Invalid email',
      userId: null,
      sessionToken: null,
      refreshToken: null,
      isVerified: false,
      baseUrl: 'http://localhost',
    });
  });
}); 