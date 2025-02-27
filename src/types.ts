export type UserCredentials = {
  userId: string;
  sessionToken: string;
  refreshToken: string;
};

/**
 * The authentication state object that represents the current user's session.
 * This is the core state object used throughout the auth system.
 */
export type AuthState = {
  /**
   * The unique identifier for the current user.
   * For anonymous users, this will be a randomly generated ID prefixed with "anon-".
   * For verified users, this will be their permanent user ID.
   */
  userId: string;

  /**
   * The JWT session token used for authenticated requests.
   * This token has a short expiration (typically 15 minutes) and is
   * automatically refreshed using the refresh token when needed.
   */
  sessionToken: string | null;

  /**
   * The user's verified email address, if they have completed verification.
   * Will be null for anonymous users or users who haven't verified their email.
   * The presence of an email indicates the user is verified.
   */
  email: string | null;

  /**
   * Indicates if an authentication operation is currently in progress.
   * Used to show loading states in the UI during auth operations.
   */
  isLoading: boolean;

  /**
   * Any error that occurred during the last authentication operation.
   * Will be null if no error occurred.
   */
  error: string | null;
};

export const STORAGE_KEYS = {
  SESSION_TOKEN: "auth_session_token",
  REFRESH_TOKEN: "auth_refresh_token",
  USER_ID: "auth_user_id",
} as const;

export class APIError extends Error {
  constructor(message: string, public code: number, public details?: any) {
    super(message);
    this.name = "APIError";
  }

  static isServerError(code: number): boolean {
    return code >= 500 && code < 600;
  }

  static getErrorMessage(
    code: number,
    defaultMessage: string = "An error occurred"
  ): string {
    switch (code) {
      case 400:
        return "Please enter a valid email address.";
      case 401:
        return "Session expired. Please try again.";
      case 409:
        return "This email is already linked to another account. Please use a different email.";
      case 429:
        return "Too many attempts. Please wait a few minutes and try again.";
      case 500:
        return "Our servers are having trouble. Please try again in a moment.";
      case 503:
        return "Service temporarily unavailable. Please try again later.";
      default:
        return APIError.isServerError(code)
          ? "Something went wrong on our end. Please try again later."
          : defaultMessage;
    }
  }
}

export interface AuthHooks<TEnv> {
  // Required hooks
  getUserIdByEmail: (params: { email: string; env: TEnv; request: Request }) => Promise<string | null>;
  storeVerificationCode: (params: { email: string; code: string; env: TEnv; request: Request }) => Promise<void>;
  verifyVerificationCode: (params: { email: string; code: string; env: TEnv; request: Request }) => Promise<boolean>;
  sendVerificationCode: (params: { email: string; code: string; env: TEnv; request: Request }) => Promise<boolean>;

  // Optional hooks
  onNewUser?: (params: { userId: string; env: TEnv; request: Request }) => Promise<void>;
  onAuthenticate?: (params: { userId: string; email: string; env: TEnv; request: Request }) => Promise<void>;
  onEmailVerified?: (params: { userId: string; email: string; env: TEnv; request: Request }) => Promise<void>;
  getUserEmail?: (params: { userId: string; env: TEnv; request: Request }) => Promise<string | undefined>;
}

export interface AuthClient {
  getState(): AuthState;
  subscribe(callback: (state: AuthState) => void): () => void;
  requestCode(email: string): Promise<void>;
  verifyEmail(email: string, code: string): Promise<{ success: boolean }>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
  
  // Mobile-to-web authentication (mobile only)
  getWebAuthCode(): Promise<{ code: string; expiresIn: number }>;
}

export interface AuthClientConfig {
  /** Host without protocol (e.g. "localhost:8787") */
  host: string;
  /** Initial user ID from server middleware */
  userId: string;
  /** Initial session token from server middleware */
  sessionToken: string;
  /** Optional refresh token, recommended for mobile clients */
  refreshToken?: string;
  /** Optional callback for handling errors */
  onError?: (error: Error) => void;
}

export interface AnonymousUserConfig {
  /** Host without protocol (e.g. "localhost:8787") */
  host: string;
  /** JWT expiration time for refresh tokens (default: '7d') */
  refreshTokenExpiresIn?: string;
  /** JWT expiration time for session tokens (default: '15m') */
  sessionTokenExpiresIn?: string;
}

