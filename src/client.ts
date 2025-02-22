import type { AuthState, UserCredentials, AuthClient, AuthClientConfig, AnonymousUserConfig } from "./types";

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
  let state: AuthState = {
    isLoading: false,
    host: config.host,
    userId: config.userId,
    sessionToken: config.sessionToken,
    refreshToken: config.refreshToken || null,
    isVerified: false,
  };

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

  function setAuthenticated(props: {
    userId: string;
    sessionToken: string;
    refreshToken: string | null;
    isVerified: boolean;
  }) {
    setState({
      isLoading: false,
      ...props
    });
  }

  async function post<T>(path: string, body?: object): Promise<T> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      
      // Add Authorization header for refresh token if available
      if (path === 'refresh' && state.refreshToken) {
        headers['Authorization'] = `Bearer ${state.refreshToken}`;
      }

      // Add protocol if not present
      const host = state.host.startsWith('http://') || state.host.startsWith('https://')
        ? state.host
        : `http://${state.host}`;

      const response = await fetch(`${host}/auth/${path}`, {
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
      if (!state.userId) {
        return; // Already logged out
      }

      setLoading(true);
      try {
        await post('logout', { userId: state.userId });
        // Clear local state
        setState({
          ...state,
          userId: '',
          sessionToken: '',
          refreshToken: null,
          isVerified: false
        });
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Failed to logout');
        throw error;
      } finally {
        setLoading(false);
      }
    },
    async refresh() {
      if (!state.refreshToken) {
        throw new Error("No refresh token available. For web applications, token refresh is handled by the worker middleware.");
      }

      setLoading(true);
      try {
        const response = await post<UserCredentials>('refresh');
        setAuthenticated({
          userId: response.userId,
          sessionToken: response.sessionToken,
          refreshToken: response.refreshToken,
          isVerified: state.isVerified
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

// Re-export AuthClient and AuthClientConfig types from './types'
export type { AuthClient, AuthClientConfig } from "./types";
