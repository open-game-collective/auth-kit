export type UserCredentials = {
  userId: string;
  sessionToken: string;
  refreshToken: string;
};

export type AuthState = {
  isLoading: boolean;
  host: string;
  userId: string;
  sessionToken: string;
  refreshToken: string | null;
  isVerified: boolean;
  error?: string;
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

export type AuthHooks<TEnv = any> = {
  /**
   * Required hook to look up a user ID by email address.
   * This allows implementers to use their own storage mechanism for email-to-userId associations.
   * @returns The user ID if found, null if no user exists with this email
   */
  getUserIdByEmail: (props: {
    email: string;
    env: TEnv;
    request: Request;
  }) => Promise<string | null>;

  /**
   * Required hook to store a verification code for an email address.
   * The code should expire after a short time (e.g., 10 minutes).
   */
  storeVerificationCode: (props: {
    email: string;
    code: string;
    env: TEnv;
    request: Request;
  }) => Promise<void>;

  /**
   * Required hook to verify if a code matches what was stored for an email.
   * Should return false if the code is expired or doesn't match.
   */
  verifyVerificationCode: (props: {
    email: string;
    code: string;
    env: TEnv;
    request: Request;
  }) => Promise<boolean>;

  /**
   * Required hook to send a verification code via email.
   * @returns true if the email was sent successfully, false otherwise
   */
  sendVerificationCode: (props: {
    email: string;
    code: string;
    env: TEnv;
    request: Request;
  }) => Promise<boolean>;

  /**
   * Called when a new anonymous user is created
   */
  onNewUser?: (props: {
    userId: string;
    env: TEnv;
    request: Request;
  }) => Promise<void>;

  /**
   * Called when a user successfully authenticates with their email code
   */
  onAuthenticate?: (props: {
    userId: string;
    email: string;
    env: TEnv;
    request: Request;
  }) => Promise<void>;

  /**
   * Called when a user verifies their email address for the first time.
   * This is typically used to mark a user as verified in your database
   * or to perform any first-time setup for new users.
   */
  onEmailVerified?: (props: {
    userId: string;
    email: string;
    env: TEnv;
    request: Request;
  }) => Promise<void>;
};

export interface AuthClient {
  getState(): AuthState;
  subscribe(callback: (state: AuthState) => void): () => void;
  requestCode(email: string): Promise<void>;
  verifyEmail(email: string, code: string): Promise<{ success: boolean }>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
}

export interface AuthClientConfig {
  /** Host without protocol (e.g. "localhost:8787") */
  host: string;
  /** Initial user ID from worker middleware */
  userId: string;
  /** Initial session token from worker middleware */
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
