import { APIError, AuthClient, AuthState, STORAGE_KEYS, UserCredentials } from './types';
import type { AuthClientConfig, AnonymousUserConfig } from "./types";

/**
 * Decodes a JWT token without verification
 * This is safe for client-side use since we're only reading the payload
 * and not relying on the token's integrity for security purposes
 */
function decodeJWT(token: string): Record<string, any> | null {
  try {
    // Check if token is valid
    if (!token || typeof token !== 'string') {
      return null;
    }
    
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }
    
    const base64Url = parts[1];
    if (!base64Url) return null;
    
    // Replace characters for base64 decoding
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    
    // Cross-platform base64 decoding implementation
    let jsonPayload: string;
    
    // For React Native environment
    if (typeof global !== 'undefined' && global.Buffer) {
      jsonPayload = global.Buffer.from(base64, 'base64').toString('utf8');
    } 
    // For browser environment
    else if (typeof atob === 'function') {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      jsonPayload = new TextDecoder().decode(bytes);
    } 
    // Pure JS implementation for environments without native base64 support
    else {
      // Implementation of base64 decoder without external dependencies
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
      let output = '';
      
      // Remove padding
      const str = base64.replace(/=+$/, '');
      
      if (str.length % 4 === 1) {
        throw new Error("Invalid base64 string");
      }
      
      for (let bc = 0, bs = 0, buffer, i = 0; buffer = str.charAt(i++);) {
        // Check if the character exists in the base64 character set
        const idx = chars.indexOf(buffer);
        if (idx === -1) continue;
        
        bs = bc % 4 ? bs * 64 + idx : idx;
        if (bc++ % 4) {
          output += String.fromCharCode(255 & bs >> (-2 * bc & 6));
        }
      }
      
      jsonPayload = output;
    }
    
    return JSON.parse(jsonPayload);
  } catch (error) {
    console.error('Error decoding JWT:', error);
    return null;
  }
}

export async function createAnonymousUser(config: AnonymousUserConfig): Promise<UserCredentials> {
  // Add protocol if not present
  const apiHost = config.host.startsWith('http://') || config.host.startsWith('https://')
    ? config.host
    : `http://${config.host}`;

  const response = await fetch(`${apiHost}/auth/anonymous`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      refreshTokenExpiresIn: config.refreshTokenExpiresIn,
      sessionTokenExpiresIn: config.sessionTokenExpiresIn
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }

  const data = await response.json();
  
  // Convert null email to undefined to match test expectations
  if (data.email === null) {
    data.email = undefined;
  }
  
  return data;
}

export function createAuthClient(config: AuthClientConfig): AuthClient {
  // Initialize base state
  const initialState: AuthState = {
    userId: config.userId,
    sessionToken: config.sessionToken,
    email: null,
    isLoading: false,
    error: null
  };
  
  // Merge with provided initial state if any
  if (config.initialState) {
    Object.assign(initialState, config.initialState);
  }
  
  // State management
  let state = initialState;
  const subscribers: ((state: AuthState) => void)[] = [];
  
  // Update state and notify subscribers
  const setState = (updater: (draft: AuthState) => void) => {
    const nextState = { ...state };
    updater(nextState);
    state = nextState;
    subscribers.forEach(callback => callback(state));
  };
  
  // Create API request helper
  const apiRequest = async <T>(
    method: string,
    path: string,
    body?: any,
    authenticated: boolean = true
  ): Promise<T> => {
    setState(draft => {
      draft.isLoading = true;
      draft.error = null;
    });
    
    try {
      // Ensure we're working with a string path
      if (typeof path !== 'string') {
        path = String(path);
      }
      
      // Normalize the path to ensure it starts with a slash
      const normalizedPath = path.startsWith('/') ? path : `/${path}`;
      
      // Ensure the host is properly formatted
      const host = config.host.replace(/^https?:\/\//, '');
      
      // Construct the full URL
      const url = `http://${host}${normalizedPath}`;
      
      const headers: HeadersInit = {
        'Content-Type': 'application/json'
      };
      
      if (authenticated && state.sessionToken) {
        headers['Authorization'] = `Bearer ${state.sessionToken}`;
      }
      
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        const errorMessage = errorText || `API request failed with status ${response.status}`;
        throw new APIError(
          errorMessage,
          response.status
        );
      }
      
      // For 204 No Content responses
      if (response.status === 204) {
        setState(draft => {
          draft.isLoading = false;
        });
        return {} as T;
      }
      
      const data = await response.json();
      
      setState(draft => {
        draft.isLoading = false;
      });
      
      return data as T;
    } catch (error) {
      setState(draft => {
        draft.isLoading = false;
        draft.error = error instanceof Error ? error.message : String(error);
      });
      throw error;
    }
  };
  
  // Store session token in local storage
  const storeSessionToken = (token: string | null) => {
    if (typeof window !== 'undefined') {
      if (token) {
        localStorage.setItem(STORAGE_KEYS.sessionToken, token);
      } else {
        localStorage.removeItem(STORAGE_KEYS.sessionToken);
      }
    }
  };
  
  // Auth client implementation
  const client: AuthClient = {
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
    
    async requestCode(email: string) {
      const result = await apiRequest<{ success: boolean } & UserCredentials>(
        'POST',
        '/auth/request-code',
        { email }
      );
      
      setState(draft => {
        if (result.userId) draft.userId = result.userId;
        if (result.sessionToken) draft.sessionToken = result.sessionToken;
      });
      
      if (result.sessionToken) {
        storeSessionToken(result.sessionToken);
      }
    },
    
    async verifyEmail(email: string, code: string): Promise<{ success: boolean }> {
      const result = await apiRequest<UserCredentials & { success: boolean }>(
        'POST',
        '/auth/verify',
        { email, code }
      );
      
      setState(draft => {
        draft.userId = result.userId;
        draft.sessionToken = result.sessionToken || null;
        draft.email = email;
      });
      
      if (result.sessionToken) {
        storeSessionToken(result.sessionToken);
      }
      
      return { success: true };
    },
    
    async logout() {
      try {
        await apiRequest<void>(
          'POST',
          '/auth/logout',
          undefined
        );
      } catch (error) {
        // Continue with logout even if the API call fails
        console.error('Error during logout:', error);
      }
      
      setState(draft => {
        draft.sessionToken = "";
        draft.userId = "";
        draft.email = null;
        draft.error = null;
        draft.isLoading = false;
      });
      
      storeSessionToken(null);
    },
    
    async refresh(): Promise<void> {
      const result = await apiRequest<UserCredentials>(
        'POST',
        '/auth/refresh',
        undefined
      );
      
      setState(draft => {
        draft.userId = result.userId;
        draft.sessionToken = result.sessionToken || null;
        draft.email = result.email ?? null;
      });
      
      if (result.sessionToken) {
        storeSessionToken(result.sessionToken);
      }
    },
    
    async getWebAuthCode() {
      return apiRequest<{ code: string; expiresIn: number }>(
        'POST',
        '/auth/web-auth-code',
        undefined
      );
    }
  };
  
  return client;
}

// Re-export AuthClient and AuthClientConfig types from './types'
export type { AuthClient, AuthClientConfig } from "./types";
