import { jwtVerify } from "jose";
import {
  createAuthHandler as baseCreateAuthHandler,
  createAuthMiddleware as baseCreateAuthMiddleware,
  createAuthRouter,
  createLinkToken,
  verifySession,
  withAuth as baseWithAuth,
} from "./server";
import { ProviderAuthHooks } from "./types";

// Add ExecutionContext type definition
type ExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
};

/**
 * Creates a provider auth router for handling account linking
 */
export function createProviderAuthRouter<TEnv extends { AUTH_SECRET: string }>(
  hooksOrConfig:
    | ProviderAuthHooks<TEnv>
    | {
        hooks: ProviderAuthHooks<TEnv>;
        useTopLevelDomain?: boolean;
        basePath?: string;
      }
) {
  // Extract hooks and config
  let hooks: ProviderAuthHooks<TEnv>;
  let useTopLevelDomain = false;
  let basePath = "/auth";

  if ("hooks" in hooksOrConfig) {
    hooks = hooksOrConfig.hooks;
    useTopLevelDomain = hooksOrConfig.useTopLevelDomain || false;
    basePath = hooksOrConfig.basePath || "/auth";
  } else {
    hooks = hooksOrConfig;
  }

  // Create base auth router
  const baseRouter = createAuthRouter<TEnv>({
    hooks,
    useTopLevelDomain,
    basePath,
  });

  // Normalize base path
  const normalizedBasePath = basePath.startsWith("/") ? basePath.substring(1) : basePath;

  return {
    async getLinkedAccounts(request: Request, env?: TEnv): Promise<Response> {
      // Verify session token
      const session = verifySession(request);
      if (!session) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Get linked accounts
      const linkedAccounts = await hooks.getLinkedAccounts({
        openGameUserId: session.userId,
        env: env as TEnv,
      });

      return new Response(
        JSON.stringify({
          accounts: linkedAccounts,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    },

    async createAccountLinkToken(request: Request, env?: TEnv): Promise<Response> {
      // Verify session token
      const session = verifySession(request);
      if (!session) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      try {
        const { gameId } = await request.json();

        if (!gameId) {
          return new Response(JSON.stringify({ error: "Missing gameId" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        // Get user email if available
        let email = null;
        if (hooks.getUserEmail) {
          email = await hooks.getUserEmail({
            userId: session.userId,
            env: env as TEnv,
          });
        }

        // Create link token
        const linkToken = await createLinkToken(
          session.userId,
          email,
          gameId,
          (env as TEnv).AUTH_SECRET
        );

        // Calculate expiration time (1 hour from now)
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

        return new Response(
          JSON.stringify({
            linkToken,
            expiresAt,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      } catch (error) {
        console.error("Error creating link token:", error);
        return new Response(JSON.stringify({ error: "Failed to create link token" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    },

    async unlinkAccount(request: Request, gameId: string, env?: TEnv): Promise<Response> {
      // Verify session token
      const session = verifySession(request);
      if (!session) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      try {
        // Remove account link
        if (!hooks.removeAccountLink) {
          return new Response(JSON.stringify({ error: "Operation not supported" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const success = await hooks.removeAccountLink({
          openGameUserId: session.userId,
          gameId,
          env: env as TEnv,
        });

        return new Response(JSON.stringify({ success }), {
          status: success ? 200 : 400,
          headers: { "Content-Type": "application/json" },
        });
      } catch (error) {
        // Check if the error is because the game was not found
        if (error instanceof Error && error.message === "Game not found") {
          return new Response(JSON.stringify({ error: "Game not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }

        // Handle other errors
        return new Response(JSON.stringify({ error: "Failed to unlink account" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    },

    async verifyLinkToken(request: Request, env?: TEnv): Promise<Response> {
      try {
        // Verify API key
        const apiKey = request.headers.get("X-API-Key");
        if (!apiKey) {
          return new Response(JSON.stringify({ error: "Missing API key" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        // Get game ID from API key
        const gameId = await hooks.getGameIdFromApiKey({
          apiKey,
          env: env as TEnv,
        });

        if (!gameId) {
          return new Response(JSON.stringify({ error: "Invalid API key" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        // Get request body
        const body = await request.json();
        const { token } = body;

        if (!token) {
          return new Response(JSON.stringify({ error: "Missing token" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        try {
          // Verify token
          const { payload } = await jwtVerify(
            token,
            new TextEncoder().encode((env as TEnv).AUTH_SECRET),
            {
              audience: "LINK",
            }
          );

          // Check if token is for this game
          if (payload.gameId !== gameId) {
            return new Response(JSON.stringify({ error: "Invalid token for this game" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          return new Response(
            JSON.stringify({
              valid: true,
              userId: payload.userId,
              email: payload.email,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        } catch (error) {
          console.error("Error verifying link token:", error);
          return new Response(JSON.stringify({ valid: false }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
      } catch (error) {
        console.error("Error verifying link token:", error);
        return new Response(JSON.stringify({ error: "Failed to verify link token" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    },

    async confirmLink(request: Request, env: TEnv): Promise<Response> {
      try {
        const apiKey = request.headers.get("X-API-Key");
        if (!apiKey) {
          return new Response(JSON.stringify({ error: "API key is required" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const gameId = await hooks.getGameIdFromApiKey({
          apiKey,
          env,
        });

        if (!gameId) {
          return new Response(JSON.stringify({ error: "Invalid API key" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const body = await request.json();
        const { userId, openGameUserId, email } = body;

        if (!userId || !openGameUserId || !email) {
          return new Response(JSON.stringify({ error: "Missing required fields" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        await hooks.storeAccountLink({
          gameId,
          gameUserId: userId,
          openGameUserId,
          env,
        });

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch (error) {
        console.error("Error confirming link:", error);
        return new Response(JSON.stringify({ error: "Failed to confirm link" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
    },

    async handle(request: Request, env?: TEnv, ctx?: ExecutionContext): Promise<Response> {
      const url = new URL(request.url);
      const pathSegments = url.pathname.split("/").filter(Boolean);

      // Check if the request path starts with the base path
      if (pathSegments.length < 1 || pathSegments[0] !== normalizedBasePath) {
        return new Response(JSON.stringify({ error: "Not Found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Remove base path from path segments
      pathSegments.shift();

      // Handle provider-specific routes
      if (pathSegments.length > 0) {
        const route = pathSegments[0];

        switch (route) {
          case "linked-accounts": {
            if (request.method === "GET") {
              return this.getLinkedAccounts(request, env);
            }
            if (request.method === "DELETE" && pathSegments.length > 1) {
              const gameId = pathSegments[1];
              return this.unlinkAccount(request, gameId, env);
            }
            break;
          }
          case "account-link-token": {
            if (request.method === "POST") {
              return this.createAccountLinkToken(request, env);
            }
            break;
          }
          case "verify-link-token": {
            if (request.method === "POST") {
              return this.verifyLinkToken(request, env);
            }
            break;
          }
          case "confirm-link": {
            if (request.method === "POST") {
              // Make sure env is defined before passing it
              if (!env) {
                return new Response(
                  JSON.stringify({ error: "Server error: Missing environment" }),
                  {
                    status: 500,
                    headers: { "Content-Type": "application/json" },
                  }
                );
              }
              return this.confirmLink(request, env);
            }
            break;
          }
        }
      }

      // If no provider-specific route matched, fall back to base auth router
      if (!env) {
        return new Response(JSON.stringify({ error: "Server error: Missing environment" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Call the baseRouter function directly instead of accessing a handle property
      return baseRouter(request, env, ctx);
    },
  };
}

/**
 * Creates a provider authentication middleware that handles session validation and creation
 * but does not include route handling for auth endpoints.
 */
export function createAuthMiddleware<TEnv extends { AUTH_SECRET: string }>(config: {
  hooks: ProviderAuthHooks<TEnv>;
  useTopLevelDomain?: boolean;
}) {
  // Use the base middleware since provider hooks extend base hooks
  return baseCreateAuthMiddleware(config);
}

/**
 * Creates a provider middleware that applies authentication and sets cookies
 * but does not include route handling for auth endpoints.
 */
export function createAuthHandler<TEnv extends { AUTH_SECRET: string }>(
  handler: (
    request: Request,
    env: TEnv,
    { userId, sessionId, sessionToken }: { userId: string; sessionId: string; sessionToken: string }
  ) => Promise<Response>,
  config: {
    hooks: ProviderAuthHooks<TEnv>;
    useTopLevelDomain?: boolean;
  }
) {
  // Use the base handler since provider hooks extend base hooks
  return baseCreateAuthHandler(handler, config);
}

/**
 * Middleware that adds authentication to a request handler for provider routes
 */
export function withAuth<TEnv extends { AUTH_SECRET: string }>(
  handler: (
    request: Request,
    env: TEnv,
    { userId, sessionId, sessionToken }: { userId: string; sessionId: string; sessionToken: string }
  ) => Promise<Response>,
  config: {
    hooks: ProviderAuthHooks<TEnv>;
    useTopLevelDomain?: boolean;
    basePath?: string;
  }
) {
  // Use the base withAuth function since the provider hooks extend the base hooks
  return baseWithAuth(handler, config);
}

// Export types
export type { ProviderAuthHooks } from "./types";
