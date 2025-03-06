import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { createConsumerAuthContext } from './consumer-react';
import { createConsumerAuthMockClient } from './test';
import React from 'react';
import type { ConsumerAuthState, OpenGameLink } from './types';

describe('Consumer Auth Context', () => {
  describe('useClient', () => {
    it('should provide access to the auth client', () => {
      const mockClient = createConsumerAuthMockClient({
        initialState: {
          userId: 'test-user',
          sessionToken: 'test-token',
          email: 'test@example.com',
          isLoading: false,
          error: null,
          openGameLink: undefined,
          requests: {}
        }
      });
      
      const AuthContext = createConsumerAuthContext();
      
      const TestComponent = () => {
        const client = AuthContext.useClient();
        return <div data-testid="user-id">{client.getState().userId}</div>;
      };
      
      render(
        <AuthContext.Provider value={mockClient}>
          <TestComponent />
        </AuthContext.Provider>
      );
      
      expect(screen.getByTestId('user-id').textContent).toBe('test-user');
    });
  });
  
  describe('useSelector', () => {
    it('should select and subscribe to state changes', async () => {
      const mockClient = createConsumerAuthMockClient({
        initialState: {
          userId: 'test-user',
          sessionToken: 'test-token',
          email: 'test@example.com',
          isLoading: false,
          error: null,
          openGameLink: undefined,
          requests: {}
        }
      });
      
      const AuthContext = createConsumerAuthContext();
      
      const TestComponent = () => {
        const userId = AuthContext.useSelector(state => state.userId);
        const isLinked = AuthContext.useSelector(state => !!state.openGameLink);
        
        return (
          <div>
            <div data-testid="user-id">{userId}</div>
            <div data-testid="is-linked">{isLinked ? 'Linked' : 'Not Linked'}</div>
          </div>
        );
      };
      
      render(
        <AuthContext.Provider value={mockClient}>
          <TestComponent />
        </AuthContext.Provider>
      );
      
      expect(screen.getByTestId('user-id').textContent).toBe('test-user');
      expect(screen.getByTestId('is-linked').textContent).toBe('Not Linked');
      
      // Update state
      act(() => {
        mockClient.produce(draft => {
          draft.openGameLink = {
            openGameUserId: 'og-user-123',
            linkedAt: '2023-01-01T00:00:00Z',
            profile: {
              displayName: 'Test User'
            }
          };
        });
      });
      
      expect(screen.getByTestId('is-linked').textContent).toBe('Linked');
    });
  });
  
  describe('LinkedWithOpenGame and NotLinkedWithOpenGame', () => {
    it('should conditionally render based on link status', async () => {
      const mockClient = createConsumerAuthMockClient({
        initialState: {
          userId: 'test-user',
          sessionToken: 'test-token',
          email: 'test@example.com',
          isLoading: false,
          error: null,
          openGameLink: undefined,
          requests: {}
        }
      });
      
      const AuthContext = createConsumerAuthContext();
      
      const TestComponent = () => {
        return (
          <div>
            <AuthContext.LinkedWithOpenGame>
              <div data-testid="is-linked">Linked with OpenGame</div>
            </AuthContext.LinkedWithOpenGame>
            <AuthContext.NotLinkedWithOpenGame>
              <div data-testid="not-linked">Not linked with OpenGame</div>
            </AuthContext.NotLinkedWithOpenGame>
          </div>
        );
      };
      
      render(
        <AuthContext.Provider value={mockClient}>
          <TestComponent />
        </AuthContext.Provider>
      );
      
      // Initially not linked
      expect(screen.queryByTestId('is-linked')).toBeNull();
      expect(screen.getByTestId('not-linked')).toBeInTheDocument();
      
      // Add link
      act(() => {
        mockClient.produce(draft => {
          draft.openGameLink = {
            openGameUserId: 'og-user-123',
            linkedAt: '2023-01-01T00:00:00Z'
          };
        });
      });
      
      // Now should show linked
      expect(screen.getByTestId('is-linked')).toBeInTheDocument();
      expect(screen.queryByTestId('not-linked')).toBeNull();
    });
  });
  
  describe('OpenGameProfile', () => {
    it('should render OpenGame profile information', async () => {
      const mockClient = createConsumerAuthMockClient({
        initialState: {
          userId: 'test-user',
          sessionToken: 'test-token',
          email: 'test@example.com',
          isLoading: false,
          error: null,
          openGameLink: {
            openGameUserId: 'og-user-123',
            linkedAt: '2023-01-01T00:00:00Z',
            profile: {
              displayName: 'OpenGame User',
              avatarUrl: 'https://example.com/avatar.png'
            }
          },
          requests: {}
        }
      });
      
      const AuthContext = createConsumerAuthContext();
      
      render(
        <AuthContext.Provider value={mockClient}>
          <AuthContext.OpenGameProfile
            render={({ profile, isLoading, error }) => (
              <div>
                <div data-testid="loading">{isLoading ? 'Loading' : 'Not Loading'}</div>
                <div data-testid="error">{error || 'No Error'}</div>
                <div data-testid="display-name">{profile?.displayName || 'No Name'}</div>
                <div data-testid="avatar-url">{profile?.avatarUrl || 'No Avatar'}</div>
              </div>
            )}
          />
        </AuthContext.Provider>
      );
      
      expect(screen.getByTestId('loading').textContent).toBe('Not Loading');
      expect(screen.getByTestId('error').textContent).toBe('No Error');
      expect(screen.getByTestId('display-name').textContent).toBe('OpenGame User');
      expect(screen.getByTestId('avatar-url').textContent).toBe('https://example.com/avatar.png');
    });
  });
}); 