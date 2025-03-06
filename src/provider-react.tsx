import React from 'react';
import { ProviderAuthClient, ProviderAuthState, LinkedAccount } from './types';
import { useSyncExternalStoreWithSelector } from './react';

export function createProviderAuthContext() {
  const context = React.createContext<ProviderAuthClient | null>(null);
  
  if (process.env.NODE_ENV !== 'production') {
    context.displayName = 'ProviderAuthContext';
  }
  
  function useClient(): ProviderAuthClient {
    const value = React.useContext(context);
    if (value === null) {
      throw new Error('useProviderAuthClient must be used within a ProviderAuthProvider');
    }
    return value;
  }
  
  function useSelector<T>(selector: (state: ProviderAuthState) => T) {
    const client = useClient();
    
    return useSyncExternalStoreWithSelector(
      client.subscribe,
      client.getState,
      null,
      selector
    );
  }
  
  function LinkedAccounts({ children }: { children: React.ReactNode }) {
    const hasLinkedAccounts = useSelector(state => state.linkedAccounts.length > 0);
    return hasLinkedAccounts ? <>{children}</> : null;
  }
  
  function NoLinkedAccounts({ children }: { children: React.ReactNode }) {
    const hasLinkedAccounts = useSelector(state => state.linkedAccounts.length > 0);
    return !hasLinkedAccounts ? <>{children}</> : null;
  }
  
  function LinkedAccountsList({ 
    render 
  }: { 
    render: (props: { 
      accounts: LinkedAccount[],
      isLoading: boolean,
      error: string | null
    }) => React.ReactNode 
  }) {
    const accounts = useSelector(state => state.linkedAccounts);
    const requestState = useSelector(state => state.requests['getLinkedAccounts'] || {
      isLoading: false,
      error: null,
      lastUpdated: null
    });
    
    return <>{render({
      accounts,
      isLoading: requestState.isLoading,
      error: requestState.error
    })}</>;
  }
  
  function InitiateLinking({
    gameId,
    render
  }: {
    gameId: string,
    render: (props: {
      onInitiate: () => Promise<{ linkToken: string; expiresAt: string }>,
      isInitiating: boolean,
      error: string | null
    }) => React.ReactNode
  }) {
    const client = useClient();
    const requestState = useSelector(state => state.requests['initiateAccountLinking'] || {
      isLoading: false,
      error: null,
      lastUpdated: null
    });
    
    const onInitiate = React.useCallback(async () => {
      return await client.initiateAccountLinking(gameId);
    }, [client, gameId]);
    
    return <>{render({
      onInitiate,
      isInitiating: requestState.isLoading,
      error: requestState.error
    })}</>;
  }
  
  function UnlinkAccount({
    gameId,
    render
  }: {
    gameId: string,
    render: (props: {
      onUnlink: () => Promise<boolean>,
      isUnlinking: boolean,
      error: string | null
    }) => React.ReactNode
  }) {
    const client = useClient();
    const requestState = useSelector(state => state.requests['unlinkAccount'] || {
      isLoading: false,
      error: null,
      lastUpdated: null
    });
    
    const onUnlink = React.useCallback(async () => {
      return await client.unlinkAccount(gameId);
    }, [client, gameId]);
    
    return <>{render({
      onUnlink,
      isUnlinking: requestState.isLoading,
      error: requestState.error
    })}</>;
  }
  
  return {
    Provider: context.Provider,
    useClient,
    useSelector,
    LinkedAccounts,
    NoLinkedAccounts,
    LinkedAccountsList,
    InitiateLinking,
    UnlinkAccount
  };
}

function defaultCompare<T>(a: T, b: T) {
  return Object.is(a, b);
} 