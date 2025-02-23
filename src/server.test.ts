import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { createAuthRouter, withAuth } from './server';
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
          payload: { userId: 'test-user', sessionId: 'test-session', aud: 'SESSION' }
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
  const onNewUser = vi.fn();
  const onEmailVerified = vi.fn();
  const onAuthenticate = vi.fn();
  const getUserIdByEmail = vi.fn().mockImplementation(async ({ email }) => {
    // For tests, return a fixed user ID for test@example.com
    return email === 'test@example.com' ? 'test-user' : null;
  });
  const storeVerificationCode = vi.fn();
  const verifyVerificationCode = vi.fn().mockImplementation(async ({ email, code }) => {
    // For tests, accept '123456' as valid code for any email
    return code === '123456';
  });
  const sendVerificationCode = vi.fn().mockResolvedValue(true);

  const router = createAuthRouter<typeof mockEnv>({
    hooks: {
      onNewUser,
      onEmailVerified,
      onAuthenticate,
      getUserIdByEmail,
      storeVerificationCode,
      verifyVerificationCode,
      sendVerificationCode
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(data).toEqual({
      success: true,
      message: 'Code sent to email',
      expiresIn: 600
    });

    // Verify hooks were called
    expect(storeVerificationCode).toHaveBeenCalledWith({
      email: 'test@example.com',
      code: expect.any(String),
      env: mockEnv,
      request
    });
    expect(sendVerificationCode).toHaveBeenCalledWith({
      email: 'test@example.com',
      code: expect.any(String),
      env: mockEnv,
      request
    });
  });

  it('should handle email verification for existing user', async () => {
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
    expect(data).toEqual({
      success: true,
      userId: 'test-user',
      sessionToken: 'new-session-token',
      refreshToken: 'new-refresh-token'
    });

    // Verify hooks were called
    expect(verifyVerificationCode).toHaveBeenCalledWith({
      email: 'test@example.com',
      code: '123456',
      env: mockEnv,
      request
    });
    expect(onAuthenticate).toHaveBeenCalledWith({
      userId: 'test-user',
      email: 'test@example.com',
      env: mockEnv,
      request
    });
    expect(onEmailVerified).toHaveBeenCalledWith({
      userId: 'test-user',
      email: 'test@example.com',
      env: mockEnv,
      request
    });
  });

  it('should reject email verification with invalid code', async () => {
    const request = new Request('http://localhost/auth/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'test@example.com',
        code: 'wrong-code'
      })
    });

    const response = await router(request, mockEnv);
    expect(response.status).toBe(400);
    expect(await response.text()).toBe('Invalid or expired code');

    // Verify hooks were called
    expect(verifyVerificationCode).toHaveBeenCalledWith({
      email: 'test@example.com',
      code: 'wrong-code',
      env: mockEnv,
      request
    });
    // Verify no other hooks were called
    expect(onAuthenticate).not.toHaveBeenCalled();
    expect(onEmailVerified).not.toHaveBeenCalled();
  });

  it('should handle email verification for non-existent user', async () => {
    const request = new Request('http://localhost/auth/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'new-user@example.com',
        code: '123456'
      })
    });

    const response = await router(request, mockEnv);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      userId: expect.any(String),
      sessionToken: 'new-session-token',
      refreshToken: 'new-refresh-token'
    });

    // Verify hooks were called
    expect(onNewUser).toHaveBeenCalledWith({
      userId: expect.any(String),
      env: mockEnv,
      request
    });
    expect(onEmailVerified).toHaveBeenCalledWith({
      userId: expect.any(String),
      email: 'new-user@example.com',
      env: mockEnv,
      request
    });
  });

  it('should handle token refresh with valid refresh token', async () => {
    const request = new Request('http://localhost/auth/refresh', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer valid-refresh-token'
      }
    });

    const response = await router(request, mockEnv);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      sessionToken: 'new-session-token',
      refreshToken: 'new-refresh-token'
    });
  });

  it('should handle token refresh with invalid refresh token', async () => {
    const request = new Request('http://localhost/auth/refresh', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer invalid-refresh-token'
      }
    });

    const response = await router(request, mockEnv);
    expect(response.status).toBe(401);
    expect(await response.text()).toBe('Invalid refresh token');
  });

  it('should handle token refresh without refresh token', async () => {
    const request = new Request('http://localhost/auth/refresh', {
      method: 'POST'
    });

    const response = await router(request, mockEnv);
    expect(response.status).toBe(401);
    expect(await response.text()).toBe('No refresh token provided');
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

  describe('Web Auth Code', () => {
    it('should generate web auth code with valid session token', async () => {
      const request = new Request('http://localhost/auth/web-code', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer valid-session-token'
        }
      });

      const response = await router(request, mockEnv);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        code: expect.any(String),
        expiresIn: 300
      });
    });

    it('should reject web auth code request without Authorization header', async () => {
      const request = new Request('http://localhost/auth/web-code', {
        method: 'POST'
      });

      const response = await router(request, mockEnv);
      expect(response.status).toBe(401);
      expect(await response.text()).toBe('Unauthorized');
    });

    it('should reject web auth code request with invalid session token', async () => {
      const request = new Request('http://localhost/auth/web-code', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer invalid-token'
        }
      });

      const response = await router(request, mockEnv);
      expect(response.status).toBe(401);
      expect(await response.text()).toBe('Invalid session token');
    });

    it('should reject web auth code request with malformed Authorization header', async () => {
      const request = new Request('http://localhost/auth/web-code', {
        method: 'POST',
        headers: {
          'Authorization': 'invalid-format'
        }
      });

      const response = await router(request, mockEnv);
      expect(response.status).toBe(401);
      expect(await response.text()).toBe('Unauthorized');
    });
  });
});

describe('Auth Middleware', () => {
  const originalHeadersGet = Headers.prototype.get;
  beforeAll(() => {
    Headers.prototype.get = function(key: string) {
      if (key.toLowerCase() === 'cookie' && (global as any).__testCookieValue__) {
        return (global as any).__testCookieValue__;
      }
      return originalHeadersGet.call(this, key);
    };
  });
  afterAll(() => {
    Headers.prototype.get = originalHeadersGet;
  });
  
  const mockHandler = vi.fn().mockResolvedValue(new Response('OK'));
  const middleware = withAuth(mockHandler, {
    hooks: {
      onNewUser: vi.fn(),
      onEmailVerified: vi.fn(),
      onAuthenticate: vi.fn(),
      getUserIdByEmail: vi.fn().mockImplementation(async ({ email }) => {
        return email === 'test@example.com' ? 'test-user' : null;
      }),
      storeVerificationCode: vi.fn(),
      verifyVerificationCode: vi.fn().mockImplementation(async ({ email, code }) => {
        return email === 'test@example.com' && code === '123456';
      }),
      sendVerificationCode: vi.fn().mockResolvedValue(true)
    }
  });

  beforeEach(() => {
    (global as any).__testCookieValue__ = undefined;
    mockHandler.mockClear();
  });

  it('should create anonymous user for new requests', async () => {
    // No cookies set
    const request = new Request('http://localhost/');
    const response = await middleware(request, mockEnv);

    expect(mockHandler).toHaveBeenCalledWith(
      request,
      mockEnv,
      { userId: 'test-uuid', sessionId: 'test-uuid', sessionToken: 'new-session-token' }
    );

    const cookies = response.headers.getSetCookie?.() || response.headers.get('Set-Cookie')?.split(', ');
    expect(cookies?.some(c => c.includes('auth_session_token='))).toBe(true);
    expect(cookies?.some(c => c.includes('auth_refresh_token='))).toBe(true);
  });

  it('should use existing session if valid', async () => {
    (global as any).__testCookieValue__ = 'auth_session_token=valid-session-token';
    const request = new Request('http://localhost/');

    await middleware(request, mockEnv);

    expect(mockHandler).toHaveBeenCalledWith(
      request,
      mockEnv,
      { userId: 'test-user', sessionId: 'test-session', sessionToken: 'valid-session-token' }
    );
  });

  it('should refresh session if expired but has valid refresh token', async () => {
    (global as any).__testCookieValue__ = 'auth_session_token=invalid-token; auth_refresh_token=valid-refresh-token';
    const request = new Request('http://localhost/');

    const response = await middleware(request, mockEnv);

    expect(mockHandler).toHaveBeenCalledWith(
      request,
      mockEnv,
      { userId: 'test-user', sessionId: expect.any(String), sessionToken: 'new-session-token' }
    );

    const cookies = response.headers.getSetCookie?.() || response.headers.get('Set-Cookie')?.split(', ');
    expect(cookies?.some(c => c.includes('auth_session_token='))).toBe(true);
    expect(cookies?.some(c => c.includes('auth_refresh_token='))).toBe(true);
  });

  it('should create new anonymous user if all tokens are invalid', async () => {
    (global as any).__testCookieValue__ = 'auth_session_token=invalid-token; auth_refresh_token=invalid-token';
    const request = new Request('http://localhost/');

    const response = await middleware(request, mockEnv);

    expect(mockHandler).toHaveBeenCalledWith(
      request,
      mockEnv,
      { userId: 'test-uuid', sessionId: 'test-uuid', sessionToken: 'new-session-token' }
    );

    const cookies = response.headers.getSetCookie?.() || response.headers.get('Set-Cookie')?.split(', ');
    expect(cookies?.some(c => c.includes('auth_session_token='))).toBe(true);
    expect(cookies?.some(c => c.includes('auth_refresh_token='))).toBe(true);
  });

  it('should call onNewUser hook when creating anonymous user', async () => {
    const onNewUser = vi.fn();
    const middlewareWithHook = withAuth(mockHandler, {
      hooks: { 
        onNewUser,
        onEmailVerified: vi.fn(),
        onAuthenticate: vi.fn(),
        getUserIdByEmail: vi.fn().mockImplementation(async ({ email }) => {
          return email === 'test@example.com' ? 'test-user' : null;
        }),
        storeVerificationCode: vi.fn(),
        verifyVerificationCode: vi.fn().mockImplementation(async ({ email, code }) => {
          return email === 'test@example.com' && code === '123456';
        }),
        sendVerificationCode: vi.fn().mockResolvedValue(true)
      }
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