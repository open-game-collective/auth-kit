import type { AuthState, AuthTokens } from "./types";

export interface AuthClient {
  getState(): AuthState;
  subscribe(callback: (state: AuthState) => void): () => void;
  createAnonymousUser(): Promise<void>;
  requestCode(email: string): Promise<void>;
  verifyEmail(email: string, code: string): Promise<{ success: boolean }>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
}

export interface AuthClientConfig {
  baseUrl: string;
  initialState?: Partial<AuthState>;
  onStateChange?: (state: AuthState) => void;
  onError?: (error: Error) => void;
}

export function createAuthClient(config: AuthClientConfig): AuthClient {
  const listeners = new Set<(state: AuthState) => void>();
  
  // Initial state is always unauthenticated
  let currentState: AuthState = {
    isInitializing: false,
    isLoading: false,
    userId: null,
    sessionToken: null,
    refreshToken: null,
    isVerified: false,
    baseUrl: config.baseUrl,
    ...(config.initialState || {})
  } as AuthState;

  function setState(newState: AuthState) {
    currentState = newState;
    config.onStateChange?.(newState);
    listeners.forEach(callback => callback(newState));
  }

  function setLoading(isLoading: boolean) {
    setState({
      ...currentState,
      isLoading
    } as AuthState);
  }

  function setError(error: string) {
    setState({
      isInitializing: false,
      isLoading: false,
      userId: null,
      sessionToken: null,
      refreshToken: null,
      isVerified: false,
      baseUrl: config.baseUrl,
      error
    });
  }

  function setAuthenticated(props: {
    userId: string;
    sessionToken: string;
    refreshToken: string | null;
    isVerified: boolean;
  }) {
    setState({
      isInitializing: false,
      isLoading: false,
      baseUrl: config.baseUrl,
      ...props
    });
  }

  async function post<T>(path: string, body?: object): Promise<T> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      
      // Add Authorization header for refresh token if available
      if (path === 'refresh' && currentState.refreshToken) {
        headers['Authorization'] = `Bearer ${currentState.refreshToken}`;
      }

      const response = await fetch(`${config.baseUrl}/auth/${path}`, {
        method: 'POST',
        headers,
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
      return currentState;
    },

    subscribe(callback: (state: AuthState) => void) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },

    async createAnonymousUser() {
      setLoading(true);
      try {
        const tokens = await post<AuthTokens>('user');
        setAuthenticated({
          userId: tokens.userId,
          sessionToken: tokens.sessionToken,
          refreshToken: tokens.refreshToken,
          isVerified: false
        });
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Failed to create anonymous user');
        throw error;
      } finally {
        setLoading(false);
      }
    },

    async requestCode(email: string) {
      setLoading(true);
      try {
        const response = await post<AuthTokens>('request-code', { email });
        setAuthenticated({
          userId: response.userId,
          sessionToken: response.sessionToken,
          refreshToken: response.refreshToken,
          isVerified: false
        });
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Failed to request code');
        throw error;
      } finally {
        setLoading(false);
      }
    },

    async verifyEmail(email: string, code: string) {
      if (!currentState.userId) {
        throw new Error("No user ID available");
      }

      setLoading(true);
      try {
        const result = await post<AuthTokens & { success: boolean }>('verify', { 
          email, 
          code,
          userId: currentState.userId 
        });

        setAuthenticated({
          userId: result.userId,
          sessionToken: result.sessionToken,
          refreshToken: result.refreshToken,
          isVerified: true
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
      if (!currentState.userId) {
        return; // Already logged out
      }

      setLoading(true);
      try {
        await post('logout', { userId: currentState.userId });
        await this.createAnonymousUser(); // Create new anonymous user after logout
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Failed to logout');
        throw error;
      } finally {
        setLoading(false);
      }
    },

    async refresh() {
      if (!currentState.refreshToken || !currentState.userId) {
        throw new Error("No refresh token available");
      }

      setLoading(true);
      try {
        const response = await post<AuthTokens>('refresh');
        setAuthenticated({
          userId: response.userId,
          sessionToken: response.sessionToken,
          refreshToken: response.refreshToken,
          isVerified: currentState.isVerified
        });
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Failed to refresh token');
        throw error;
      } finally {
        setLoading(false);
      }
    }
  };
}
