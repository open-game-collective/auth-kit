import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createAuthClient } from './client';
import { http, HttpResponse } from 'msw';
import { server } from './test/setup';

// Declare window.location as mutable for tests
declare global {
  interface Window {
    location: Location;
  }
}

describe('AuthClient', () => {
  beforeEach(() => {
    // Reset all handlers before each test
    server.resetHandlers();
  });

  it('should initialize with correct state', () => {
    const client = createAuthClient({
      host: 'localhost:8787',
      userId: 'test-user',
      sessionToken: 'test-session'
    });

    const state = client.getState();
    expect(state).toEqual({
      isLoading: false,
      error: undefined,
      userId: 'test-user',
      sessionToken: 'test-session',
      refreshToken: null,
      isVerified: false,
      host: 'localhost:8787'
    });
  });

  it('should notify subscribers of state changes', async () => {
    server.use(
      http.post('http://localhost:8787/auth/request-code', () => {
        return HttpResponse.json({
          userId: 'test-user-2',
          sessionToken: 'test-session-2',
          refreshToken: 'test-refresh',
        });
      })
    );

    const client = createAuthClient({
      host: 'localhost:8787',
      userId: 'test-user',
      sessionToken: 'test-session'
    });

    const states: any[] = [];
    client.subscribe((state) => states.push(state));

    await client.requestCode('test@example.com');

    expect(states).toHaveLength(3); // Initial -> Loading -> Success
    expect(states[states.length - 1]).toEqual({
      isLoading: false,
      error: undefined,
      userId: 'test-user-2',
      sessionToken: 'test-session-2',
      refreshToken: 'test-refresh',
      isVerified: false,
      host: 'localhost:8787'
    });
  });

  it('should handle email verification flow', async () => {
    server.use(
      http.post('http://localhost:8787/auth/request-code', () => {
        return HttpResponse.json({
          userId: 'test-user-2',
          sessionToken: 'test-session-2',
          refreshToken: 'test-refresh',
        });
      }),
      http.post('http://localhost:8787/auth/verify', () => {
        return HttpResponse.json({
          success: true,
          userId: 'test-user-2',
          sessionToken: 'test-session-2',
          refreshToken: 'test-refresh',
        });
      })
    );

    const client = createAuthClient({
      host: 'localhost:8787',
      userId: 'test-user',
      sessionToken: 'test-session'
    });

    // First request the code to get a userId
    await client.requestCode('test@example.com');
    
    // Then verify the email
    const result = await client.verifyEmail('test@example.com', '123456');

    expect(result).toEqual({ success: true });
    expect(client.getState()).toEqual({
      isLoading: false,
      error: undefined,
      userId: 'test-user-2',
      sessionToken: 'test-session-2',
      refreshToken: 'test-refresh',
      isVerified: true,
      host: 'localhost:8787'
    });
  });

  it('should handle logout by reloading page', async () => {
    server.use(
      http.post('http://localhost:8787/auth/logout', () => {
        return HttpResponse.json({ success: true });
      })
    );

    const client = createAuthClient({
      host: 'localhost:8787',
      userId: 'test-user',
      sessionToken: 'test-session'
    });

    // Mock window.location.reload
    const reloadMock = vi.fn();
    const originalReload = window.location.reload;
    Object.defineProperty(window.location, 'reload', {
      value: reloadMock,
      configurable: true
    });

    await client.logout();

    expect(reloadMock).toHaveBeenCalledTimes(1);

    // Restore original reload
    Object.defineProperty(window.location, 'reload', {
      value: originalReload,
      configurable: true
    });
  });

  it('should handle refresh token flow', async () => {
    server.use(
      http.post('http://localhost:8787/auth/refresh', () => {
        return HttpResponse.json({
          userId: 'test-user',
          sessionToken: 'new-session',
          refreshToken: 'new-refresh',
        });
      })
    );

    const client = createAuthClient({
      host: 'localhost:8787',
      userId: 'test-user',
      sessionToken: 'test-session'
    });

    // Set refresh token in state
    client.getState().refreshToken = 'test-refresh';

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
      host: 'localhost:8787',
      userId: 'test-user',
      sessionToken: 'test-session'
    });

    await expect(client.requestCode('invalid')).rejects.toThrow();

    expect(client.getState()).toEqual({
      isLoading: false,
      error: 'Invalid email',
      userId: 'test-user',
      sessionToken: 'test-session',
      refreshToken: null,
      isVerified: false,
      host: 'localhost:8787'
    });
  });
}); 