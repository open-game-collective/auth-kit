import React, {
  createContext,
  memo,
  ReactNode,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  useEffect,
  useRef,
  useState
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
      null,
      memoizedSelector
    );
  }

  const Loading = memo(({ children }: { children: ReactNode }) => {
    const isLoading = useSelector(state => state.isLoading);
    return isLoading ? <>{children}</> : null;
  });
  Loading.displayName = "AuthLoading";

  const Verified = memo(({ children }: { children: ReactNode }) => {
    const hasEmail = useSelector(state => Boolean(state.email));
    return hasEmail ? <>{children}</> : null;
  });
  Verified.displayName = "AuthVerified";

  const Unverified = memo(({ children }: { children: ReactNode }) => {
    const hasEmail = useSelector(state => Boolean(state.email));
    return !hasEmail ? <>{children}</> : null;
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

/**
 * Default comparison function for useSyncExternalStoreWithSelector
 */
function defaultCompare<T>(a: T, b: T) {
  return Object.is(a, b);
}

/**
 * Hook to subscribe to an external store with selector
 */
export function useSyncExternalStoreWithSelector<Snapshot, Selection>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => Snapshot,
  getServerSnapshot: undefined | null | (() => Snapshot),
  selector: (snapshot: Snapshot) => Selection,
  isEqual?: (a: Selection, b: Selection) => boolean
): Selection {
  const compareFunction = isEqual || defaultCompare;
  const [state, setState] = useState(() => selector(getSnapshot()));
  const stateRef = useRef(state);
  const snapshotRef = useRef<Snapshot>();
  
  useEffect(() => {
    const checkForUpdates = () => {
      try {
        const nextSnapshot = getSnapshot();
        
        // Avoid recomputing if the snapshot hasn't changed
        if (snapshotRef.current === nextSnapshot) {
          return;
        }
        
        snapshotRef.current = nextSnapshot;
        const nextState = selector(nextSnapshot);
        
        // Only update if the selected state has changed
        if (!compareFunction(stateRef.current, nextState)) {
          setState(nextState);
          stateRef.current = nextState;
        }
      } catch (error) {
        console.error('Error in checkForUpdates:', error);
      }
    };
    
    // Check for updates immediately
    checkForUpdates();
    
    // Subscribe to store changes
    return subscribe(checkForUpdates);
  }, [subscribe, getSnapshot, selector, compareFunction]);
  
  return state;
}
