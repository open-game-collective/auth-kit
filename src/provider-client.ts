import { LinkedAccount, ProviderAuthClient, ProviderAuthState } from "./types";

interface ProviderAuthClientConfig {
  host: string;
  userId: string;
  sessionToken: string;
  initialState?: Partial<ProviderAuthState>;
}

/**
 * Creates a provider auth client for managing account linking functionality
 */
export function createProviderAuthClient(config: ProviderAuthClientConfig): ProviderAuthClient {
  // Default state
  const defaultState: ProviderAuthState = {
    userId: config.userId,
    sessionToken: config.sessionToken,
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
  const setState = (updater: (draft: ProviderAuthState) => void) => {
    const newState = { ...state };
    updater(newState);
    state = newState;
    for (const callback of subscribers) {
      callback(state);
    }
  };

  // API request helper
  const apiRequest = async <T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    requestId?: string
  ): Promise<T> => {
    // Ensure the host has a protocol
    const host =
      config.host.startsWith("http://") || config.host.startsWith("https://")
        ? config.host
        : `http://${config.host}`;

    // Set loading state
    if (requestId) {
      setState((draft) => {
        draft.requests = {
          ...draft.requests,
          [requestId]: {
            isLoading: true,
            error: null,
            lastUpdated: new Date().toISOString(),
          },
        };
      });
    } else {
      setState((draft) => {
        draft.isLoading = true;
        draft.error = null;
      });
    }

    try {
      const response = await fetch(`${host}/${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${state.sessionToken}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: "Unknown error" }));
        throw new Error(errorData.message || `API error: ${response.status}`);
      }

      const data = await response.json();

      // Clear loading state
      if (requestId) {
        setState((draft) => {
          draft.requests = {
            ...draft.requests,
            [requestId]: {
              isLoading: false,
              error: null,
              lastUpdated: new Date().toISOString(),
            },
          };
        });
      } else {
        setState((draft) => {
          draft.isLoading = false;
        });
      }

      return data;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      // Set error state
      if (requestId) {
        setState((draft) => {
          draft.requests = {
            ...draft.requests,
            [requestId]: {
              isLoading: false,
              error: errorMessage,
              lastUpdated: new Date().toISOString(),
            },
          };
        });
      } else {
        setState((draft) => {
          draft.isLoading = false;
          draft.error = errorMessage;
        });
      }

      throw error;
    }
  };

  // Create the client
  return {
    getState() {
      return state;
    },

    subscribe(callback) {
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
      const requestId = "getLinkedAccounts";

      const accounts = await apiRequest<LinkedAccount[]>(
        "GET",
        "linked-accounts",
        undefined,
        requestId
      );

      setState((draft) => {
        draft.linkedAccounts = accounts;
      });

      return accounts;
    },

    async initiateAccountLinking(gameId: string) {
      const requestId = `initiateAccountLinking:${gameId}`;

      const result = await apiRequest<{
        linkToken: string;
        expiresAt: string;
      }>("POST", "account-link-token", { gameId }, requestId);

      return result;
    },

    async unlinkAccount(gameId: string) {
      const requestId = `unlinkAccount:${gameId}`;

      try {
        await apiRequest<{ success: boolean }>(
          "DELETE",
          `linked-accounts/${gameId}`,
          undefined,
          requestId
        );

        setState((draft) => {
          draft.linkedAccounts = draft.linkedAccounts.filter(
            (account) => account.gameId !== gameId
          );
        });

        return true;
      } catch (_error) {
        return false;
      }
    },

    // Inherit base auth methods
    async requestCode(email: string) {
      await apiRequest<void>("POST", "request-code", { email });
    },

    async verifyEmail(email: string, code: string) {
      const result = await apiRequest<{
        success: boolean;
        userId?: string;
        sessionToken?: string;
      }>("POST", "verify-email", { email, code });

      if (result.success && result.sessionToken) {
        setState((draft) => {
          draft.email = email;
          draft.userId = result.userId || draft.userId;
          draft.sessionToken = result.sessionToken || null;
        });
      }

      return { success: result.success };
    },

    async logout() {
      await apiRequest<void>("POST", "logout");

      setState((draft) => {
        draft.sessionToken = null;
        draft.email = null;
        draft.linkedAccounts = [];
      });
    },

    async refresh() {
      const result = await apiRequest<{
        sessionToken: string;
      }>("POST", "refresh");

      setState((draft) => {
        draft.sessionToken = result.sessionToken;
      });
    },

    async getWebAuthCode() {
      const result = await apiRequest<{
        code: string;
        expiresIn: number;
      }>("GET", "web-auth-code");

      return result;
    },
  };
}
