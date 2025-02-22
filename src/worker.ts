import { SignJWT, jwtVerify } from "jose";
import type { AuthHooks } from "./types";

const SESSION_TOKEN_COOKIE = "auth_session_token";
const REFRESH_TOKEN_COOKIE = "auth_refresh_token";

interface TokenPayload {
  userId: string;
  sessionId?: string;
  aud?: string;
}

async function createSessionToken(
  userId: string,
  secret: string
): Promise<string> {
  const sessionId = crypto.randomUUID();
  return await new SignJWT({ userId, sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("SESSION")
    .setExpirationTime("15m")
    .sign(new TextEncoder().encode(secret));
}

async function createRefreshToken(
  userId: string,
  secret: string
): Promise<string> {
  return await new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .setAudience("REFRESH")
    .sign(new TextEncoder().encode(secret));
}

async function verifyToken(
  token: string,
  secret: string
): Promise<TokenPayload | null> {
  try {
    const verified = await jwtVerify(token, new TextEncoder().encode(secret));
    const payload = verified.payload as unknown as TokenPayload;

    // For refresh tokens, we only need userId
    if (payload.aud === "REFRESH") {
      if (!payload.userId) {
        return null;
      }
      return payload;
    }

    // For session tokens, we need both userId and sessionId
    if (!payload.userId || !payload.sessionId) {
      return null;
    }
    return payload;
  } catch (error) {
    return null;
  }
}

function getCookie(request: Request, name: string): string | undefined {
  // Try both lowercase and uppercase cookie header
  const cookieHeader = request.headers.get("cookie");
  
  if (!cookieHeader) {
    return undefined;
  }
  
  // Split and trim cookies
  const cookies = cookieHeader.split(";").map(cookie => cookie.trim());
  
  // Find the specific cookie
  const cookie = cookies.find(cookie => cookie.startsWith(`${name}=`));
  
  if (!cookie) {
    return undefined;
  }
  
  // Extract and decode the value
  return decodeURIComponent(cookie.split("=")[1]);
}

function generateVerificationCode(): string {
  // Generate a secure 6-digit code
  const min = 100000; // 6 digits, starting with 1
  const max = 999999;
  const code = Math.floor(Math.random() * (max - min + 1) + min);
  return code.toString();
}

export function createAuthRouter<TEnv extends { AUTH_SECRET: string }>(config: {
  hooks: AuthHooks<TEnv>;
}) {
  const { hooks } = config;

  return async (request: Request, env: TEnv): Promise<Response> => {
    const url = new URL(request.url);
    const path = url.pathname.split("/").filter(Boolean);

    if (path.length < 2 || path[0] !== "auth") {
      return new Response(JSON.stringify({ error: "Not Found" }), { 
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Remove 'auth' from path
    path.shift();
    const route = path.join("/");

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), { 
        status: 405,
        headers: { "Content-Type": "application/json" }
      });
    }

    try {
      switch (route) {
        case "anonymous": {
          // Generate a new user ID
          const userId = crypto.randomUUID();

          // Call onNewUser hook if provided
          if (hooks.onNewUser) {
            await hooks.onNewUser({ userId, env, request });
          }

          // Generate new session and refresh tokens
          const sessionToken = await createSessionToken(userId, env.AUTH_SECRET);
          const refreshToken = await createRefreshToken(userId, env.AUTH_SECRET);

          return new Response(
            JSON.stringify({
              userId,
              sessionToken,
              refreshToken,
            }),
            {
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        case "verify": {
          const { email, code } = (await request.json()) as {
            email: string;
            code: string;
          };

          // Look up the user ID for this email
          let userId = await hooks.getUserIdByEmail({ email, env, request });
          const isNewUser = !userId;

          // Verify the code
          const isValid = await hooks.verifyVerificationCode({
            email,
            code,
            env,
            request,
          });
          if (!isValid) {
            return new Response("Invalid or expired code", { status: 400 });
          }

          if (isNewUser) {
            // Generate a new user ID for new users
            userId = crypto.randomUUID();

            // Call onNewUser hook if provided
            if (hooks.onNewUser) {
              await hooks.onNewUser({ userId, env, request });
            }
          }

          // At this point userId is definitely defined
          if (!userId) {
            return new Response("Failed to create user", { status: 500 });
          }

          // Call authentication hooks
          if (hooks.onAuthenticate) {
            await hooks.onAuthenticate({ userId, email, env, request });
          }

          // Call onEmailVerified for all successful verifications
          if (hooks.onEmailVerified) {
            await hooks.onEmailVerified({ userId, email, env, request });
          }

          // Generate new session and refresh tokens for the authenticated user
          const sessionToken = await createSessionToken(
            userId,
            env.AUTH_SECRET
          );
          const refreshToken = await createRefreshToken(
            userId,
            env.AUTH_SECRET
          );

          return new Response(
            JSON.stringify({
              success: true,
              userId,
              sessionToken,
              refreshToken,
            }),
            {
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        case "request-code": {
          const { email } = (await request.json()) as { email: string };

          // Generate a new verification code
          const code = generateVerificationCode();

          // Store the code
          await hooks.storeVerificationCode({ email, code, env, request });

          // Send the code via email
          const sent = await hooks.sendVerificationCode({
            email,
            code,
            env,
            request,
          });
          if (!sent) {
            return new Response("Failed to send verification code", {
              status: 500,
            });
          }

          return new Response(
            JSON.stringify({
              success: true,
              message: "Code sent to email",
              expiresIn: 600, // 10 minutes
            }),
            {
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        case "refresh": {
          const authHeader = request.headers.get("Authorization");

          if (!authHeader?.startsWith("Bearer ")) {
            return new Response("No refresh token provided", { status: 401 });
          }

          const refreshToken = authHeader.slice(7); // Remove 'Bearer ' prefix

          const payload = await verifyToken(refreshToken, env.AUTH_SECRET);

          if (!payload) {
            return new Response("Invalid refresh token", { status: 401 });
          }

          const newSessionToken = await createSessionToken(
            payload.userId,
            env.AUTH_SECRET
          );
          const newRefreshToken = await createRefreshToken(
            payload.userId,
            env.AUTH_SECRET
          );

          return new Response(
            JSON.stringify({
              success: true,
              sessionToken: newSessionToken,
              refreshToken: newRefreshToken,
            }),
            {
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        case "logout": {
          const response = new Response(JSON.stringify({ success: true }));
          response.headers.append(
            "Set-Cookie",
            `${SESSION_TOKEN_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`
          );
          response.headers.append(
            "Set-Cookie",
            `${REFRESH_TOKEN_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`
          );
          return response;
        }

        default:
          return new Response("Not found", { status: 404 });
      }
    } catch (error) {
      return new Response(JSON.stringify({ error: "Internal server error" }), { 
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  };
}

export function withAuth<TEnv extends { AUTH_SECRET: string }>(
  handler: (
    request: Request,
    env: TEnv,
    { userId, sessionId, sessionToken }: { userId: string; sessionId: string; sessionToken: string }
  ) => Promise<Response>,
  config: {
    hooks: AuthHooks<TEnv>;
  }
) {
  const { hooks } = config;
  const router = createAuthRouter({ hooks });

  return async (request: Request, env: TEnv): Promise<Response> => {
    const url = new URL(request.url);
    // Handle auth routes first
    if (url.pathname.startsWith("/auth/")) {
      return router(request, env);
    }

    const sessionToken = getCookie(request, SESSION_TOKEN_COOKIE);
    const refreshToken = getCookie(request, REFRESH_TOKEN_COOKIE);

    let userId: string;
    let sessionId: string;
    let newSessionToken: string | undefined;
    let newRefreshToken: string | undefined;
    let currentSessionToken: string;

    // First try to verify the session token
    if (sessionToken) {
      const payload = await verifyToken(sessionToken, env.AUTH_SECRET);
      if (payload && payload.aud === 'SESSION') {
        // Valid session token
        userId = payload.userId;
        sessionId = payload.sessionId || crypto.randomUUID();
        currentSessionToken = sessionToken;
      } else if (refreshToken) {
        // Invalid session token but has refresh token
        const refreshPayload = await verifyToken(refreshToken, env.AUTH_SECRET);
        if (refreshPayload && refreshPayload.aud === 'REFRESH') {
          // Valid refresh token, create new session
          userId = refreshPayload.userId;
          sessionId = crypto.randomUUID();
          newSessionToken = await createSessionToken(userId, env.AUTH_SECRET);
          newRefreshToken = await createRefreshToken(userId, env.AUTH_SECRET);
          currentSessionToken = newSessionToken;
        } else {
          // Invalid refresh token, create new anonymous user
          userId = crypto.randomUUID();
          sessionId = userId;
          newSessionToken = await createSessionToken(userId, env.AUTH_SECRET);
          newRefreshToken = await createRefreshToken(userId, env.AUTH_SECRET);
          currentSessionToken = newSessionToken;

          if (hooks.onNewUser) {
            await hooks.onNewUser({ userId, env, request });
          }
        }
      } else {
        // No refresh token, create new anonymous user
        userId = crypto.randomUUID();
        sessionId = userId;
        newSessionToken = await createSessionToken(userId, env.AUTH_SECRET);
        newRefreshToken = await createRefreshToken(userId, env.AUTH_SECRET);
        currentSessionToken = newSessionToken;

        if (hooks.onNewUser) {
          await hooks.onNewUser({ userId, env, request });
        }
      }
    } else {
      // No session token, create new anonymous user
      userId = crypto.randomUUID();
      sessionId = userId;
      newSessionToken = await createSessionToken(userId, env.AUTH_SECRET);
      newRefreshToken = await createRefreshToken(userId, env.AUTH_SECRET);
      currentSessionToken = newSessionToken;

      if (hooks.onNewUser) {
        await hooks.onNewUser({ userId, env, request });
      }
    }

    const response = await handler(request, env, { userId, sessionId, sessionToken: currentSessionToken });

    if (newSessionToken) {
      response.headers.append(
        "Set-Cookie",
        `${SESSION_TOKEN_COOKIE}=${newSessionToken}; HttpOnly; Secure; SameSite=Strict; Path=/`
      );
    }
    if (newRefreshToken) {
      response.headers.append(
        "Set-Cookie",
        `${REFRESH_TOKEN_COOKIE}=${newRefreshToken}; HttpOnly; Secure; SameSite=Strict; Path=/`
      );
    }

    return response;
  };
}

export { AuthHooks } from "./types";
