# 🔐 Auth Kit

A full-stack authentication toolkit for React applications built on Cloudflare Workers. Auth Kit provides a secure, low-latency authentication system with email verification and token management. Perfect for applications that need a robust auth system with a great developer experience.

## Table of Contents

- [Installation](#installation)
- [Key Features](#key-features)
- [Usage Guide](#usage-guide)
  - [1️⃣ Set up Environment and Worker](#1️⃣-set-up-environment-and-worker)
  - [2️⃣ Access Auth in React Router Routes](#2️⃣-access-auth-in-react-router-routes)
  - [3️⃣ Configure Worker](#3️⃣-configure-worker)
  - [4️⃣ Set up Auth Client and React Integration](#4️⃣-set-up-auth-client-and-react-integration)
- [Architecture](#architecture)
- [API Reference](#api-reference)
- [Troubleshooting](#troubleshooting)
- [TypeScript Types](#typescript-types)

## Installation

```bash
npm install @open-game-collective/auth-kit
# or
yarn add @open-game-collective/auth-kit
# or
pnpm add @open-game-collective/auth-kit
```

## Key Features

- 🎭 **Anonymous-First Auth**: Users start with an anonymous session that can be upgraded to a verified account.
- 📧 **Email Verification**: Secure email verification flow with customizable storage and delivery options.
- 🔐 **JWT-Based Tokens**: Secure session and refresh tokens with automatic refresh.
- ⚡️ **Edge-Ready**: Optimized for Cloudflare Workers for minimal latency.
- 🎯 **Type-Safe**: Full TypeScript support with detailed types.
- 🎨 **React Integration**: Ready-to-use hooks and components for auth state management.
- 🔌 **Customizable**: Integrate with your own storage and email delivery systems.

## Usage Guide

### Web Applications (with Remix and Cloudflare Workers)

For web applications using Remix and Cloudflare Workers, here's how to set up authentication:

```typescript
// app/worker.ts
import { AuthHooks, withAuth } from "@open-game-collective/auth-kit/worker";
import { createRequestHandler, logDevReady } from "@remix-run/cloudflare";
import * as build from "@remix-run/dev/server-build";
import { Env } from "./env";

if (process.env.NODE_ENV === "development") {
  logDevReady(build);
}

const handleRemixRequest = createRequestHandler(build);

const authHooks: AuthHooks<Env> = {
  getUserIdByEmail: async ({ email, env, request }) => {
    return await env.KV_STORAGE.get(`email:${email}`);
  },

  storeVerificationCode: async ({ email, code, env, request }) => {
    await env.KV_STORAGE.put(`code:${email}`, code, {
      expirationTtl: 600,
    });
  },

  verifyVerificationCode: async ({ email, code, env, request }) => {
    const storedCode = await env.KV_STORAGE.get(`code:${email}`);
    return storedCode === code;
  },

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

  onNewUser: async ({ userId, env, request }) => {
    await env.KV_STORAGE.put(
      `user:${userId}`,
      JSON.stringify({
        created: new Date().toISOString(),
      })
    );
  },

  onAuthenticate: async ({ userId, email, env, request }) => {
    await env.KV_STORAGE.put(
      `user:${userId}:lastLogin`,
      new Date().toISOString()
    );
  },

  onEmailVerified: async ({ userId, email, env, request }) => {
    await env.KV_STORAGE.put(`user:${userId}:verified`, "true");
    await env.KV_STORAGE.put(`email:${email}`, userId);
  },
};

const handler = withAuth<Env>(
  async (request, env, { userId, sessionId, sessionToken }) => {
    try {
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

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return handler(request, env);
  },
};

// app/root.tsx
import { createAuthClient } from "@open-game-collective/auth-kit/client";
import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import {
  json,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "@remix-run/react";
import { useState } from "react";
import { AuthProvider } from "./context/auth-context";

interface LoaderData {
  userId: string;
  sessionToken: string;
  host: string;
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  return json<LoaderData>({
    userId: context.userId,
    sessionToken: context.sessionToken,
    host: context.env.WEB_HOST,
  });
}

export default function App() {
  const { userId, sessionToken, host } = useLoaderData<typeof loader>();

  const [authClient] = useState(
    createAuthClient({
      host,
      userId,
      sessionToken,
    })
  );

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <AuthProvider client={authClient}>
          <Outlet />
        </AuthProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
```

The setup above demonstrates:
1. Worker setup with auth hooks for KV storage and email verification
2. Root component that initializes the auth client with user context from the loader
3. Integration with Remix's loader data and context providers

### Mobile Applications (React Native)

For mobile applications, you'll need to explicitly manage user creation and token storage:

```typescript
// app/auth.ts
import { createAnonymousUser, createAuthClient } from "@open-game-collective/auth-kit/client";
import AsyncStorage from '@react-native-async-storage/async-storage';

const AUTH_KEYS = {
  USER_ID: 'auth_user_id',
  SESSION_TOKEN: 'auth_session_token',
  REFRESH_TOKEN: 'auth_refresh_token'
} as const;

export async function initializeAuth() {
  // Try to load existing tokens
  const [userId, sessionToken, refreshToken] = await Promise.all([
    AsyncStorage.getItem(AUTH_KEYS.USER_ID),
    AsyncStorage.getItem(AUTH_KEYS.SESSION_TOKEN),
    AsyncStorage.getItem(AUTH_KEYS.REFRESH_TOKEN)
  ]);

  // If we have existing tokens, create client with them
  if (userId && sessionToken) {
    return createAuthClient({
      host: "your-worker.workers.dev",
      userId,
      sessionToken
    });
  }

  // Otherwise create a new anonymous user
  const tokens = await createAnonymousUser("your-worker.workers.dev");
  
  // Store the tokens
  await Promise.all([
    AsyncStorage.setItem(AUTH_KEYS.USER_ID, tokens.userId),
    AsyncStorage.setItem(AUTH_KEYS.SESSION_TOKEN, tokens.sessionToken),
    AsyncStorage.setItem(AUTH_KEYS.REFRESH_TOKEN, tokens.refreshToken)
  ]);

  // Create and return the client
  return createAuthClient({
    host: "your-worker.workers.dev",
    userId: tokens.userId,
    sessionToken: tokens.sessionToken
  });
}

// App.tsx
import { AuthContext } from "./auth.context";

export default function App() {
  const [client, setClient] = useState<AuthClient | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    initializeAuth()
      .then(setClient)
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) {
    return <LoadingScreen />;
  }

  return (
    <AuthContext.Provider client={client!}>
      <NavigationContainer>
        <YourApp />
      </NavigationContainer>
    </AuthContext.Provider>
  );
}

// Usage in components
function ProfileScreen() {
  const client = AuthContext.useClient();
  const isVerified = AuthContext.useSelector(state => state.isVerified);

  const verifyEmail = async () => {
    await client.requestCode('user@example.com');
    // Show verification code input...
  };

  return (
    <View>
      <AuthContext.Unverified>
        <Button title="Verify Email" onPress={verifyEmail} />
      </AuthContext.Unverified>
      <AuthContext.Verified>
        <Text>Welcome back!</Text>
      </AuthContext.Verified>
    </View>
  );
}
```

The key differences between web and mobile implementations:

1. **Web Applications**
   - Use `withAuth` middleware for automatic token management
   - Tokens are stored in HTTP-only cookies
   - Anonymous users are created automatically

2. **Mobile Applications**
   - Use `createAnonymousUser` for explicit user creation
   - Tokens are stored in secure storage (e.g., AsyncStorage)
   - Need to handle token persistence manually
   - Refresh token can be used for longer sessions

## Architecture

Auth Kit is comprised of three core components:

1. **Worker Middleware (`auth-kit/worker`)**
   - Handles all `/auth/*` routes automatically.
   - Manages JWT-based session tokens (15 minutes) and refresh tokens (7 days).
   - Creates anonymous users when no valid session exists.
   - Supplies `userId` and `sessionId` to your React Router loaders.

2. **Auth Client (`auth-kit/client`)**
   - Manages client-side auth state.
   - Automatically refreshes tokens.
   - Provides methods for email verification and logout.
   - Supports state subscriptions and pub/sub updates.

3. **React Integration (`auth-kit/react`)**
   - Offers hooks for accessing auth state.
   - Provides conditional components for loading, authentication, and verification states.
   - Leverages Suspense for efficient UI updates.

## API Reference

### 🔐 auth-kit/client

`createAnonymousUser(host: string): Promise<AuthTokens>`

Creates a new anonymous user and returns their tokens. This is a standalone function that should be used before creating the auth client, particularly useful for mobile clients or when you need explicit control over user creation.

Example:
```typescript
// First create an anonymous user
const { userId, sessionToken, refreshToken } = await createAnonymousUser('localhost:8787');

// Then create the client with the tokens
const client = createAuthClient({
  host: 'localhost:8787',
  userId,
  sessionToken
});
```

`createAuthClient(config)`

Creates a new auth client instance.

Example:
```typescript
const client = createAuthClient({
  host: "localhost:8787",
  userId: "user_id_from_cookie",
  sessionToken: "session_token_from_cookie",
  onStateChange: state => console.log("Auth state updated:", state),
  onError: error => console.error("Auth error:", error)
});
```

Methods provided:
- `requestCode(email)`: Initiates the email verification process.
- `verifyEmail(email, code)`: Verifies the user's email with the provided code.
- `logout()`: Logs out the current user.
- `refresh()`: Refreshes the session token.

### 🖥️ auth-kit/worker

`withAuth<TEnv>(handler, config)`

A middleware that handles authentication and supplies user context to your worker functions. It manages:
- Automatic anonymous user creation.
- JWT-based session and refresh tokens.
- Secure, HTTP-only cookie handling.

### ⚛️ auth-kit/react

`createAuthContext()`

Creates a React context for auth state management, providing:
- A Provider for passing down the auth client.
- Hooks: `useClient` and `useSelector` for accessing and subscribing to state.
- Conditional components: `<Loading>`, `<Authenticated>`, `<Verified>`, and `<Unverified>`.

## Troubleshooting

- Ensure that environment variables (`AUTH_SECRET`, `SENDGRID_API_KEY`, etc.) are correctly set.
- Verify that the Cloudflare Worker and KV namespace configurations are correct.
- Make sure that cookies are being set and sent with requests appropriately.
- Check browser console logs or Cloudflare Worker logs for debug messages.
- For further assistance, please open an issue on our GitHub repository.

## TypeScript Types

Example types:
```typescript
export interface Env {
  AUTH_SECRET: string;
  SENDGRID_API_KEY: string;
  KV_STORAGE: KVNamespace;
  [key: string]: unknown;
}

export type AuthState = {
  isLoading: boolean;
  host: string;
  userId: string;
  sessionToken: string;
  refreshToken: string | null;
  isVerified: boolean;
  error?: string;
};
```

Detailed API types are available within the package for full type-safety.

---

Happy Coding! 🔐