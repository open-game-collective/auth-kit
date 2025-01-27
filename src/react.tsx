import React, {
  createContext,
  memo,
  ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import type { AuthClient } from "./client";
import type { AuthState } from "./types";

export function createAuthContext() {
  const AuthContext = createContext<AuthClient | null>(null);

  const Provider = memo(({ 
    children, 
    client,
    initializing 
  }: { 
    children: ReactNode;
    client: AuthClient;
    initializing?: ReactNode;
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
    if (!client) {
      throw new Error("useClient must be used within an AuthContext.Provider");
    }
    return client;
  }

  function useSelector<T>(selector: (state: AuthState) => T) {
    const client = useClient();
    return useSyncExternalStoreWithSelector(
      client.subscribe,
      client.getState,
      client.getState,
      selector,
      defaultCompare
    );
  }

  function useAuth() {
    const client = useClient();
    const state = useSelector(state => state);

    const methods = useMemo(() => ({
      requestCode: client.requestCode.bind(client),
      verifyEmail: client.verifyEmail.bind(client),
      logout: client.logout.bind(client),
      refresh: client.refresh.bind(client),
    }), [client]);

    return {
      ...state,
      ...methods
    };
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
    const isAuthenticated = useSelector(state => state.userId !== null);
    return isAuthenticated ? <>{children}</> : null;
  });
  Authenticated.displayName = "AuthAuthenticated";

  return {
    Provider,
    useClient,
    useSelector,
    useAuth,
    Loading,
    Verified,
    Unverified,
    Authenticated,
  };
}

function useSyncExternalStoreWithSelector<Snapshot, Selection>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => Snapshot,
  getServerSnapshot: undefined | null | (() => Snapshot),
  selector: (snapshot: Snapshot) => Selection,
  isEqual?: (a: Selection, b: Selection) => boolean
): Selection {
  const [getSelection, getServerSelection] = useMemo(() => {
    let hasMemo = false;
    let memoizedSnapshot: Snapshot;
    let memoizedSelection: Selection;

    const memoizedSelector = (nextSnapshot: Snapshot) => {
      if (!hasMemo) {
        hasMemo = true;
        memoizedSnapshot = nextSnapshot;
        memoizedSelection = selector(nextSnapshot);
        return memoizedSelection;
      }

      if (Object.is(memoizedSnapshot, nextSnapshot)) {
        return memoizedSelection;
      }

      const nextSelection = selector(nextSnapshot);

      if (isEqual && isEqual(memoizedSelection, nextSelection)) {
        memoizedSnapshot = nextSnapshot;
        return memoizedSelection;
      }

      memoizedSnapshot = nextSnapshot;
      memoizedSelection = nextSelection;
      return nextSelection;
    };

    const getSnapshotWithSelector = () => memoizedSelector(getSnapshot());
    const getServerSnapshotWithSelector = getServerSnapshot
      ? () => memoizedSelector(getServerSnapshot())
      : undefined;

    return [getSnapshotWithSelector, getServerSnapshotWithSelector];
  }, [getSnapshot, getServerSnapshot, selector, isEqual]);

  const subscribeWithSelector = useCallback(
    (onStoreChange: () => void) => {
      let previousSelection = getSelection();
      return subscribe(() => {
        const nextSelection = getSelection();
        if (!isEqual || !isEqual(previousSelection, nextSelection)) {
          previousSelection = nextSelection;
          onStoreChange();
        }
      });
    },
    [subscribe, getSelection, isEqual]
  );

  return useSyncExternalStore(
    subscribeWithSelector,
    getSelection,
    getServerSelection
  );
}

function defaultCompare<T>(a: T, b: T) {
  return a === b;
}
