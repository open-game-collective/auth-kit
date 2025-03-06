import { ConsumerAuthClient, ConsumerAuthState, OpenGameLink } from './types';

interface ConsumerAuthClientConfig {
  host: string;
  userId: string;
  sessionToken: string;
  initialState?: Partial<ConsumerAuthState>;
}

/**
 * Creates a consumer auth client for managing OpenGame account linking
 */
export function createConsumerAuthClient(config: ConsumerAuthClientConfig): ConsumerAuthClient {
  // Default state
  const defaultState: ConsumerAuthState = {
    userId: config.userId,
    sessionToken: config.sessionToken,
    email: null,
    isLoading: false,
    error: null,
    openGameLink: undefined,
    requests: {}
  };

  // Merge with provided initial state
  let state: ConsumerAuthState = {
    ...defaultState,
    ...config.initialState
  };

  // Subscribers
  const subscribers: ((state: ConsumerAuthState) => void)[] = [];

  // State updater
  const setState = (updater: (draft: ConsumerAuthState) => void) => {
    const newState = { ...state };
    updater(newState);
    state = newState;
    subscribers.forEach((callback) => callback(state));
  };

  // API request helper
  const apiRequest = async <T>(
    method: string,
    path: string,
    body?: any,
    requestId?: string
  ): Promise<T> => {
    // Add protocol if not present
    const apiHost = config.host.startsWith('http://') || config.host.startsWith('https://')
      ? config.host
      : `https://${config.host}`;

    // Set loading state
    if (requestId) {
      setState(draft => {
        draft.requests = {
          ...draft.requests,
          [requestId]: {
            isLoading: true,
            error: null,
            lastUpdated: new Date().toISOString()
          }
        };
      });
    } else {
      setState(draft => {
        draft.isLoading = true;
        draft.error = null;
      });
    }

    try {
      const response = await fetch(`${apiHost}/${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.sessionToken}`
        },
        body: body ? JSON.stringify(body) : undefined
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        throw new Error(errorData.message || `API error: ${response.status}`);
      }

      const data = await response.json();

      // Clear loading state
      if (requestId) {
        setState(draft => {
          draft.requests = {
            ...draft.requests,
            [requestId]: {
              isLoading: false,
              error: null,
              lastUpdated: new Date().toISOString()
            }
          };
        });
      } else {
        setState(draft => {
          draft.isLoading = false;
        });
      }

      return data;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Set error state
      if (requestId) {
        setState(draft => {
          draft.requests = {
            ...draft.requests,
            [requestId]: {
              isLoading: false,
              error: errorMessage,
              lastUpdated: new Date().toISOString()
            }
          };
        });
      } else {
        setState(draft => {
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
    
    async getOpenGameLinkStatus() {
      const requestId = 'getOpenGameLinkStatus';
      
      const result = await apiRequest<{
        isLinked: boolean;
        openGameUserId?: string;
        linkedAt?: string;
        profile?: OpenGameLink['profile'];
      }>(
        'GET',
        'opengame-link',
        undefined,
        requestId
      );
      
      if (result.isLinked && result.openGameUserId) {
        setState(draft => {
          draft.openGameLink = {
            openGameUserId: result.openGameUserId!,
            linkedAt: result.linkedAt || new Date().toISOString(),
            profile: result.profile
          };
        });
        
        return {
          isLinked: true,
          openGameUserId: result.openGameUserId,
          linkedAt: result.linkedAt || new Date().toISOString(),
          profile: result.profile
        };
      } else {
        setState(draft => {
          draft.openGameLink = undefined;
        });
        
        return { isLinked: false };
      }
    },
    
    async verifyLinkToken(token: string) {
      const requestId = 'verifyLinkToken';
      
      const result = await apiRequest<{
        valid: boolean;
        openGameUserId?: string;
        email?: string;
      }>(
        'POST',
        'verify-link-token',
        { token },
        requestId
      );
      
      if (result.valid && result.openGameUserId && result.email) {
        return {
          valid: true,
          openGameUserId: result.openGameUserId,
          email: result.email
        };
      } else {
        return { valid: false };
      }
    },
    
    async confirmLink(token: string, gameUserId: string) {
      const requestId = 'confirmLink';
      
      try {
        const result = await apiRequest<{
          success: boolean;
          openGameUserId?: string;
          linkedAt?: string;
        }>(
          'POST',
          'confirm-link',
          { token, gameUserId },
          requestId
        );
        
        if (result.success && result.openGameUserId) {
          setState(draft => {
            draft.openGameLink = {
              openGameUserId: result.openGameUserId!,
              linkedAt: result.linkedAt || new Date().toISOString()
            };
          });
          
          return true;
        }
        
        return false;
      } catch (error) {
        setState(draft => {
          draft.error = error instanceof Error ? error.message : 'Failed to confirm link';
        });
        throw error;
      }
    },
    
    // Inherit base auth methods
    async requestCode(email: string) {
      await apiRequest<void>(
        'POST',
        'request-code',
        { email }
      );
    },
    
    async verifyEmail(email: string, code: string) {
      const result = await apiRequest<{
        success: boolean;
        userId?: string;
        sessionToken?: string;
      }>(
        'POST',
        'verify-email',
        { email, code }
      );
      
      if (result.success && result.sessionToken) {
        setState(draft => {
          draft.email = email;
          draft.userId = result.userId || draft.userId;
          draft.sessionToken = result.sessionToken || null;
        });
      }
      
      return { success: result.success };
    },
    
    async logout() {
      await apiRequest<void>(
        'POST',
        'logout'
      );
      
      setState(draft => {
        draft.sessionToken = null;
        draft.email = null;
        draft.openGameLink = undefined;
      });
    },
    
    async refresh() {
      const result = await apiRequest<{
        sessionToken: string;
      }>(
        'POST',
        'refresh'
      );
      
      setState(draft => {
        draft.sessionToken = result.sessionToken || null;
      });
    },
    
    async getWebAuthCode() {
      const result = await apiRequest<{
        code: string;
        expiresIn: number;
      }>(
        'GET',
        'web-auth-code'
      );
      
      return result;
    }
  };
} 