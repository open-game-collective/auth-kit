import {
  AuthClient,
  AuthState,
  ConsumerAuthClient,
  ConsumerAuthState,
  ProviderAuthClient,
  ProviderAuthState,
} from "./types";

/**
 * Creates a mock auth client for testing.
 * Uses a produce pattern for state updates, similar to immer.
 */
export function createAuthMockClient(config: {
  initialState: Partial<AuthState>;
}): AuthClient & {
  produce: (recipe: (draft: AuthState) => void) => void;
} {
  // Default state
  const defaultState: AuthState = {
    userId: "",
    sessionToken: null,
    email: null,
    isLoading: false,
    error: null,
  };

  // Merge with provided initial state
  let state: AuthState = {
    ...defaultState,
    ...config.initialState,
  };

  // Subscribers
  const subscribers: ((state: AuthState) => void)[] = [];

  // State updater
  const produce = (recipe: (draft: AuthState) => void) => {
    const newState = { ...state };
    recipe(newState);
    state = newState;
    for (const callback of subscribers) {
      callback(state);
    }
  };

  // Mock client
  return {
    getState() {
      return state;
    },
    subscribe(callback: (state: AuthState) => void) {
      subscribers.push(callback);
      callback(state);
      return () => {
        const index = subscribers.indexOf(callback);
        if (index !== -1) {
          subscribers.splice(index, 1);
        }
      };
    },
    async requestCode(_email: string) {
      produce((draft) => {
        draft.isLoading = true;
        draft.error = null;
      });

      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 100));

      produce((draft) => {
        draft.isLoading = false;
      });
    },
    async verifyEmail(email: string, code: string) {
      produce((draft) => {
        draft.isLoading = true;
        draft.error = null;
      });

      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 100));

      if (code === "123456") {
        produce((draft) => {
          draft.isLoading = false;
          draft.email = email;
        });
        return { success: true };
      }
      produce((draft) => {
        draft.isLoading = false;
        draft.error = "Invalid verification code";
      });
      return { success: false };
    },
    async logout() {
      produce((draft) => {
        draft.isLoading = true;
        draft.error = null;
      });

      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 100));

      produce((draft) => {
        draft.isLoading = false;
        draft.email = null;
        draft.sessionToken = null;
      });
    },
    async refresh() {
      produce((draft) => {
        draft.isLoading = true;
        draft.error = null;
      });

      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 100));

      produce((draft) => {
        draft.isLoading = false;
        draft.sessionToken = "refreshed-token";
      });
    },
    async getWebAuthCode() {
      produce((draft) => {
        draft.isLoading = true;
        draft.error = null;
      });

      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 100));

      produce((draft) => {
        draft.isLoading = false;
      });

      return {
        code: "mock-web-auth-code",
        expiresIn: 300,
      };
    },
    produce,
  };
}

export function createProviderAuthMockClient(config: {
  initialState: Partial<ProviderAuthState>;
}): ProviderAuthClient & {
  produce: (recipe: (draft: ProviderAuthState) => void) => void;
} {
  // Default provider state
  const defaultState: ProviderAuthState = {
    userId: "",
    sessionToken: null,
    email: null,
    isLoading: false,
    error: null,
    linkedAccounts: [],
    requests: {},
  };

  // Merge with provided initial state
  let state: ProviderAuthState = {
    ...defaultState,
    ...config.initialState,
  };

  // Subscribers
  const subscribers: ((state: ProviderAuthState) => void)[] = [];

  // State updater
  const produce = (recipe: (draft: ProviderAuthState) => void) => {
    const newState = { ...state };
    recipe(newState);
    state = newState;
    for (const callback of subscribers) {
      callback(state);
    }
  };

  // Create base client
  const baseClient = createAuthMockClient({
    initialState: config.initialState,
  });

  // Mock provider client
  return {
    ...baseClient,
    getState() {
      return state;
    },
    subscribe(callback: (state: ProviderAuthState) => void) {
      subscribers.push(callback);
      callback(state);
      return () => {
        const index = subscribers.indexOf(callback);
        if (index !== -1) {
          subscribers.splice(index, 1);
        }
      };
    },
    async getLinkedAccounts() {
      produce((draft) => {
        draft.requests = {
          ...draft.requests,
          getLinkedAccounts: {
            isLoading: true,
            error: null,
            lastUpdated: new Date().toISOString(),
          },
        };
      });

      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 100));

      produce((draft) => {
        draft.requests = {
          ...draft.requests,
          getLinkedAccounts: {
            isLoading: false,
            error: null,
            lastUpdated: new Date().toISOString(),
          },
        };
      });

      return state.linkedAccounts;
    },
    async initiateAccountLinking(gameId: string) {
      const requestId = `initiateAccountLinking:${gameId}`;

      produce((draft) => {
        draft.requests = {
          ...draft.requests,
          [requestId]: {
            isLoading: true,
            error: null,
            lastUpdated: new Date().toISOString(),
          },
        };
      });

      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 100));

      produce((draft) => {
        draft.requests = {
          ...draft.requests,
          [requestId]: {
            isLoading: false,
            error: null,
            lastUpdated: new Date().toISOString(),
          },
        };
      });

      return {
        linkToken: "mock-link-token",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      };
    },
    async unlinkAccount(gameId: string) {
      const requestId = `unlinkAccount:${gameId}`;

      produce((draft) => {
        draft.requests = {
          ...draft.requests,
          [requestId]: {
            isLoading: true,
            error: null,
            lastUpdated: new Date().toISOString(),
          },
        };
      });

      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 100));

      produce((draft) => {
        draft.linkedAccounts = draft.linkedAccounts.filter((account) => account.gameId !== gameId);

        draft.requests = {
          ...draft.requests,
          [requestId]: {
            isLoading: false,
            error: null,
            lastUpdated: new Date().toISOString(),
          },
        };
      });

      return true;
    },
    produce,
  };
}

export function createConsumerAuthMockClient(config: {
  initialState: Partial<ConsumerAuthState>;
}): ConsumerAuthClient & {
  produce: (recipe: (draft: ConsumerAuthState) => void) => void;
} {
  // Default consumer state
  const defaultState: ConsumerAuthState = {
    userId: "",
    sessionToken: null,
    email: null,
    isLoading: false,
    error: null,
    openGameLink: undefined,
    requests: {},
  };

  // Merge with provided initial state
  let state: ConsumerAuthState = {
    ...defaultState,
    ...config.initialState,
  };

  // Subscribers
  const subscribers: ((state: ConsumerAuthState) => void)[] = [];

  // State updater
  const produce = (recipe: (draft: ConsumerAuthState) => void) => {
    const newState = { ...state };
    recipe(newState);
    state = newState;
    for (const callback of subscribers) {
      callback(state);
    }
  };

  // Create base client
  const baseClient = createAuthMockClient({
    initialState: config.initialState,
  });

  // Mock consumer client
  return {
    ...baseClient,
    getState() {
      return state;
    },
    subscribe(callback: (state: ConsumerAuthState) => void) {
      subscribers.push(callback);
      callback(state);
      return () => {
        const index = subscribers.indexOf(callback);
        if (index !== -1) {
          subscribers.splice(index, 1);
        }
      };
    },
    async getOpenGameLinkStatus() {
      produce((draft) => {
        draft.requests = {
          ...draft.requests,
          getOpenGameLinkStatus: {
            isLoading: true,
            error: null,
            lastUpdated: new Date().toISOString(),
          },
        };
      });

      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 100));

      produce((draft) => {
        draft.requests = {
          ...draft.requests,
          getOpenGameLinkStatus: {
            isLoading: false,
            error: null,
            lastUpdated: new Date().toISOString(),
          },
        };
      });

      if (state.openGameLink) {
        return {
          isLinked: true,
          openGameUserId: state.openGameLink.openGameUserId,
          linkedAt: state.openGameLink.linkedAt,
          profile: state.openGameLink.profile,
        };
      }
      return { isLinked: false };
    },
    async verifyLinkToken(token: string) {
      produce((draft) => {
        draft.requests = {
          ...draft.requests,
          verifyLinkToken: {
            isLoading: true,
            error: null,
            lastUpdated: new Date().toISOString(),
          },
        };
      });

      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 100));

      produce((draft) => {
        draft.requests = {
          ...draft.requests,
          verifyLinkToken: {
            isLoading: false,
            error: null,
            lastUpdated: new Date().toISOString(),
          },
        };
      });

      // Mock implementation - consider token valid if it starts with "valid-"
      if (token.startsWith("valid-")) {
        return {
          valid: true,
          openGameUserId: "og-user-123",
          email: "user@example.com",
        };
      }
      return { valid: false };
    },
    async confirmLink(token: string, _gameUserId: string) {
      produce((draft) => {
        draft.requests = {
          ...draft.requests,
          confirmLink: {
            isLoading: true,
            error: null,
            lastUpdated: new Date().toISOString(),
          },
        };
      });

      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Mock implementation - consider token valid if it starts with "valid-"
      if (token.startsWith("valid-")) {
        produce((draft) => {
          draft.openGameLink = {
            openGameUserId: "og-user-123",
            linkedAt: new Date().toISOString(),
          };

          draft.requests = {
            ...draft.requests,
            confirmLink: {
              isLoading: false,
              error: null,
              lastUpdated: new Date().toISOString(),
            },
          };
        });

        return true;
      }
      produce((draft) => {
        draft.requests = {
          ...draft.requests,
          confirmLink: {
            isLoading: false,
            error: "Invalid token",
            lastUpdated: new Date().toISOString(),
          },
        };
      });

      throw new Error("Invalid token");
    },
    produce,
  };
}
