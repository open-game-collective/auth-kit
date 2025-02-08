import { describe, it, expect, beforeEach } from 'vitest';
import { createAuthClient } from './client';
import { http, HttpResponse } from 'msw';
import { server } from './test/setup';

describe('AuthClient', () => {
  beforeEach(() => {
    // Reset all handlers before each test
    server.resetHandlers();
  });

  it('should initialize with correct state', () => {
    const client = createAuthClient({
      host: 'localhost:8787'
    });

    const state = client.getState();
    expect(state).toEqual({
      isLoading: false,
      error: undefined,
      userId: null,
      sessionToken: null,
      refreshToken: null,
      isVerified: false,
      host: 'localhost:8787'
    });
  });

  it('should create anonymous user', async () => {
    server.use(
      http.post('http://localhost:8787/auth/user', () => {
        return HttpResponse.json({
          userId: 'anon-user',
          sessionToken: 'anon-session',
          refreshToken: 'anon-refresh',
        });
      })
    );

    const client = createAuthClient({
      host: 'localhost:8787'
    });

    const states: any[] = [];
    client.subscribe((state) => states.push(state));

    await client.createAnonymousUser();

    expect(states).toHaveLength(1);
    expect(states[states.length - 1]).toEqual({
      isLoading: false,
      error: undefined,
      userId: 'anon-user',
      sessionToken: 'anon-session',
      refreshToken: 'anon-refresh',
      isVerified: false,
      host: 'localhost:8787'
    });
  });

  it('should notify subscribers of state changes', async () => {
    server.use(
      http.post('http://localhost:8787/auth/request-code', () => {
        return HttpResponse.json({
          userId: 'test-user',
          sessionToken: 'test-session',
          refreshToken: 'test-refresh',
        });
      })
    );

    const client = createAuthClient({
      host: 'localhost:8787'
    });

    const states: any[] = [];
    client.subscribe((state) => states.push(state));

    await client.requestCode('test@example.com');

    expect(states).toHaveLength(3); // Initial -> Loading -> Success
    expect(states[states.length - 1]).toEqual({
      isLoading: false,
      error: undefined,
      userId: 'test-user',
      sessionToken: 'test-session',
      refreshToken: 'test-refresh',
      isVerified: false,
      host: 'localhost:8787'
    });
  });

  it('should handle email verification flow', async () => {
    server.use(
      http.post('http://localhost:8787/auth/request-code', () => {
        return HttpResponse.json({
          userId: 'test-user',
          sessionToken: 'test-session',
          refreshToken: 'test-refresh',
        });
      }),
      http.post('http://localhost:8787/auth/verify', () => {
        return HttpResponse.json({
          success: true,
          userId: 'test-user',
          sessionToken: 'test-session',
          refreshToken: 'test-refresh',
        });
      })
    );

    const client = createAuthClient({
      host: 'localhost:8787'
    });

    // First request the code to get a userId
    await client.requestCode('test@example.com');
    
    // Then verify the email
    const result = await client.verifyEmail('test@example.com', '123456');

    expect(result).toEqual({ success: true });
    expect(client.getState()).toEqual({
      isLoading: false,
      error: undefined,
      userId: 'test-user',
      sessionToken: 'test-session',
      refreshToken: 'test-refresh',
      isVerified: true,
      host: 'localhost:8787'
    });
  });

  it('should handle logout by creating new anonymous user', async () => {
    server.use(
      http.post('http://localhost:8787/auth/request-code', () => {
        return HttpResponse.json({
          userId: 'test-user',
          sessionToken: 'test-session',
          refreshToken: 'test-refresh',
        });
      }),
      http.post('http://localhost:8787/auth/logout', () => {
        return HttpResponse.json({});
      }),
      http.post('http://localhost:8787/auth/user', () => {
        return HttpResponse.json({
          userId: 'anon-user',
          sessionToken: 'anon-session',
          refreshToken: 'anon-refresh',
        });
      })
    );

    const client = createAuthClient({
      host: 'localhost:8787'
    });

    // First set up an authenticated state via requestCode
    await client.requestCode('test@example.com');
    await client.logout();

    expect(client.getState()).toEqual({
      isLoading: false,
      error: undefined,
      refreshToken: "anon-refresh",
      sessionToken: "anon-session",
      userId: "anon-user",
      host: "localhost:8787",
      isVerified: false
    });
  });

  it('should handle refresh token flow', async () => {
    server.use(
      http.post('http://localhost:8787/auth/request-code', () => {
        return HttpResponse.json({
          userId: 'test-user',
          sessionToken: 'test-session',
          refreshToken: 'test-refresh',
        });
      }),
      http.post('http://localhost:8787/auth/refresh', () => {
        return HttpResponse.json({
          userId: 'test-user',
          sessionToken: 'new-session',
          refreshToken: 'new-refresh',
        });
      })
    );

    const client = createAuthClient({
      host: 'localhost:8787'
    });

    // First set up an authenticated state via requestCode
    await client.requestCode('test@example.com');
    await client.refresh();

    expect(client.getState()).toEqual({
      isLoading: false,
      error: undefined,
      userId: 'test-user',
      sessionToken: 'new-session',
      refreshToken: 'new-refresh',
      isVerified: false,
      host: 'localhost:8787'
    });
  });

  it('should handle API errors', async () => {
    server.use(
      http.post('http://localhost:8787/auth/request-code', () => {
        return new HttpResponse('Invalid email', {
          status: 400,
          headers: {
            'Content-Type': 'text/plain'
          }
        });
      })
    );

    const client = createAuthClient({
      host: 'localhost:8787'
    });

    await expect(client.requestCode('invalid')).rejects.toThrow();

    expect(client.getState()).toEqual({
      isLoading: false,
      error: 'Invalid email',
      userId: null,
      sessionToken: null,
      refreshToken: null,
      isVerified: false,
      host: 'localhost:8787'
    });
  });
}); 