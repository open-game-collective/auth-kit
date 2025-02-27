import type { AuthState, UserCredentials, AuthClient, AuthClientConfig, AnonymousUserConfig } from "./types";

/**
 * Decodes a JWT token without verification
 * This is safe for client-side use since we're only reading the payload
 * and not relying on the token's integrity for security purposes
 */
function decodeJWT(token: string): Record<string, any> | null {
  try {
    // Check if token is valid
    if (!token || typeof token !== 'string') {
      return null;
    }
    
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }
    
    const base64Url = parts[1];
    if (!base64Url) return null;
    
    // Replace characters for base64 decoding
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    
    // Cross-platform base64 decoding implementation
    let jsonPayload: string;
    
    // For React Native environment
    if (typeof global !== 'undefined' && global.Buffer) {
      jsonPayload = global.Buffer.from(base64, 'base64').toString('utf8');
    } 
    // For browser environment
    else if (typeof atob === 'function') {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      jsonPayload = new TextDecoder().decode(bytes);
    } 
    // Pure JS implementation for environments without native base64 support
    else {
      // Implementation of base64 decoder without external dependencies
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
      let output = '';
      
      // Remove padding
      const str = base64.replace(/=+$/, '');
      
      if (str.length % 4 === 1) {
        throw new Error("Invalid base64 string");
      }
      
      for (let bc = 0, bs = 0, buffer, i = 0; buffer = str.charAt(i++);) {
        // Check if the character exists in the base64 character set
        const idx = chars.indexOf(buffer);
        if (idx === -1) continue;
        
        bs = bc % 4 ? bs * 64 + idx : idx;
        if (bc++ % 4) {
          output += String.fromCharCode(255 & bs >> (-2 * bc & 6));
        }
      }
      
      jsonPayload = output;
    }
    
    return JSON.parse(jsonPayload);
  } catch (error) {
    console.error('Error decoding JWT:', error);
    return null;
  }
}

export async function createAnonymousUser(config: AnonymousUserConfig): Promise<UserCredentials> {
  // Add protocol if not present
  const apiHost = config.host.startsWith('http://') || config.host.startsWith('https://')
    ? config.host
    : `http://${config.host}`;

  const response = await fetch(`${apiHost}/auth/anonymous`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      refreshTokenExpiresIn: config.refreshTokenExpiresIn,
      sessionTokenExpiresIn: config.sessionTokenExpiresIn
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }

  return response.json();
}

export function createAuthClient(config: AuthClientConfig): AuthClient {
  // Store host separately from the AuthState
  const host = config.host;
  let refreshToken = config.refreshToken || null;
  
  let state: AuthState = {
    isLoading: false,
    userId: config.userId,
    sessionToken: config.sessionToken,
    email: null,
    error: null
  };

  // Extract email from initial session token if available
  if (config.sessionToken) {
    const payload = decodeJWT(config.sessionToken);
    if (payload && payload.email) {
      state.email = payload.email;
    }
  }

  const subscribers: Array<(state: AuthState) => void> = [];

  function setState(newState: Partial<AuthState>) {
    state = { ...state, ...newState };
    subscribers.forEach(cb => cb(state));
  }

  function setLoading(isLoading: boolean) {
    setState({
      isLoading
    } as AuthState);
  }

  function setError(error: string) {
    setState({
      isLoading: false,
      error
    });
  }

  function updateStateFromToken(sessionToken: string) {
    const payload = decodeJWT(sessionToken);
    const email = payload?.email || null;
    
    setState({
      sessionToken,
      email
    });
  }

  function setAuthenticated(props: {
    userId: string;
    sessionToken: string;
    refreshToken: string | null;
  }) {
    // Update refresh token
    refreshToken = props.refreshToken;
    
    // First update the basic properties
    setState({
      isLoading: false,
      userId: props.userId,
      sessionToken: props.sessionToken
    });
    
    // Then extract and set email from the token
    updateStateFromToken(props.sessionToken);
  }

  async function post<T>(path: string, body?: object, headers?: Record<string, string>): Promise<T> {
    try {
      const combinedHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        ...headers
      };
      
      // Add Authorization header for refresh token if available
      if (path === 'refresh' && refreshToken) {
        combinedHeaders['Authorization'] = `Bearer ${refreshToken}`;
      }

      // Add protocol if not present
      const apiHost = host.startsWith('http://') || host.startsWith('https://')
        ? host
        : `http://${host}`;

      const response = await fetch(`${apiHost}/auth/${path}`, {
        method: 'POST',
        headers: combinedHeaders,
        body: body ? JSON.stringify(body) : undefined
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(error);
      }

      return response.json();
    } catch (error) {
      config.onError?.(error instanceof Error ? error : new Error('Unknown error'));
      throw error;
    }
  }

  return {
    getState() {
      return state;
    },
    subscribe(callback: (state: AuthState) => void) {
      subscribers.push(callback);
      return () => {
        const index = subscribers.indexOf(callback);
        if (index > -1) subscribers.splice(index, 1);
      };
    },
    async requestCode(email: string) {
      setLoading(true);
      try {
        const response = await post<UserCredentials>('request-code', { email });
        setAuthenticated({
          userId: response.userId,
          sessionToken: response.sessionToken,
          refreshToken: response.refreshToken
        });
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Failed to request code');
        throw error;
      } finally {
        setLoading(false);
      }
    },
    async verifyEmail(email: string, code: string) {
      if (!state.userId) {
        throw new Error("No user ID available");
      }

      setLoading(true);
      try {
        const result = await post<UserCredentials & { success: boolean }>('verify', { 
          email, 
          code,
          userId: state.userId 
        });

        setAuthenticated({
          userId: result.userId,
          sessionToken: result.sessionToken,
          refreshToken: result.refreshToken
        });
        return { success: result.success };
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Failed to verify email');
        throw error;
      } finally {
        setLoading(false);
      }
    },
    async logout() {
      if (!state.userId) {
        return; // Already logged out
      }

      setLoading(true);
      try {
        await post('logout', { userId: state.userId });
        // Clear local state
        refreshToken = null;
        setState({
          ...state,
          userId: '',
          sessionToken: '',
          email: null
        });
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Failed to logout');
        throw error;
      } finally {
        setLoading(false);
      }
    },
    async refresh() {
      if (!refreshToken) {
        throw new Error("No refresh token available. For web applications, token refresh is handled by the server middleware.");
      }

      setLoading(true);
      try {
        const response = await post<UserCredentials>('refresh');
        setAuthenticated({
          userId: response.userId,
          sessionToken: response.sessionToken,
          refreshToken: response.refreshToken
        });
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Failed to refresh token');
        throw error;
      } finally {
        setLoading(false);
      }
    },
    async getWebAuthCode() {
      setLoading(true);
      try {
        const response = await post<{ code: string; expiresIn: number }>('web-code', undefined, {
          Authorization: `Bearer ${state.sessionToken}`
        });
        return response;
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Failed to get web auth code');
        throw error;
      } finally {
        setLoading(false);
      }
    }
  };
}

// Re-export AuthClient and AuthClientConfig types from './types'
export type { AuthClient, AuthClientConfig } from "./types";
