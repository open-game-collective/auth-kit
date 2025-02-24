import React, {
  createContext,
  memo,
  ReactNode,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore
} from "react";
import type { AuthClient } from "./client";
import type { AuthState } from "./types";

export function createAuthContext() {
  // Create a dummy client that throws on any method call
  const throwClient = new Proxy({} as AuthClient, {
    get() {
      throw new Error(
        "AuthClient not found in context. Did you forget to wrap your app in <AuthContext.Provider client={...}>?"
      );
    },
  });

  const AuthContext = createContext<AuthClient>(throwClient);

  const Provider = memo(({ 
    children, 
    client 
  }: { 
    children: ReactNode;
    client: AuthClient;
  }) => {
    return (
      <AuthContext.Provider value={client}>
        {children}
      </AuthContext.Provider>
    );
  });
  Provider.displayName = "AuthProvider";

  function useClient(): AuthClient {
    const client = useContext(AuthContext);
    return client;
  }

  function useSelector<T>(selector: (state: AuthState) => T) {
    const client = useClient();
    const memoizedSelector = useMemo(() => selector, [selector]);
    return useSyncExternalStoreWithSelector(
      client.subscribe,
      client.getState,
      client.getState,
      memoizedSelector,
      defaultCompare
    );
  }

  const Loading = memo(({ children }: { children: ReactNode }) => {
    const isLoading = useSelector(state => state.isLoading);
    return isLoading ? <>{children}</> : null;
  });
  Loading.displayName = "AuthLoading";

  const Verified = memo(({ children }: { children: ReactNode }) => {
    const isVerified = useSelector(state => state.isVerified);
    return isVerified ? <>{children}</> : null;
  });
  Verified.displayName = "AuthVerified";

  const Unverified = memo(({ children }: { children: ReactNode }) => {
    const isVerified = useSelector(state => state.isVerified);
    return !isVerified ? <>{children}</> : null;
  });
  Unverified.displayName = "AuthUnverified";

  const Authenticated = memo(({ children }: { children: ReactNode }) => {
    const isAuthenticated = useSelector(state => Boolean(state.userId));
    return isAuthenticated ? <>{children}</> : null;
  });
  Authenticated.displayName = "AuthAuthenticated";

  return {
    Provider,
    useClient,
    useSelector,
    Loading,
    Verified,
    Unverified,
    Authenticated,
  };
}

function defaultCompare<T>(a: T, b: T) {
  return a === b;
}

function useSyncExternalStoreWithSelector<Snapshot, Selection>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => Snapshot,
  getServerSnapshot: undefined | null | (() => Snapshot),
  selector: (snapshot: Snapshot) => Selection,
  isEqual?: (a: Selection, b: Selection) => boolean
): Selection {
  const lastSelection = useMemo(() => ({
    value: null as Selection | null
  }), []);

  const getSelection = useCallback(() => {
    const nextSnapshot = getSnapshot();
    const nextSelection = selector(nextSnapshot);

    // If we have a previous selection and it's equal to the next selection, return the previous
    if (lastSelection.value !== null && isEqual?.(lastSelection.value, nextSelection)) {
      return lastSelection.value;
    }

    // Otherwise store and return the new selection
    lastSelection.value = nextSelection;
    return nextSelection;
  }, [getSnapshot, selector, isEqual]);

  return useSyncExternalStore(
    subscribe,
    getSelection,
    getServerSnapshot ? () => selector(getServerSnapshot()) : undefined
  );
}
