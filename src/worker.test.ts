import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAuthRouter, withAuth } from './worker';
import { http, HttpResponse } from 'msw';
import { server } from './test/setup';

// Mock crypto for UUID generation
vi.stubGlobal('crypto', {
  randomUUID: () => 'test-uuid'
});

// Mock jose JWT functions
vi.mock('jose', () => {
  const mockSign = () => Promise.resolve('new-session-token');
  const mockRefreshSign = () => Promise.resolve('new-refresh-token');

  const createMockJWT = (payload: Record<string, unknown>) => {
    const chain = {
      setProtectedHeader: () => chain,
      setAudience: () => chain,
      setExpirationTime: () => chain,
      sign: () => payload.sessionId ? mockSign() : mockRefreshSign()
    };
    return chain;
  };

  return {
    SignJWT: vi.fn().mockImplementation(createMockJWT),
    jwtVerify: vi.fn().mockImplementation(async (_token, _secret) => {
      if (_token === 'valid-session-token') {
        return {
          payload: { userId: 'test-user', sessionId: 'test-session' }
        };
      }
      if (_token === 'valid-refresh-token') {
        // For refresh tokens, we only need userId
        return {
          payload: { userId: 'test-user', aud: 'REFRESH' }
        };
      }
      if (_token === 'invalid-token') {
        return {
          payload: { }
        };
      }
      throw new Error('Invalid token');
    })
  };
});

// Mock environment
const mockEnv = {
  AUTH_SECRET: 'test-secret',
  USER: {
    idFromName: (_name: string) => ({ name: _name }),
    get: (_id: { name: string }) => ({
      spawn: vi.fn().mockResolvedValue(undefined)
    })
  }
};

describe('Auth Router', () => {
  const router = createAuthRouter<typeof mockEnv>({
    hooks: {
      onNewUser: vi.fn(),
      onEmailVerified: vi.fn()
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should handle email verification', async () => {
    const request = new Request('http://localhost/auth/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'test@example.com',
        code: '123456'
      })
    });

    const response = await router(request, mockEnv);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true });
  });

  it('should handle email code request', async () => {
    const request = new Request('http://localhost/auth/request-code', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'test@example.com'
      })
    });

    const response = await router(request, mockEnv);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true });
  });

  it('should handle token refresh with valid refresh token', async () => {
    const request = new Request('http://localhost/auth/refresh', {
      method: 'POST',
      headers: new Headers({
        'Authorization': 'Bearer valid-refresh-token'
      })
    });

    const response = await router(request, mockEnv);
    expect(response.status).toBe(200);
    
    const data = await response.json();
    expect(data).toEqual({
      userId: 'test-user',
      sessionToken: 'new-session-token',
      refreshToken: 'new-refresh-token'
    });
  });

  it('should reject token refresh without refresh token', async () => {
    const request = new Request('http://localhost/auth/refresh', {
      method: 'POST'
    });

    const response = await router(request, mockEnv);
    expect(response.status).toBe(401);
    expect(await response.text()).toBe('No refresh token');
  });

  it('should handle logout', async () => {
    const request = new Request('http://localhost/auth/logout', {
      method: 'POST'
    });

    const response = await router(request, mockEnv);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true });

    const cookies = response.headers.getSetCookie?.() || response.headers.get('Set-Cookie')?.split(', ');
    expect(cookies?.some(c => c.includes('Max-Age=0'))).toBe(true);
  });

  it('should reject non-POST requests', async () => {
    const request = new Request('http://localhost/auth/verify', {
      method: 'GET'
    });

    const response = await router(request, mockEnv);
    expect(response.status).toBe(405);
  });

  it('should handle invalid routes', async () => {
    const request = new Request('http://localhost/auth/invalid', {
      method: 'POST'
    });

    const response = await router(request, mockEnv);
    expect(response.status).toBe(404);
  });
});

describe('Auth Middleware', () => {
  const mockHandler = vi.fn().mockResolvedValue(new Response('OK'));
  const middleware = withAuth(mockHandler, {
    hooks: {
      onNewUser: vi.fn(),
      onEmailVerified: vi.fn()
    }
  });

  beforeEach(() => {
    mockHandler.mockClear();
  });

  it('should create anonymous user for new requests', async () => {
    const request = new Request('http://localhost/');
    const response = await middleware(request, mockEnv);

    expect(mockHandler).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        ...mockEnv,
        userId: 'test-uuid',
        sessionId: 'test-uuid'
      })
    );

    const cookies = response.headers.getSetCookie?.() || response.headers.get('Set-Cookie')?.split(', ');
    expect(cookies?.some(c => c.includes('auth_session_token='))).toBe(true);
    expect(cookies?.some(c => c.includes('auth_refresh_token='))).toBe(true);
  });

  it('should use existing session if valid', async () => {
    const request = new Request('http://localhost/', {
      headers: new Headers({
        Cookie: 'auth_session_token=valid-session-token'
      })
    });

    await middleware(request, mockEnv);

    expect(mockHandler).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        ...mockEnv,
        userId: 'test-uuid',
        sessionId: 'test-uuid'
      })
    );
  });

  it('should refresh session if expired but has valid refresh token', async () => {
    const headers = new Headers();
    headers.append('Cookie', 'auth_session_token=invalid-token; auth_refresh_token=valid-refresh-token');
    
    const request = new Request('http://localhost/', {
      headers
    });

    const response = await middleware(request, mockEnv);

    expect(mockHandler).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        ...mockEnv,
        userId: 'test-uuid',
        sessionId: expect.any(String)
      })
    );

    const cookies = response.headers.getSetCookie?.() || response.headers.get('Set-Cookie')?.split(', ');
    expect(cookies?.some(c => c.includes('auth_session_token='))).toBe(true);
    expect(cookies?.some(c => c.includes('auth_refresh_token='))).toBe(true);
  });

  it('should create new anonymous user if all tokens are invalid', async () => {
    const request = new Request('http://localhost/', {
      headers: {
        Cookie: 'auth_session_token=invalid-token; auth_refresh_token=invalid-token'
      }
    });

    const response = await middleware(request, mockEnv);

    expect(mockHandler).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        ...mockEnv,
        userId: 'test-uuid',
        sessionId: 'test-uuid'
      })
    );

    const cookies = response.headers.getSetCookie?.() || response.headers.get('Set-Cookie')?.split(', ');
    expect(cookies?.some(c => c.includes('auth_session_token='))).toBe(true);
    expect(cookies?.some(c => c.includes('auth_refresh_token='))).toBe(true);
  });

  it('should call onNewUser hook when creating anonymous user', async () => {
    const onNewUser = vi.fn();
    const middlewareWithHook = withAuth(mockHandler, {
      hooks: { onNewUser }
    });

    const request = new Request('http://localhost/');
    await middlewareWithHook(request, mockEnv);

    expect(onNewUser).toHaveBeenCalledWith({
      userId: 'test-uuid',
      env: mockEnv,
      request
    });
  });
}); 