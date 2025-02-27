import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createAuthClient, createAnonymousUser } from './client';
import { http, HttpResponse } from 'msw';
import { server } from './test/setup';

// Declare window.location as mutable for tests
declare global {
  interface Window {
    location: Location;
  }
}

describe('createAnonymousUser', () => {
  beforeEach(() => {
    server.resetHandlers();
  });

  it('should create an anonymous user', async () => {
    server.use(
      http.post('http://localhost:8787/auth/anonymous', () => {
        return HttpResponse.json({
          userId: 'anon-123',
          sessionToken: 'session-token-123',
          refreshToken: 'refresh-token-123'
        });
      })
    );

    const result = await createAnonymousUser({
      host: 'localhost:8787'
    });

    expect(result).toEqual({
      userId: 'anon-123',
      sessionToken: 'session-token-123',
      refreshToken: 'refresh-token-123'
    });
  });

  it('should create an anonymous user with custom token expiration', async () => {
    server.use(
      http.post('http://localhost:8787/auth/anonymous', async ({ request }) => {
        const body = await request.json();
        expect(body).toEqual({
          refreshTokenExpiresIn: '30d',
          sessionTokenExpiresIn: '1h'
        });
        return HttpResponse.json({
          userId: 'anon-123',
          sessionToken: 'session-token-123',
          refreshToken: 'refresh-token-123'
        });
      })
    );

    const result = await createAnonymousUser({
      host: 'localhost:8787',
      refreshTokenExpiresIn: '30d',
      sessionTokenExpiresIn: '1h'
    });

    expect(result).toEqual({
      userId: 'anon-123',
      sessionToken: 'session-token-123',
      refreshToken: 'refresh-token-123'
    });
  });

  it('should handle errors when creating anonymous user', async () => {
    server.use(
      http.post('http://localhost:8787/auth/anonymous', () => {
        return new HttpResponse('Server error', { status: 500 });
      })
    );

    await expect(createAnonymousUser({
      host: 'localhost:8787'
    })).rejects.toThrow();
  });
});

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
      error: null,
      userId: 'test-user',
      sessionToken: 'test-session',
      email: null
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

    expect(states).toHaveLength(4); // Initial -> Loading -> Success -> Email extraction
    expect(states[states.length - 1]).toEqual({
      isLoading: false,
      error: null,
      userId: 'test-user-2',
      sessionToken: 'test-session-2',
      email: null
    });
  });

  it('should handle email verification flow', async () => {
    // Mock JWT token that includes email
    const mockSessionToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ0ZXN0LXVzZXItMiIsInNlc3Npb25JZCI6InNlc3Npb24taWQiLCJlbWFpbCI6InRlc3RAZXhhbXBsZS5jb20iLCJhdWQiOiJTRVNTSU9OIiwiZXhwIjoxNjE2MTYxNjE2fQ.signature';
    
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
          sessionToken: mockSessionToken,
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
      error: null,
      userId: 'test-user-2',
      sessionToken: mockSessionToken,
      email: 'test@example.com'
    });
  });

  it('should handle logout by clearing state', async () => {
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

    await client.logout();

    expect(client.getState()).toEqual({
      isLoading: false,
      userId: '',
      sessionToken: '',
      email: null,
      error: null
    });
  });

  it('should handle refresh token flow', async () => {
    // Mock JWT token that includes email
    const mockSessionToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ0ZXN0LXVzZXIiLCJzZXNzaW9uSWQiOiJzZXNzaW9uLWlkIiwiZW1haWwiOiJ0ZXN0QGV4YW1wbGUuY29tIiwiYXVkIjoiU0VTU0lPTiIsImV4cCI6MTYxNjE2MTYxNn0.signature';
    
    server.use(
      http.post('http://localhost:8787/auth/refresh', () => {
        return HttpResponse.json({
          userId: 'test-user',
          sessionToken: mockSessionToken,
          refreshToken: 'new-refresh',
        });
      })
    );

    const client = createAuthClient({
      host: 'localhost:8787',
      userId: 'test-user',
      sessionToken: 'test-session',
      refreshToken: 'test-refresh'
    });

    await client.refresh();

    expect(client.getState()).toEqual({
      isLoading: false,
      error: null,
      userId: 'test-user',
      sessionToken: mockSessionToken,
      email: 'test@example.com'
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
      email: null
    });
  });

  it('should maintain sessionToken in state after initialization', () => {
    const client = createAuthClient({
      host: 'localhost:8787',
      userId: 'test-user',
      sessionToken: 'initial-session-token'
    });

    expect(client.getState().sessionToken).toBe('initial-session-token');
  });

  it('should update sessionToken after successful verification', async () => {
    // Mock JWT token that includes email
    const mockSessionToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ0ZXN0LXVzZXIiLCJzZXNzaW9uSWQiOiJzZXNzaW9uLWlkIiwiZW1haWwiOiJ0ZXN0QGV4YW1wbGUuY29tIiwiYXVkIjoiU0VTU0lPTiIsImV4cCI6MTYxNjE2MTYxNn0.signature';
    
    server.use(
      http.post('http://localhost:8787/auth/verify', () => {
        return HttpResponse.json({
          success: true,
          userId: 'test-user',
          sessionToken: mockSessionToken,
          refreshToken: 'test-refresh'
        });
      })
    );

    const client = createAuthClient({
      host: 'localhost:8787',
      userId: 'test-user',
      sessionToken: 'initial-session-token'
    });

    await client.verifyEmail('test@example.com', '123456');

    expect(client.getState().sessionToken).toBe(mockSessionToken);
    expect(client.getState().email).toBe('test@example.com');
  });

  it('should update sessionToken after successful refresh', async () => {
    // Mock JWT token that includes email
    const mockSessionToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ0ZXN0LXVzZXIiLCJzZXNzaW9uSWQiOiJzZXNzaW9uLWlkIiwiZW1haWwiOiJ0ZXN0QGV4YW1wbGUuY29tIiwiYXVkIjoiU0VTU0lPTiIsImV4cCI6MTYxNjE2MTYxNn0.signature';
    
    server.use(
      http.post('http://localhost:8787/auth/refresh', () => {
        return HttpResponse.json({
          success: true,
          userId: 'test-user',
          sessionToken: mockSessionToken,
          refreshToken: 'new-refresh'
        });
      })
    );

    const client = createAuthClient({
      host: 'localhost:8787',
      userId: 'test-user',
      sessionToken: 'initial-session-token',
      refreshToken: 'test-refresh'
    });

    await client.refresh();

    expect(client.getState().sessionToken).toBe(mockSessionToken);
    expect(client.getState().email).toBe('test@example.com');
  });
});

describe('Mobile-to-Web Authentication', () => {
  beforeEach(() => {
    server.resetHandlers();
  });

  it('should generate web auth code', async () => {
    server.use(
      http.post('http://localhost:8787/auth/web-code', () => {
        return HttpResponse.json({
          code: 'test-web-code',
          expiresIn: 300
        });
      })
    );

    const client = createAuthClient({
      host: 'localhost:8787',
      userId: 'test-user',
      sessionToken: 'test-session'
    });

    const result = await client.getWebAuthCode();
    expect(result).toEqual({
      code: 'test-web-code',
      expiresIn: 300
    });
  });

  it('should handle web auth code errors', async () => {
    server.use(
      http.post('http://localhost:8787/auth/web-code', () => {
        return new HttpResponse('Unauthorized', { status: 401 });
      })
    );

    const client = createAuthClient({
      host: 'localhost:8787',
      userId: 'test-user',
      sessionToken: 'test-session'
    });

    await expect(client.getWebAuthCode()).rejects.toThrow('Unauthorized');
  });
}); 