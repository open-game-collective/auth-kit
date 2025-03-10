export interface AuthState {
  userId: string;
  sessionToken: string | null;
  email: string | null;
  isLoading: boolean;
  error: string | null;
}

export const STORAGE_KEYS = {
  sessionToken: "auth-kit:sessionToken",
  sessionTokenExpiresAt: "auth-kit:sessionTokenExpiresAt",
};

export class APIError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "APIError";
  }
}

export interface AuthClient {
  getState(): AuthState;
  subscribe(callback: (state: AuthState) => void): () => void;
  requestCode(email: string): Promise<void>;
  verifyEmail(email: string, code: string): Promise<{ success: boolean }>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
  getWebAuthCode(): Promise<{ code: string; expiresIn: number }>;
}

// Base auth hooks interface
export interface AuthHooks<TEnv = unknown> {
  // Base auth hooks (required)
  getUserIdByEmail(params: { email: string; env: TEnv }): Promise<string | null>;

  storeVerificationCode(params: {
    email: string;
    code: string;
    expiresAt: Date;
    env: TEnv;
  }): Promise<void>;

  verifyVerificationCode(params: { email: string; code: string; env: TEnv }): Promise<boolean>;

  sendVerificationCode(params: { email: string; code: string; env: TEnv }): Promise<void>;

  // Base auth hooks (optional)
  onNewUser?(params: { userId: string; email: string; env: TEnv }): Promise<void>;

  onAuthenticate?(params: { userId: string; env: TEnv }): Promise<void>;

  onEmailVerified?(params: { userId: string; email: string; env: TEnv }): Promise<void>;

  getUserEmail?(params: { userId: string; env: TEnv }): Promise<string | null>;
}

export interface RequestState {
  isLoading: boolean;
  error: string | null;
  lastUpdated: string;
}

export interface RequestsState {
  [key: string]: RequestState;
}

// Account linking types
export interface LinkedAccount {
  gameId: string;
  gameUserId: string;
  linkedAt: string;
  gameName?: string;
}

export interface OpenGameLink {
  openGameUserId: string;
  linkedAt: string;
  profile?: {
    displayName?: string;
    avatarUrl?: string;
  };
}

// Provider types
export interface ProviderAuthState extends AuthState {
  linkedAccounts: LinkedAccount[];
  requests: RequestsState;
}

export interface ProviderAuthClient extends AuthClient {
  getState(): ProviderAuthState;
  subscribe(callback: (state: ProviderAuthState) => void): () => void;
  getLinkedAccounts(): Promise<LinkedAccount[]>;
  initiateAccountLinking(gameId: string): Promise<{
    linkToken: string;
    expiresAt: string;
  }>;
  unlinkAccount(gameId: string): Promise<boolean>;
}

export interface ProviderAuthHooks<TEnv = unknown> {
  // Base auth hooks (required)
  getUserIdByEmail(params: { email: string; env: TEnv }): Promise<string | null>;

  storeVerificationCode(params: {
    email: string;
    code: string;
    expiresAt: Date;
    env: TEnv;
  }): Promise<void>;

  verifyVerificationCode(params: { email: string; code: string; env: TEnv }): Promise<boolean>;

  sendVerificationCode(params: { email: string; code: string; env: TEnv }): Promise<void>;

  // Provider-specific hooks (required)
  getGameIdFromApiKey(params: { apiKey: string; env: TEnv }): Promise<string | null>;

  storeAccountLink(params: {
    openGameUserId: string;
    gameId: string;
    gameUserId: string;
    env: TEnv;
  }): Promise<void>;

  getLinkedAccounts(params: { openGameUserId: string; env: TEnv }): Promise<LinkedAccount[]>;

  // Provider-specific hooks (optional)
  removeAccountLink?(params: {
    openGameUserId: string;
    gameId: string;
    env: TEnv;
  }): Promise<boolean>;

  // Base auth hooks (optional)
  onNewUser?(params: { userId: string; email: string; env: TEnv }): Promise<void>;

  onAuthenticate?(params: { userId: string; env: TEnv }): Promise<void>;

  onEmailVerified?(params: { userId: string; email: string; env: TEnv }): Promise<void>;

  getUserEmail?(params: { userId: string; env: TEnv }): Promise<string | null>;
}

// Consumer types
export interface ConsumerAuthState extends AuthState {
  openGameLink?: OpenGameLink;
  requests: RequestsState;
}

export interface ConsumerAuthClient extends AuthClient {
  getState(): ConsumerAuthState;
  subscribe(callback: (state: ConsumerAuthState) => void): () => void;
  getOpenGameLinkStatus(): Promise<
    | {
        isLinked: true;
        openGameUserId: string;
        linkedAt: string;
        profile?: OpenGameLink["profile"];
      }
    | { isLinked: false }
  >;
  verifyLinkToken(
    token: string
  ): Promise<{ valid: true; openGameUserId: string; email: string } | { valid: false }>;
  confirmLink(token: string, gameUserId: string): Promise<boolean>;
}

export interface ConsumerAuthHooks<TEnv = unknown> {
  // Base auth hooks (required)
  getUserIdByEmail(params: { email: string; env: TEnv }): Promise<string | null>;

  storeVerificationCode(params: {
    email: string;
    code: string;
    expiresAt: Date;
    env: TEnv;
  }): Promise<void>;

  verifyVerificationCode(params: { email: string; code: string; env: TEnv }): Promise<boolean>;

  sendVerificationCode(params: { email: string; code: string; env: TEnv }): Promise<void>;

  // Consumer-specific hooks (required)
  storeOpenGameLink(params: {
    gameUserId: string;
    openGameUserId: string;
    env: TEnv;
  }): Promise<void>;

  getOpenGameUserId(params: { gameUserId: string; env: TEnv }): Promise<string | null>;

  // Consumer-specific hooks (optional)
  getOpenGameProfile?(params: { openGameUserId: string; env: TEnv }): Promise<
    OpenGameLink["profile"] | null
  >;

  // Base auth hooks (optional)
  onNewUser?(params: { userId: string; email: string; env: TEnv }): Promise<void>;

  onAuthenticate?(params: { userId: string; env: TEnv }): Promise<void>;

  onEmailVerified?(params: { userId: string; email: string; env: TEnv }): Promise<void>;

  getUserEmail?(params: { userId: string; env: TEnv }): Promise<string | null>;
}

export interface AuthClientConfig {
  host: string;
  userId: string;
  sessionToken: string;
  refreshToken?: string;
  initialState?: Partial<AuthState>;
}

export interface AnonymousUserConfig {
  host: string;
  email?: string;
  refreshTokenExpiresIn?: string;
  sessionTokenExpiresIn?: string;
}

export interface UserCredentials {
  userId: string;
  sessionToken: string;
  email?: string;
}
