export type AuthTokens = {
  userId: string;
  sessionToken: string;
  refreshToken: string;
};

export type AuthState = {
  isInitializing: boolean;
  isLoading: boolean;
  baseUrl: string;
} & (
  | {
      userId: string;
      sessionToken: string;
      refreshToken: string | null;
      isVerified: boolean;
      error?: undefined;
    }
  | {
      userId: null;
      sessionToken: null;
      refreshToken: null;
      isVerified: false;
      error?: string;
    }
);

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
  onNewUser?: (props: {
    userId: string;
    env: TEnv;
    request: Request;
  }) => Promise<void>;
  onEmailVerified?: (props: {
    userId: string;
    email: string;
    env: TEnv;
    request: Request;
  }) => Promise<void>;
};
