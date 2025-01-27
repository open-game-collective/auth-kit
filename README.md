# 🔐 Auth Kit

A full-stack authentication toolkit for React applications. Built on Cloudflare Workers, Auth Kit provides a secure, low-latency authentication system with email verification and token management. Perfect for applications that need a robust auth system with a great developer experience.

## 📚 Table of Contents

- [💾 Installation](#-installation)
- [🌟 Key Features](#-key-features)
- [🛠️ Usage Guide](#️-usage-guide)
  - [1️⃣ Set up Environment Types](#1️⃣-set-up-environment-types)
  - [2️⃣ Set up Worker Entry Point](#2️⃣-set-up-worker-entry-point)
  - [3️⃣ Access Auth in Remix Routes](#3️⃣-access-auth-in-remix-routes)
  - [4️⃣ Configure Worker](#4️⃣-configure-worker)
  - [5️⃣ Set up Auth Client and React Integration](#5️⃣-set-up-auth-client-and-react-integration)
- [🏗️ Architecture](#️-architecture)
- [📖 API Reference](#-api-reference)
  - [🔐 auth-kit/client](#-auth-kitclient)
  - [🖥️ auth-kit/worker](#️-auth-kitworker)
  - [⚛️ auth-kit/react](#️-auth-kitreact)
- [🔑 TypeScript Types](#-typescript-types)

## 💾 Installation

```bash
npm install auth-kit jose
# or
yarn add auth-kit jose
# or
pnpm add auth-kit jose
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

### 1️⃣ Set up Environment Types

First, set up your environment types to include auth-kit's additions to the Remix context:

```typescript
// app/types/env.ts
declare module "@remix-run/cloudflare" {
  interface AppLoadContext {
    env: Env;
    // Added by auth-kit middleware
    userId: string;
    sessionId: string;
  }
}

export interface Env {
  // Required for auth-kit
  AUTH_SECRET: string;

  // Storage for users and verification codes
  USERS_KV: KVNamespace;
  CODES_KV: KVNamespace;

  // Email service (optional)
  SENDGRID_API_KEY?: string;
  RESEND_API_KEY?: string;

  // Your other environment variables
  [key: string]: unknown;
}
```

### 2️⃣ Set up Worker Entry Point

Create your worker entry point that wraps the Remix handler:

```typescript
// src/worker.ts
import { createAuthRouter, withAuth, type AuthHooks } from "auth-kit/worker";
import { createRequestHandler } from "@remix-run/cloudflare";
import * as build from "@remix-run/dev/server-build";
import type { Env } from "./types/env";

// Configure your auth hooks with proper environment typing
const authHooks: AuthHooks<Env> = {
  // Required: Look up a user ID by email address
  getUserIdByEmail: async ({ email, env }) => {
    return await env.USERS_KV.get(`email:${email}`);
  },

  // Required: Store a verification code
  storeVerificationCode: async ({ email, code, env }) => {
    await env.CODES_KV.put(`code:${email}`, code, { 
      expirationTtl: 600 
    });
  },

  // Required: Verify a code
  verifyVerificationCode: async ({ email, code, env }) => {
    const storedCode = await env.CODES_KV.get(`code:${email}`);
    return storedCode === code;
  },

  // Required: Send verification code via email
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

  // Optional: Called when new users are created
  onNewUser: async ({ userId, env }) => {
    await env.USERS_KV.put(
      `user:${userId}`,
      JSON.stringify({
        created: new Date().toISOString(),
      })
    );
  },

  // Optional: Called on successful authentication
  onAuthenticate: async ({ userId, email, env }) => {
    await env.USERS_KV.put(
      `user:${userId}:lastLogin`,
      new Date().toISOString()
    );
  },

  // Optional: Called when email is verified
  onEmailVerified: async ({ userId, email, env }) => {
    await env.USERS_KV.put(`user:${userId}:verified`, "true");
    await env.USERS_KV.put(`email:${email}`, userId);
  },
};

// Create request handler with auth middleware
const handleRequest = createRequestHandler(build, process.env.NODE_ENV);

// Export the worker with auth middleware
export default {
  fetch: withAuth<Env>(
    async (request, env) => {
      try {
        // Pass userId and sessionId to Remix loader context
        const loadContext = {
          env,
          userId: env.userId,
          sessionId: env.sessionId,
        };
        return await handleRequest(request, loadContext);
      } catch (error) {
        console.error("Error processing request:", error);
        return new Response("Internal Error", { status: 500 });
      }
    },
    { hooks: authHooks }
  ),
};
```

### 3️⃣ Access Auth in Remix Routes

Now you can access the authenticated user in your Remix routes:

```typescript
// app/routes/_index.tsx
import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { useLoaderData } from "@remix-run/react";

export async function loader({ context }: LoaderFunctionArgs) {
  // Access userId and sessionId from context
  const { userId, sessionId } = context;

  // Example: Fetch user data from KV
  const userData = await context.env.USERS_KV.get(`user:${userId}`);

  return json({
    userId,
    sessionId,
    userData: userData ? JSON.parse(userData) : null,
  });
}

export default function Index() {
  const { userId, userData } = useLoaderData<typeof loader>();

  return (
    <div>
      <h1>Welcome, {userId}!</h1>
      {userData?.verified && <p>✅ Email verified</p>}
    </div>
  );
}
```

### 4️⃣ Configure Worker

Configure your worker in `wrangler.toml`:

```toml
name = "my-remix-app"
main = "src/worker.ts"
compatibility_date = "2024-01-01"

[vars]
NODE_ENV = "development"

# KV Namespaces for auth storage
kv_namespaces = [
  { binding = "USERS_KV", id = "..." },
  { binding = "CODES_KV", id = "..." }
]

# Secrets (use wrangler secret put for production)
# - AUTH_SECRET
# - SENDGRID_API_KEY
```

Deploy your worker:

```bash
wrangler deploy
```

### 5️⃣ Set up Auth Client and React Integration

First, create your auth client:

```typescript
// app/auth.client.ts
import { createAuthClient } from "auth-kit/client";

export const authClient = createAuthClient({
  baseUrl: "https://your-worker.workers.dev",
});
```

Then create your auth context:

```typescript
// app/auth.context.ts
import { createAuthContext } from "auth-kit/react";

export const AuthContext = createAuthContext();
```

Set up the provider in your root component:

```typescript
// app/root.tsx
import { AuthContext } from "./auth.context";
import { authClient } from "./auth.client";

export default function App() {
  return (
    <AuthContext.Provider client={authClient}>
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
  // Use the useSelector hook for fine-grained state updates
  const userId = AuthContext.useSelector(state => state.userId);
  const isVerified = AuthContext.useSelector(state => state.isVerified);
  
  // Or use the useAuth hook for all auth state and methods
  const { requestCode, verifyEmail, logout } = AuthContext.useAuth();

  const handleVerify = async (email: string, code: string) => {
    try {
      await verifyEmail(email, code);
      // Handle success
    } catch (error) {
      // Handle error
    }
  };

  return (
    <div>
      <h1>Profile</h1>
      
      {/* Show loading state */}
      <AuthContext.Loading>
        <div>Loading...</div>
      </AuthContext.Loading>

      {/* Only show when user is authenticated */}
      <AuthContext.Authenticated>
        <p>User ID: {userId}</p>
        
        {/* Content for verified users */}
        <AuthContext.Verified>
          <div>
            <h2>Welcome back!</h2>
            <button onClick={logout}>Logout</button>
          </div>
        </AuthContext.Verified>
        
        {/* Email verification flow for unverified users */}
        <AuthContext.Unverified>
          <div>
            <h2>Verify your email</h2>
            <EmailVerificationForm onVerify={handleVerify} />
          </div>
        </AuthContext.Unverified>
      </AuthContext.Authenticated>
    </div>
  );
}

// Example email verification form
function EmailVerificationForm({ onVerify }: { onVerify: (email: string, code: string) => Promise<void> }) {
  const { requestCode } = AuthContext.useAuth();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");

  const handleRequestCode = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await requestCode(email);
      setStep("code");
    } catch (error) {
      // Handle error
    }
  };

  const handleVerifyCode = async (e: FormEvent) => {
    e.preventDefault();
    await onVerify(email, code);
  };

  if (step === "email") {
    return (
      <form onSubmit={handleRequestCode}>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="Enter your email"
        />
        <button type="submit">Send Code</button>
      </form>
    );
  }

  return (
    <form onSubmit={handleVerifyCode}>
      <input
        type="text"
        value={code}
        onChange={e => setCode(e.target.value)}
        placeholder="Enter verification code"
      />
      <button type="submit">Verify</button>
    </form>
  );
}
```

The React integration provides:

1. **State Management**
   - `useSelector`: Subscribe to specific parts of auth state
   - `useAuth`: Access all auth state and methods
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

Auth Kit uses a combination of session tokens (15-minute expiry) and refresh tokens (7-day expiry) to manage authentication state. The system follows an anonymous-first approach where new users are automatically created with a session, which can later be associated with an email through verification.

### Token Flow

```mermaid
sequenceDiagram
    participant Client
    participant Worker

    Client->>Worker: Initial Request
    Worker->>Worker: Create Anonymous User
    Worker->>Client: Set Session & Refresh Tokens

    Note over Client,Worker: After 15 minutes...
    Client->>Worker: Request with Expired Session
    Worker->>Worker: Verify Refresh Token
    Worker->>Client: New Session & Refresh Tokens
```

## 📖 API Reference

### 🔐 auth-kit/client

#### `createAuthClient(config)`

Creates an auth client instance.

```typescript
interface AuthClientConfig {
  baseUrl: string;
  initialState?: Partial<AuthState>;
  onStateChange?: (state: AuthState) => void;
  onError?: (error: Error) => void;
}

const client = createAuthClient(config);
```

#### Client Methods

```typescript
interface AuthClient {
  // State Management
  getState(): AuthState;
  subscribe(callback: (state: AuthState) => void): () => void;

  // Auth Operations
  createAnonymousUser(): Promise<void>;
  requestCode(email: string): Promise<void>;
  verifyEmail(email: string, code: string): Promise<{ success: boolean }>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
}
```

### 🖥️ auth-kit/worker

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

#### Middleware

```typescript
const handler = withAuth(requestHandler, {
  hooks?: {
    onNewUser?: (props: { userId: string; env: TEnv; request: Request }) => Promise<void>;
    onEmailVerified?: (props: { userId: string; email: string; env: TEnv; request: Request }) => Promise<void>;
  }
});
```

### ⚛️ auth-kit/react

#### `createAuthContext()`

Creates a React context with hooks and components for auth state management.

```typescript
const AuthContext = createAuthContext();

// Returns:
{
  // Core Provider Component
  Provider: React.FC<{
    children: ReactNode;
    client: AuthClient;
    initializing?: ReactNode;
  }>;

  // Hooks
  useClient(): AuthClient;
  useSelector<T>(selector: (state: AuthState) => T): T;
  useAuth(): AuthState & AuthMethods;

  // State-Based Components
  Loading: React.FC<{ children: ReactNode }>;
  Verified: React.FC<{ children: ReactNode }>;
  Unverified: React.FC<{ children: ReactNode }>;
  Authenticated: React.FC<{ children: ReactNode }>;
}
```

#### Using Selectors

```typescript
// Select specific state values
const userId = AuthContext.useSelector((state) => state.userId);
const isVerified = AuthContext.useSelector((state) => state.isVerified);

// Select multiple values
const { userId, isVerified } = AuthContext.useSelector((state) => ({
  userId: state.userId,
  isVerified: state.isVerified,
}));
```

#### Using State Components

```typescript
<AuthContext.Loading>
  <LoadingSpinner />
</AuthContext.Loading>

<AuthContext.Authenticated>
  <AuthContext.Verified>
    <VerifiedUserContent />
  </AuthContext.Verified>

  <AuthContext.Unverified>
    <EmailVerificationFlow />
  </AuthContext.Unverified>
</AuthContext.Authenticated>
```

## 🔑 TypeScript Types

### Auth State

```typescript
type AuthState = {
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
```

### Environment Types

```typescript
interface Env {
  AUTH_SECRET: string;
  USER: DurableObjectNamespace;
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
      await sendEmail({
        to: email,
        subject: "Your verification code",
        text: `Your code is: ${code}`,
      });
      return true;
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