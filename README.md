# 🔐 Auth Kit

A full-stack authentication toolkit for React applications. Built on Cloudflare Workers, Auth Kit provides a secure, low-latency authentication system with email verification and token management. Perfect for applications that need a robust auth system with a great developer experience.

## 📚 Table of Contents

- [💾 Installation](#-installation)
- [🌟 Key Features](#-key-features)
- [🛠️ Usage Guide](#️-usage-guide)
  - [1️⃣ Set up Environment and Worker](#1️⃣-set-up-environment-and-worker)
  - [2️⃣ Access Auth in Remix Routes](#2️⃣-access-auth-in-remix-routes)
  - [3️⃣ Configure Worker](#3️⃣-configure-worker)
  - [4️⃣ Set up Auth Client and React Integration](#4️⃣-set-up-auth-client-and-react-integration)
- [🏗️ Architecture](#️-architecture)
- [📖 API Reference](#-api-reference)
  - [🔐 auth-kit/client](#-auth-kitclient)
  - [🖥️ auth-kit/worker](#️-auth-kitworker)
  - [⚛️ auth-kit/react](#️-auth-kitreact)
- [🔑 TypeScript Types](#-typescript-types)

## 💾 Installation

```bash
npm install auth-kit
# or
yarn add auth-kit
# or
pnpm add auth-kit
```

## 🌟 Key Features

- 🎭 **Anonymous-First Auth**: Users start with an anonymous session that can be upgraded to a verified account
- 📧 **Email Verification**: Built-in secure email verification flow with customizable storage and delivery
- 🔐 **JWT-Based Tokens**: Secure session and refresh tokens with automatic refresh
- ⚡️ **Edge-Ready**: Designed for Cloudflare Workers with minimal latency
- 🎯 **Type-Safe**: Full TypeScript support with detailed types
- 🎨 **React Integration**: Ready-to-use hooks and components for auth state
- 🔌 **Customizable**: Bring your own storage and email delivery systems

## 🛠️ Usage Guide

### 1️⃣ Set up Environment and Worker

#### Environment Types

First, set up your environment types:

```typescript
// app/env.ts

// Define Remix context types
declare module "@remix-run/cloudflare" {
  interface AppLoadContext {
    env: Env;

    // Auth context from worker middleware
    userId: string;
    sessionId: string;
    sessionToken: string;
    requestId: string;
  }
}

// Environment type with required auth-kit variables
export interface Env {
  // Required for auth-kit
  AUTH_SECRET: string;
  SENDGRID_API_KEY: string;
  
  // KV Storage for auth data
  KV_STORAGE: KVNamespace;
  
  // Your other environment variables
  [key: string]: unknown;
}
```

#### Worker Entry Point

Then create your worker entry point:

```typescript
// app/worker.ts
import { createRequestHandler, logDevReady } from "@remix-run/cloudflare";
import * as build from "@remix-run/dev/server-build";
import { AuthHooks, withAuth } from "@open-game-collective/auth-kit/worker";
import type { Env } from "./env";

if (process.env.NODE_ENV === "development") {
  logDevReady(build);
}

const handleRemixRequest = createRequestHandler(build);

const authHooks: AuthHooks<Env> = {
  getUserIdByEmail: async ({ email, env }) => {
    return await env.KV_STORAGE.get(`email:${email}`);
  },

  storeVerificationCode: async ({ email, code, env }) => {
    await env.KV_STORAGE.put(`code:${email}`, code, {
      expirationTtl: 600,
    });
  },

  verifyVerificationCode: async ({ email, code, env }) => {
    const storedCode = await env.KV_STORAGE.get(`code:${email}`);
    return storedCode === code;
  },

  sendVerificationCode: async ({ email, code, env }) => {
    try {
      const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.SENDGRID_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email }] }],
          from: { email: "auth@yourdomain.com" },
          subject: "Your verification code",
          content: [{ type: "text/plain", value: `Your code is: ${code}` }],
        }),
      });
      return response.ok;
    } catch (error) {
      console.error("Failed to send email:", error);
      return false;
    }
  },

  onNewUser: async ({ userId, env }) => {
    await env.KV_STORAGE.put(
      `user:${userId}`,
      JSON.stringify({
        created: new Date().toISOString(),
      })
    );
  },

  onAuthenticate: async ({ userId, email, env }) => {
    await env.KV_STORAGE.put(
      `user:${userId}:lastLogin`,
      new Date().toISOString()
    );
  },

  onEmailVerified: async ({ userId, email, env }) => {
    await env.KV_STORAGE.put(`user:${userId}:verified`, "true");
    await env.KV_STORAGE.put(`email:${email}`, userId);
  },
};

const handler = withAuth<Env>(
  async (request, env, { userId, sessionId, sessionToken }) => {
    try {
      // Inject the userId, sessionId, sessionToken, and requestId into the request context
      return await handleRemixRequest(request, {
        env,
        userId,
        sessionId,
        sessionToken,
        requestId: crypto.randomUUID(),
      });
    } catch (error) {
      console.error("Error processing request:", error);
      return new Response("Internal Error", { status: 500 });
    }
  },
  { hooks: authHooks }
);

// Worker entry point
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return handler(request, this.env);
  },
} satisfies ExportedHandler<Env>;
```

Configure your worker in `wrangler.toml`:

```toml
name = "my-remix-app"
main = "app/worker.ts"
compatibility_date = "2024-01-01"

[durable_objects]
bindings = [
  { name = "REMIX", class_name = "RemixDO" }
]

[[migrations]]
tag = "v1"
new_classes = ["RemixDO"]

[vars]
NODE_ENV = "development"
WEB_HOST = "localhost:8787"

# KV Namespace for auth storage
kv_namespaces = [
  { binding = "KV_STORAGE", id = "..." }
]

# Secrets (use wrangler secret put for production)
# Put in .dev.vars
# - AUTH_SECRET
# - SENDGRID_API_KEY
```

### 2️⃣ Access Auth in Remix Routes

Now you can access the authenticated user and session token in your Remix routes:

```typescript
// app/routes/_index.tsx
import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { useLoaderData } from "@remix-run/react";

export async function loader({ context }: LoaderFunctionArgs) {
  // Access userId, sessionId, and sessionToken from context
  const { userId, sessionId, sessionToken } = context;

  // Example: Fetch user data from KV
  const userData = await context.env.USERS_KV.get(`user:${userId}`);

  return json({
    userId,
    sessionId,
    sessionToken, // Added: Pass session token to client
    userData: userData ? JSON.parse(userData) : null,
  });
}

export default function Index() {
  const { userId, sessionToken, userData } = useLoaderData<typeof loader>();

  // Create auth client with required tokens
  const client = useMemo(() => createAuthClient({
    host: "localhost:8787",
    userId,
    sessionToken,
  }), [userId, sessionToken]);

  return (
    <div>
      <h1>Welcome, {userId}!</h1>
      {userData?.verified && <p>✅ Email verified</p>}
    </div>
  );
}
```

### 4️⃣ Set up Auth Client and React Integration

First, create your auth client:

```typescript
// app/auth.client.ts
import { createAuthClient } from "@open-game-collective/auth-kit/client";

// The userId and sessionToken are provided by the worker middleware
// via cookies and should be read server-side and passed to the client
export const authClient = createAuthClient({
  host: "localhost:8787",
  userId: "user_id_from_cookie", // Required: from worker middleware
  sessionToken: "session_token_from_cookie", // Required: from worker middleware
});
```

Then create your auth context:

```typescript
// app/auth.context.ts
import { createAuthContext } from "@open-game-collective/auth-kit/react";

export const AuthContext = createAuthContext();
```

Set up the provider in your root component:

```typescript
// app/root.tsx
import { AuthContext } from "./auth.context";
import { authClient } from "./auth.client";

// Example of getting the initial auth state from the server
export async function loader({ request }: LoaderFunctionArgs) {
  const cookieHeader = request.headers.get("Cookie");
  const userId = getCookie(cookieHeader, "auth_user_id");
  const sessionToken = getCookie(cookieHeader, "auth_session_token");

  if (!userId || !sessionToken) {
    throw new Error("Missing required auth tokens");
  }

  return json({
    userId,
    sessionToken,
  });
}

export default function App() {
  const { userId, sessionToken } = useLoaderData<typeof loader>();

  // Create the client with the required tokens
  const client = useMemo(() => createAuthClient({
    host: "localhost:8787",
    userId,
    sessionToken,
  }), [userId, sessionToken]);

  return (
    <AuthContext.Provider client={client}>
      <html>
        <head>
          <Meta />
          <Links />
        </head>
        <body>
          <Outlet />
          <ScrollRestoration />
          <Scripts />
          <LiveReload />
        </body>
      </html>
    </AuthContext.Provider>
  );
}
```

Now you can use the auth hooks and components in your routes:

```typescript
// app/routes/profile.tsx
import { AuthContext } from "~/auth.context";

export default function Profile() {
  // Access the auth client for methods
  const client = AuthContext.useClient();
  
  // Use selectors for state updates
  const userId = AuthContext.useSelector(state => state.userId);
  const isLoading = AuthContext.useSelector(state => state.isLoading);
  const isVerified = AuthContext.useSelector(state => state.isVerified);
  
  return (
    <div>
      {/* Show loading states */}
      <AuthContext.Loading>
        <LoadingSpinner />
      </AuthContext.Loading>

      {/* Only show for authenticated users */}
      <AuthContext.Authenticated>
        <p>User ID: {userId}</p>
        
        {/* Content for verified users */}
        <AuthContext.Verified>
          <div>
            <h2>Welcome back!</h2>
            <button onClick={() => client.logout()}>Logout</button>
          </div>
        </AuthContext.Verified>
        
        {/* Email verification flow for unverified users */}
        <AuthContext.Unverified>
          <EmailVerificationForm 
            onRequestCode={() => client.requestCode('user@example.com')}
            onVerify={(email, code) => client.verifyEmail(email, code)}
            isLoading={isLoading}
          />
        </AuthContext.Unverified>
      </AuthContext.Authenticated>
    </div>
  );
}

// Example email verification form
function EmailVerificationForm({ onRequestCode, onVerify }: { onRequestCode: (email: string) => Promise<void>; onVerify: (email: string, code: string) => Promise<void>; }) {
  // Note: The auth client methods (requestCode, verifyEmail, etc.) are asynchronous, so they must be awaited.
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [hasRequested, setHasRequested] = useState(false);

  const handleRequestCode = async (e: FormEvent) => {
    e.preventDefault();
    await onRequestCode(email);
    setHasRequested(true);
  };

  const handleVerifyCode = async (e: FormEvent) => {
    e.preventDefault();
    await onVerify(email, code);
  };

  return (
    <div>
      {!hasRequested ? (
        <form onSubmit={handleRequestCode}>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="Enter your email"
          />
          <button type="submit">Send Code</button>
        </form>
      ) : (
        <form onSubmit={handleVerifyCode}>
          <input
            type="text"
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="Enter verification code"
          />
          <button type="submit">Verify Code</button>
        </form>
      )}
    </div>
  );
}
```

The React integration provides:

1. **State Management**
   - `useSelector`: Subscribe to specific parts of auth state
   - `useClient`: Direct access to auth client (advanced usage)

2. **Conditional Components**
   - `<AuthContext.Loading>`: Show during auth operations
   - `<AuthContext.Authenticated>`: Only render for authenticated users
   - `<AuthContext.Verified>`: Only render for verified users
   - `<AuthContext.Unverified>`: Only render for unverified users

3. **Auth Methods**
   - `requestCode`: Request email verification code
   - `verifyEmail`: Verify email with code
   - `logout`: Log out current user
   - `refresh`: Manually refresh session token

4. **Type Safety**
   - Full TypeScript support
   - Autocomplete for state and methods
   - Type inference for selectors

## 🏗️ Architecture

Auth Kit is built on three main components that work together to provide a complete authentication solution:

### 1. Worker Middleware (`auth-kit/worker`)
- Handles all `/auth/*` routes automatically
- Manages JWT session (15m) and refresh (7d) tokens
- Creates anonymous users for new visitors
- Provides hooks for email verification and user management
- Integrates with Remix's loader context to provide `userId` and `sessionId`

### 2. Auth Client (`auth-kit/client`)
- Manages auth state on the client
- Handles token refresh automatically
- Provides methods for email verification flow
- Implements pub/sub for state updates
- Works with or without React

### 3. React Integration (`auth-kit/react`)
- Provides hooks for accessing auth state
- Offers conditional rendering components
- Handles state subscriptions efficiently
- Integrates with Suspense for loading states

### Authentication Flow

1. **Initial Visit**
   ```typescript
   // 1. Middleware creates anonymous user
   const userId = crypto.randomUUID();
   const sessionToken = await createSessionToken(userId);
   const refreshToken = await createRefreshToken(userId);
   
   // 2. Tokens available in Remix loader context
   export async function loader({ context }: LoaderFunctionArgs) {
     const { userId, sessionId } = context;
     // ...
   }
   
   // 3. React components can access auth state
   function Profile() {
     const { userId, isVerified } = AuthContext.useAuth();
     // ...
   }
   ```

2. **Email Verification**
   ```typescript
   // 1. User requests verification code
   const { requestCode } = AuthContext.useAuth();
   await requestCode("user@example.com");
   
   // 2. Worker calls hooks
   await hooks.storeVerificationCode({ email, code, env });
   await hooks.sendVerificationCode({ email, code, env });
   
   // 3. User verifies code
   const { verifyEmail } = AuthContext.useAuth();
   await verifyEmail("user@example.com", "123456");
   
   // 4. Worker updates user
   await hooks.onEmailVerified({ userId, email, env });
   ```

3. **Token Refresh**
   ```typescript
   // 1. Session token expires (15m)
   // 2. Client uses refresh token to get new session
   // 3. Worker validates refresh token (7d)
   // 4. New tokens are issued
   // 5. Auth state is updated automatically
   ```

This architecture provides:
- 🔒 Secure, JWT-based sessions
- 🎭 Anonymous-first authentication
- 📨 Customizable email verification
- ⚡️ Automatic token refresh
- 🎯 Type-safe integration with Remix
- 🎨 Efficient React state management

### Platform Differences: Web vs. Mobile

Auth Kit provides flexible authentication flows to cater to the specific requirements of different platforms.

- **Web Platforms:** For web applications, the `withAuth` middleware automatically handles user session initialization. When a user visits your site, the middleware checks for an existing session token, and if none is found, it generates a new anonymous user, creates a session, and sets secure HTTP-only cookies with the `sessionToken` and `refreshToken`.

- **Mobile Platforms:** In mobile applications, cookies are typically not used in the same way. Instead, you should explicitly call the `createAnonymousUser` function available from the auth client. This function returns an object containing the `userId`, `sessionToken`, and `refreshToken`, which you can then securely store and manage within your mobile app.

This distinction allows you to optimize the authentication flow based on the specific needs of your platform.

## 📖 API Reference

### 🔐 auth-kit/client

#### `createAuthClient(config)`

Creates an auth client instance for managing auth state and operations.

```typescript
interface AuthClientConfig {
  host: string;
  userId: string; // Required: Initial user ID from worker middleware
  sessionToken: string; // Required: Initial session token from worker middleware
  initialState?: Partial<AuthState>;
  onStateChange?: (state: AuthState) => void;
  onError?: (error: Error) => void;
}

const client = createAuthClient(config);
```

Example usage:
```typescript
const client = createAuthClient({
  host: "localhost:8787",
  userId: "user_id_from_cookie",
  sessionToken: "session_token_from_cookie",
  onStateChange: (state) => {
    console.log("Auth state changed:", state);
  },
  onError: (error) => {
    console.error("Auth error:", error);
  }
});

// Request verification code
await client.requestCode("user@example.com");

// Verify email
const result = await client.verifyEmail("user@example.com", "123456");
if (result.success) {
  console.log("Email verified!");
}

// Subscribe to state changes
const unsubscribe = client.subscribe((state) => {
  if (state.isVerified) {
    console.log("User is verified!");
  }
});
```

The client automatically:
- Manages auth state
- Handles token refresh
- Provides error handling
- Supports state subscriptions

### Creating an Anonymous User

The auth client now provides a method called `createAnonymousUser` that always returns an object containing the full set of authentication tokens: `userId`, `sessionToken`, and `refreshToken`. This ensures that every time an anonymous user is generated, all three tokens are available for subsequent authentication flows.

You can also optionally pass a configuration object with a `refreshTokenExpiration` property (in seconds) to specify a custom expiration time for the refresh token. This allows you to tailor token lifetimes based on your application's requirements—mobile clients might require a longer refresh token, while web clients might use a shorter one.

Example usage:

```typescript
// For a web client with a shorter refresh token lifespan (e.g., 24 hours)
const anonymousUser = await client.createAnonymousUser({ refreshTokenExpiration: 86400 });
console.log(anonymousUser);
// { userId: '...', sessionToken: '...', refreshToken: '...' }

// For a mobile client with a longer refresh token lifespan (e.g., 7 days)
const mobileUser = await client.createAnonymousUser({ refreshTokenExpiration: 604800 });
console.log(mobileUser);
```

This update ensures that anonymous users are always provided with the complete set of tokens required for secure session management.

### 🖥️ auth-kit/worker

#### `withAuth<TEnv>(handler, config)`

Creates a middleware that handles authentication and provides user context:

```typescript
function withAuth<TEnv extends { AUTH_SECRET: string }>(
  handler: (
    request: Request,
    env: TEnv,
    auth: { userId: string; sessionId: string }
  ) => Promise<Response>,
  config: {
    hooks: AuthHooks<TEnv>;
  }
): (request: Request, env: TEnv) => Promise<Response>;
```

The middleware:
1. Handles all `/auth/*` routes automatically
2. Creates anonymous users for new visitors
3. Manages session (15m) and refresh (7d) tokens
4. Provides `userId` and `sessionId` to your handler
5. Sets secure HTTP-only cookies for tokens

Example usage:
```typescript
export default {
  fetch: withAuth<Env>(
    async (request, env, { userId, sessionId }) => {
      // Pass auth context to Remix loader context
      const loadContext = { env, userId, sessionId };
      return await handleRequest(request, loadContext);
    },
    { hooks: authHooks }
  ),
};
```

#### Auth Router Endpoints

##### POST /auth/request-code

Request an email verification code.

```typescript
// Request
{
  email: string;
}

// Response
{
  success: true;
}
```

##### POST /auth/verify

Verify an email with a code.

```typescript
// Request
{
  email: string;
  code: string;
}

// Response
{
  success: true;
}
```

##### POST /auth/refresh

Refresh the session using a refresh token.

```typescript
// Request
Cookie: auth_refresh_token=<token>

// Response
{
  userId: string;
  sessionToken: string;
  refreshToken: string;
}
```

##### POST /auth/logout

Log out the current user.

```typescript
// Response
{
  success: true;
}
// + Cleared cookies
```

### ⚛️ auth-kit/react

#### `createAuthContext()`

Creates a React context with hooks and components for auth state management:

```typescript
const AuthContext = createAuthContext();

// Returned object structure:
{
  // Provider Component
  Provider: React.FC<{
    children: ReactNode;
    client: AuthClient;
  }>;

  // Hooks
  useClient(): AuthClient;
  useSelector<T>(selector: (state: AuthState) => T): T;

  // Conditional Components
  Loading: React.FC<{ children: ReactNode }>;
  Verified: React.FC<{ children: ReactNode }>;
  Unverified: React.FC<{ children: ReactNode }>;
  Authenticated: React.FC<{ children: ReactNode }>;
}
```

Instead of a combined `useAuth` hook, you can use `useClient` to access auth methods and `useSelector` to subscribe to state updates as needed.

Example usage:

```typescript
// Create context
const AuthContext = createAuthContext();

// Set up provider
function App() {
  return (
    <AuthContext.Provider client={authClient}>
      <Routes />
    </AuthContext.Provider>
  );
}

// Use hooks in components
function Profile() {
  // Access the auth client for methods
  const client = AuthContext.useClient();
  
  // Use selectors for state updates
  const userId = AuthContext.useSelector(state => state.userId);
  const isLoading = AuthContext.useSelector(state => state.isLoading);
  const isVerified = AuthContext.useSelector(state => state.isVerified);
  
  return (
    <div>
      {/* Show loading states */}
      <AuthContext.Loading>
        <LoadingSpinner />
      </AuthContext.Loading>

      {/* Only show for authenticated users */}
      <AuthContext.Authenticated>
        <p>User ID: {userId}</p>
        
        {/* Content for verified users */}
        <AuthContext.Verified>
          <div>
            <h2>Welcome back!</h2>
            <button onClick={() => client.logout()}>Logout</button>
          </div>
        </AuthContext.Verified>
        
        {/* Email verification flow for unverified users */}
        <AuthContext.Unverified>
          <EmailVerificationForm 
            onRequestCode={() => client.requestCode('user@example.com')}
            onVerify={(email, code) => client.verifyEmail(email, code)}
            isLoading={isLoading}
          />
        </AuthContext.Unverified>
      </AuthContext.Authenticated>
    </div>
  );
}
```

The React integration provides:

1. **Efficient State Management**
   - Fine-grained updates with `useSelector`
   - Automatic state synchronization
   - Memoized selectors for performance

2. **Type-Safe Hooks**
   - Full TypeScript support
   - Autocomplete for state and methods
   - Type inference for selectors

3. **Conditional Rendering**
   - Loading states with `<Loading>`
   - Authentication gates with `<Authenticated>`
   - Verification flows with `<Verified>` and `<Unverified>`

4. **Developer Experience**
   - Simple provider setup
   - Intuitive hook-based API
   - Automatic error handling

## 🔑 TypeScript Types

### Environment Types

```typescript
// Environment type with required auth-kit variables
export interface Env {
  // Required for auth-kit
  AUTH_SECRET: string;
  SENDGRID_API_KEY: string;
  
  // KV Storage for auth data
  KV_STORAGE: KVNamespace;
  
  // Your Durable Objects
  REMIX: DurableObjectNamespace;
  
  // Your other environment variables
  [key: string]: unknown;
}

// Remix context types
declare module "@remix-run/cloudflare" {
  interface AppLoadContext {
    env: Env;
    userId: string;
    sessionId: string;
    requestId: string;
  }
}
```

### Auth State

The auth client maintains a state object with the following structure:

```typescript
type AuthState = {
  /** Whether an auth operation is in progress */
  isLoading: boolean;
  /** Host without protocol (e.g. "localhost:8787") */
  host: string;
  /** Current user ID from worker middleware */
  userId: string;
  /** Current session token from worker middleware */
  sessionToken: string;
  /** Optional refresh token for extending the session */
  refreshToken: string | null;
  /** Whether the user has verified their email */
  isVerified: boolean;
  /** Optional error message from last operation */
  error?: string;
};
```

The state is initialized with required values from the worker middleware:

```typescript
const client = createAuthClient({
  host: "localhost:8787",
  userId: "user_id_from_worker",    // Required
  sessionToken: "session_token",     // Required
});

// Initial state will be:
{
  isLoading: false,
  host: "localhost:8787",
  userId: "user_id_from_worker",
  sessionToken: "session_token",
  refreshToken: null,
  isVerified: false
}
```

You can subscribe to state changes:

```typescript
const unsubscribe = client.subscribe((state) => {
  console.log("Auth state updated:", {
    userId: state.userId,
    isVerified: state.isVerified,
    isLoading: state.isLoading
  });
});

// Later: cleanup subscription
unsubscribe();
```

With React hooks:

```typescript
function AuthStatus() {
  const userId = AuthContext.useSelector(state => state.userId);
  const isVerified = AuthContext.useSelector(state => state.isVerified);
  const isLoading = AuthContext.useSelector(state => state.isLoading);
  
  if (isLoading) return <LoadingSpinner />;
  
  return (
    <div>
      <p>User ID: {userId}</p>
      <p>Status: {isVerified ? '✅ Verified' : '⏳ Unverified'}</p>
    </div>
  );
}
```

## Hooks

The auth router takes the following hooks (some are required, others are optional):

```typescript
const authHooks = {
  // Required: Look up a user ID by email address
  getUserIdByEmail: async ({ email, env, request }) => {
    // Return the user ID if found, null if no user exists with this email
    return await env.DB.get(`user:${email}`);
  },

  // Required: Store a verification code for an email address
  storeVerificationCode: async ({ email, code, env, request }) => {
    // Store the code with expiration (e.g. 10 minutes)
    await env.DB.put(`verification:${email}`, code, { expirationTtl: 600 });
  },

  // Required: Verify if a code matches what was stored for an email
  verifyVerificationCode: async ({ email, code, env, request }) => {
    const storedCode = await env.DB.get(`verification:${email}`);
    return storedCode === code;
  },

  // Required: Send a verification code via email
  sendVerificationCode: async ({ email, code, env, request }) => {
    try {
      const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.SENDGRID_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email }] }],
          from: { email: "auth@yourdomain.com" },
          subject: "Your verification code",
          content: [{ type: "text/plain", value: `Your code is: ${code}` }],
        }),
      });
      return response.ok;
    } catch (error) {
      console.error("Failed to send email:", error);
      return false;
    }
  },

  // Optional: Called when a new anonymous user is created
  onNewUser: async ({ userId, env, request }) => {
    await env.DB.put(`user:${userId}`, { created: new Date() });
  },

  // Optional: Called when a user successfully authenticates with their email code
  onAuthenticate: async ({ userId, email, env, request }) => {
    await env.DB.put(`user:${userId}:lastLogin`, new Date());
  },

  // Optional: Called when a user verifies their email address for the first time
  onEmailVerified: async ({ userId, email, env, request }) => {
    await env.DB.put(`user:${userId}:verified`, true);
  },
};

// Create the auth router
const router = createAuthRouter<Env>({ hooks: authHooks });

// ... rest of your code ...
```