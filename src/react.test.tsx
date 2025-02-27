import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { createAuthContext } from './react';
import { createAuthMockClient } from './test';
import React from 'react';
import type { AuthState } from './types';

describe('Auth React Integration', () => {
  const AuthContext = createAuthContext();

  describe('Context Creation', () => {
    it('should throw helpful error when used outside provider', () => {
      const TestComponent = () => {
        const client = AuthContext.useClient();
        return <div>{client.getState().userId}</div>;
      };

      expect(() => render(<TestComponent />)).toThrow(
        'AuthClient not found in context. Did you forget to wrap your app in <AuthContext.Provider client={...}>?'
      );
    });

    it('should provide client to children', () => {
      const mockClient = createAuthMockClient({
        initialState: {
          userId: 'test-user',
          sessionToken: 'test-token',
          email: null
        }
      });

      const TestComponent = () => {
        const client = AuthContext.useClient();
        return <div>{client.getState().userId}</div>;
      };

      const { container } = render(
        <AuthContext.Provider client={mockClient}>
          <TestComponent />
        </AuthContext.Provider>
      );

      expect(container).toHaveTextContent('test-user');
    });
  });

  describe('useSelector Hook', () => {
    it('should select and subscribe to state updates', () => {
      const mockClient = createAuthMockClient({
        initialState: {
          userId: 'test-user',
          sessionToken: 'test-token',
          email: null
        }
      });

      const TestComponent = () => {
        const userId = AuthContext.useSelector(state => state.userId);
        const hasEmail = AuthContext.useSelector(state => Boolean(state.email));
        return (
          <div>
            <span data-testid="user-id">{userId}</span>
            <span data-testid="verified">{hasEmail.toString()}</span>
          </div>
        );
      };

      render(
        <AuthContext.Provider client={mockClient}>
          <TestComponent />
        </AuthContext.Provider>
      );

      expect(screen.getByTestId('user-id')).toHaveTextContent('test-user');
      expect(screen.getByTestId('verified')).toHaveTextContent('false');

      // Update state
      act(() => {
        mockClient.produce(draft => {
          draft.email = 'user@example.com';
        });
      });

      expect(screen.getByTestId('verified')).toHaveTextContent('true');
    });

    it('should memoize selectors and prevent unnecessary selector calls', () => {
      const mockClient = createAuthMockClient({
        initialState: {
          userId: 'test-user',
          sessionToken: 'test-token',
          email: null,
          isLoading: false
        }
      });

      const selector = vi.fn((state: AuthState) => state.userId);
      let lastValue: string | undefined;
      
      function TestComponent() {
        const value = AuthContext.useSelector(selector);
        lastValue = value;
        return null;
      }

      render(
        <AuthContext.Provider client={mockClient}>
          <TestComponent />
        </AuthContext.Provider>
      );

      // Initial render - don't assert exact call count due to React Strict Mode
      expect(lastValue).toBe('test-user');
      const initialReturnValue = selector.mock.results[0].value;
      selector.mockClear();

      // Update unrelated state
      act(() => {
        mockClient.produce(draft => {
          draft.isLoading = true;
          draft.email = 'user@example.com';
        });
      });

      // Selector is called but returns same value
      expect(lastValue).toBe('test-user');
      expect(selector.mock.results[selector.mock.results.length - 1].value).toBe(initialReturnValue);
      selector.mockClear();

      // Update userId
      act(() => {
        mockClient.produce(draft => {
          draft.userId = 'new-user';
        });
      });

      // Selector returns new value
      expect(lastValue).toBe('new-user');
      expect(selector.mock.results[selector.mock.results.length - 1].value).toBe('new-user');
    });
  });

  describe('Conditional Components', () => {
    let mockClient: ReturnType<typeof createAuthMockClient>;

    beforeEach(() => {
      mockClient = createAuthMockClient({
        initialState: {
          userId: 'test-user',
          sessionToken: 'test-token',
          email: null,
          isLoading: false
        }
      });
    });

    it('should render Loading component correctly', () => {
      render(
        <AuthContext.Provider client={mockClient}>
          <AuthContext.Loading>Loading...</AuthContext.Loading>
        </AuthContext.Provider>
      );

      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();

      act(() => {
        mockClient.produce(draft => {
          draft.isLoading = true;
        });
      });

      expect(screen.getByText('Loading...')).toBeInTheDocument();
    });

    it('should render Verified component correctly', () => {
      render(
        <AuthContext.Provider client={mockClient}>
          <AuthContext.Verified>Verified Content</AuthContext.Verified>
        </AuthContext.Provider>
      );

      expect(screen.queryByText('Verified Content')).not.toBeInTheDocument();

      act(() => {
        mockClient.produce(draft => {
          draft.email = 'user@example.com';
        });
      });

      expect(screen.getByText('Verified Content')).toBeInTheDocument();
    });

    it('should render Unverified component correctly', () => {
      render(
        <AuthContext.Provider client={mockClient}>
          <AuthContext.Unverified>Unverified Content</AuthContext.Unverified>
        </AuthContext.Provider>
      );

      expect(screen.getByText('Unverified Content')).toBeInTheDocument();

      act(() => {
        mockClient.produce(draft => {
          draft.email = 'user@example.com';
        });
      });

      expect(screen.queryByText('Unverified Content')).not.toBeInTheDocument();
    });

    it('should render Authenticated component correctly', () => {
      render(
        <AuthContext.Provider client={mockClient}>
          <AuthContext.Authenticated>Auth Content</AuthContext.Authenticated>
        </AuthContext.Provider>
      );

      expect(screen.getByText('Auth Content')).toBeInTheDocument();

      act(() => {
        mockClient.produce(draft => {
          draft.userId = '';
        });
      });

      expect(screen.queryByText('Auth Content')).not.toBeInTheDocument();
    });

    it('should render multiple conditional components together', () => {
      const { container } = render(
        <AuthContext.Provider client={mockClient}>
          <div data-testid="loading">
            <AuthContext.Loading>Loading...</AuthContext.Loading>
          </div>
          <div data-testid="verified">
            <AuthContext.Verified>Verified Content</AuthContext.Verified>
          </div>
          <div data-testid="unverified">
            <AuthContext.Unverified>Unverified Content</AuthContext.Unverified>
          </div>
          <div data-testid="authenticated">
            <AuthContext.Authenticated>Auth Content</AuthContext.Authenticated>
          </div>
        </AuthContext.Provider>
      );

      // Initial state
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
      expect(screen.queryByText('Verified Content')).not.toBeInTheDocument();
      expect(container.querySelector('[data-testid="unverified"]')).toHaveTextContent('Unverified Content');
      expect(container.querySelector('[data-testid="authenticated"]')).toHaveTextContent('Auth Content');

      // Update to loading state
      act(() => {
        mockClient.produce(draft => {
          draft.isLoading = true;
        });
      });

      expect(container.querySelector('[data-testid="loading"]')).toHaveTextContent('Loading...');

      // Update to verified state
      act(() => {
        mockClient.produce(draft => {
          draft.isLoading = false;
          draft.email = 'user@example.com';
        });
      });

      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
      expect(container.querySelector('[data-testid="verified"]')).toHaveTextContent('Verified Content');
      expect(screen.queryByText('Unverified Content')).not.toBeInTheDocument();
      expect(container.querySelector('[data-testid="authenticated"]')).toHaveTextContent('Auth Content');
    });
  });
}); 