import React from 'react';
import { ConsumerAuthClient, ConsumerAuthState } from './types';
import { useSyncExternalStoreWithSelector } from './react';

export function createConsumerAuthContext() {
  const context = React.createContext<ConsumerAuthClient | null>(null);
  
  if (process.env.NODE_ENV !== 'production') {
    context.displayName = 'ConsumerAuthContext';
  }
  
  function useClient(): ConsumerAuthClient {
    const value = React.useContext(context);
    if (value === null) {
      throw new Error('useConsumerAuthClient must be used within a ConsumerAuthProvider');
    }
    return value;
  }
  
  function useSelector<T>(selector: (state: ConsumerAuthState) => T) {
    const client = useClient();
    
    return useSyncExternalStoreWithSelector(
      client.subscribe,
      client.getState,
      null,
      selector
    );
  }
  
  function LinkedWithOpenGame({ children }: { children: React.ReactNode }) {
    const isLinked = useSelector(state => !!state.openGameLink);
    return isLinked ? <>{children}</> : null;
  }
  
  function NotLinkedWithOpenGame({ children }: { children: React.ReactNode }) {
    const isLinked = useSelector(state => !!state.openGameLink);
    return !isLinked ? <>{children}</> : null;
  }
  
  function OpenGameProfile({
    render
  }: {
    render: (props: {
      profile: Record<string, any> | undefined,
      isLoading: boolean,
      error: string | null
    }) => React.ReactNode
  }) {
    const openGameLink = useSelector(state => state.openGameLink);
    const requestState = useSelector(state => state.requests['getOpenGameLinkStatus'] || {
      isLoading: false,
      error: null,
      lastUpdated: null
    });
    
    return <>{render({
      profile: openGameLink?.profile,
      isLoading: requestState.isLoading,
      error: requestState.error
    })}</>;
  }
  
  function VerifyLinkToken({
    token,
    render
  }: {
    token: string,
    render: (props: {
      isVerifying: boolean,
      isValid: boolean,
      openGameUserId?: string,
      email?: string,
      error: string | null
    }) => React.ReactNode
  }) {
    const client = useClient();
    const [state, setState] = React.useState<{
      isVerifying: boolean,
      isValid: boolean,
      openGameUserId?: string,
      email?: string,
      error: string | null
    }>({
      isVerifying: true,
      isValid: false,
      error: null
    });
    
    React.useEffect(() => {
      async function verifyToken() {
        try {
          setState(prev => ({ ...prev, isVerifying: true, error: null }));
          const result = await client.verifyLinkToken(token);
          
          if (result.valid) {
            setState({
              isVerifying: false,
              isValid: true,
              openGameUserId: result.openGameUserId,
              email: result.email,
              error: null
            });
          } else {
            setState({
              isVerifying: false,
              isValid: false,
              error: null
            });
          }
        } catch (error) {
          setState({
            isVerifying: false,
            isValid: false,
            error: error instanceof Error ? error.message : 'Failed to verify token'
          });
        }
      }
      
      verifyToken();
    }, [client, token]);
    
    return <>{render(state)}</>;
  }
  
  function ConfirmLink({
    token,
    gameUserId,
    render
  }: {
    token: string,
    gameUserId: string,
    render: (props: {
      onConfirm: () => Promise<boolean>,
      isConfirming: boolean,
      isConfirmed: boolean,
      error: string | null
    }) => React.ReactNode
  }) {
    const client = useClient();
    const [state, setState] = React.useState<{
      isConfirming: boolean,
      isConfirmed: boolean,
      error: string | null
    }>({
      isConfirming: false,
      isConfirmed: false,
      error: null
    });
    
    const onConfirm = React.useCallback(async () => {
      try {
        setState(prev => ({ ...prev, isConfirming: true, error: null }));
        const success = await client.confirmLink(token, gameUserId);
        
        setState({
          isConfirming: false,
          isConfirmed: success,
          error: success ? null : 'Failed to confirm link'
        });
        
        return success;
      } catch (error) {
        setState({
          isConfirming: false,
          isConfirmed: false,
          error: error instanceof Error ? error.message : 'Failed to confirm link'
        });
        return false;
      }
    }, [client, token, gameUserId]);
    
    return <>{render({
      onConfirm,
      isConfirming: state.isConfirming,
      isConfirmed: state.isConfirmed,
      error: state.error
    })}</>;
  }
  
  return {
    Provider: context.Provider,
    useClient,
    useSelector,
    LinkedWithOpenGame,
    NotLinkedWithOpenGame,
    OpenGameProfile,
    VerifyLinkToken,
    ConfirmLink
  };
}

function defaultCompare<T>(a: T, b: T) {
  return Object.is(a, b);
} 