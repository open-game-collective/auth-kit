import type { AuthClient, AuthState } from "./types";

/**
 * Creates a mock auth client for testing.
 * Uses a produce pattern for state updates, similar to immer.
 */
export function createAuthMockClient(config: {
  initialState: Partial<AuthState>;
}): AuthClient & {
  produce: (recipe: (draft: AuthState) => void) => void;
} {
  const defaultState: AuthState = {
    isLoading: false,
    userId: '',
    sessionToken: '',
    email: null,
    error: null
  };

  let currentState = { ...defaultState, ...config.initialState };
  const listeners = new Set<(state: AuthState) => void>();

  const produce = (recipe: (draft: AuthState) => void) => {
    const nextState = { ...currentState };
    recipe(nextState);
    currentState = nextState;
    listeners.forEach(l => l(currentState));
  };

  const client = {
    getState: () => currentState,
    subscribe: (listener: (state: AuthState) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    requestCode: async (email: string) => {
      throw new Error('requestCode not implemented - you need to mock this method');
    },
    verifyEmail: async (email: string, code: string) => {
      throw new Error('verifyEmail not implemented - you need to mock this method');
    },
    logout: async () => {
      throw new Error('logout not implemented - you need to mock this method');
    },
    refresh: async () => {
      throw new Error('refresh not implemented - you need to mock this method');
    },
    getWebAuthCode: async () => {
      throw new Error('getWebAuthCode not implemented - you need to mock this method');
    },
    produce
  };

  return client;
}
