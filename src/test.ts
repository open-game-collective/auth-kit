import { vi } from 'vitest';
import type { AuthClient, AuthState, AuthClientConfig } from "./types";

/**
 * Creates a mock auth client for testing.
 * All methods are Jest spies and state changes are synchronous.
 */
export function createAuthMockClient(config: {
  initialState: AuthState;
}): AuthClient & {
  setState(state: Partial<AuthState>): void;
} {
  let currentState = config.initialState;
  const listeners = new Set<(state: AuthState) => void>();

  const setState = (newState: Partial<AuthState>) => {
    currentState = { ...currentState, ...newState };
    listeners.forEach(l => l(currentState));
  };

  const client = {
    getState: () => currentState,
    subscribe: (listener: (state: AuthState) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    requestCode: vi.fn(async (email: string) => {
      setState({ isLoading: true });
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 0));
      setState({ 
        isLoading: false,
        error: undefined
      });
    }),
    verifyEmail: vi.fn(async (email: string, code: string) => {
      setState({ isLoading: true });
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 0));
      setState({
        isLoading: false,
        isVerified: true,
        error: undefined
      });
      return { success: true };
    }),
    logout: vi.fn(async () => {
      setState({ isLoading: true });
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 0));
      setState({
        isLoading: false,
        userId: '',
        sessionToken: '',
        refreshToken: null,
        isVerified: false,
        error: undefined
      });
    }),
    refresh: vi.fn(async () => {
      setState({ isLoading: true });
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 0));
      setState({
        isLoading: false,
        error: undefined
      });
    }),
    setState
  };

  return client;
}
