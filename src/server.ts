import { SignJWT, jwtVerify } from "jose";
import type { AuthHooks } from "./types";

const SESSION_TOKEN_COOKIE = "auth_session_token";
const REFRESH_TOKEN_COOKIE = "auth_refresh_token";

interface TokenPayload {
  userId: string;
  sessionId?: string;
  email?: string;
  aud?: string;
}

async function createSessionToken(
  userId: string,
  secret: string,
  expiresIn: string = "15m",
  email?: string
): Promise<string> {
  const sessionId = crypto.randomUUID();
  const payload: { userId: string; sessionId: string; email?: string } = { 
    userId, 
    sessionId 
  };
  
  // Only include email if provided (for verified users)
  if (email) {
    payload.email = email;
  }
  
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("SESSION")
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(secret));
}

async function createRefreshToken(
  userId: string,
  secret: string,
  expiresIn: string = "7d",
  isTransient: boolean = false
): Promise<string> {
  return await new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(isTransient ? "1h" : expiresIn)  // Short-lived for transient tokens
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
  const cookieHeader = request.headers.get("cookie") || request.headers.get("Cookie");
  
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
          // Parse request body for token expiration times
          const { refreshTokenExpiresIn, sessionTokenExpiresIn } = await request.json() as {
            refreshTokenExpiresIn?: string;
            sessionTokenExpiresIn?: string;
          };

          // Generate a new user ID
          const userId = crypto.randomUUID();

          // Call onNewUser hook if provided
          if (hooks.onNewUser) {
            await hooks.onNewUser({ userId, env, request });
          }

          // Generate new session and refresh tokens with custom expiration times
          const sessionToken = await createSessionToken(
            userId, 
            env.AUTH_SECRET,
            sessionTokenExpiresIn
          );
          const cookieRefreshToken = await createRefreshToken(
            userId, 
            env.AUTH_SECRET,
            refreshTokenExpiresIn || "7d",
            false
          );
          const transientRefreshToken = await createRefreshToken(
            userId,
            env.AUTH_SECRET,
            undefined,
            true
          );

          const response = new Response(
            JSON.stringify({
              userId,
              sessionToken,
              refreshToken: transientRefreshToken,
            }),
            {
              headers: { "Content-Type": "application/json" },
            }
          );

          // Set the auth cookies
          response.headers.append(
            "Set-Cookie",
            `${SESSION_TOKEN_COOKIE}=${sessionToken}; HttpOnly; Secure; SameSite=Strict; Path=/`
          );
          response.headers.append(
            "Set-Cookie",
            `${REFRESH_TOKEN_COOKIE}=${cookieRefreshToken}; HttpOnly; Secure; SameSite=Strict; Path=/`
          );

          return response;
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

          // Generate tokens - long lived for cookie, short lived for response
          const sessionToken = await createSessionToken(
            userId,
            env.AUTH_SECRET,
            "15m",
            email
          );
          const cookieRefreshToken = await createRefreshToken(
            userId,
            env.AUTH_SECRET,
            "7d",  // Long-lived for cookie
            false
          );
          const transientRefreshToken = await createRefreshToken(
            userId,
            env.AUTH_SECRET,
            undefined,  // Use default
            true  // Short-lived for client
          );

          const response = new Response(
            JSON.stringify({
              success: true,
              userId,
              sessionToken,
              refreshToken: transientRefreshToken,  // Send short-lived token in response
            }),
            {
              headers: { "Content-Type": "application/json" },
            }
          );

          // Set the auth cookies with long-lived refresh token
          response.headers.append(
            "Set-Cookie",
            `${SESSION_TOKEN_COOKIE}=${sessionToken}; HttpOnly; Secure; SameSite=Strict; Path=/`
          );
          response.headers.append(
            "Set-Cookie",
            `${REFRESH_TOKEN_COOKIE}=${cookieRefreshToken}; HttpOnly; Secure; SameSite=Strict; Path=/`
          );

          return response;
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
          const cookieRefreshToken = getCookie(request, REFRESH_TOKEN_COOKIE);
          
          // Try Authorization header first (for JS/RN clients), then cookie
          let refreshToken = authHeader?.startsWith("Bearer ")
            ? authHeader.slice(7)
            : cookieRefreshToken;

          if (!refreshToken) {
            return new Response(
              JSON.stringify({ error: "No refresh token provided" }),
              { 
                status: 401,
                headers: { "Content-Type": "application/json" }
              }
            );
          }

          const payload = await verifyToken(refreshToken, env.AUTH_SECRET);

          if (!payload) {
            return new Response(
              JSON.stringify({ error: "Invalid refresh token" }),
              { 
                status: 401,
                headers: { "Content-Type": "application/json" }
              }
            );
          }

          // Get the user's email from storage if available
          let email: string | undefined;
          if (hooks.getUserEmail) {
            email = await hooks.getUserEmail({ userId: payload.userId, env, request });
          }

          const newSessionToken = await createSessionToken(
            payload.userId,
            env.AUTH_SECRET,
            "15m",
            email
          );

          // Generate appropriate refresh tokens
          const newCookieRefreshToken = await createRefreshToken(
            payload.userId,
            env.AUTH_SECRET,
            "7d",
            false
          );
          const newTransientRefreshToken = await createRefreshToken(
            payload.userId,
            env.AUTH_SECRET,
            undefined,
            true
          );

          const response = new Response(
            JSON.stringify({
              success: true,
              sessionToken: newSessionToken,
              refreshToken: newTransientRefreshToken,  // Send short-lived token in response
            }),
            {
              headers: { "Content-Type": "application/json" },
            }
          );

          // Only set cookies if original token was from cookie
          if (cookieRefreshToken) {
            response.headers.append(
              "Set-Cookie",
              `${SESSION_TOKEN_COOKIE}=${newSessionToken}; HttpOnly; Secure; SameSite=Strict; Path=/`
            );
            response.headers.append(
              "Set-Cookie",
              `${REFRESH_TOKEN_COOKIE}=${newCookieRefreshToken}; HttpOnly; Secure; SameSite=Strict; Path=/`
            );
          }

          return response;
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

        case "web-code": {
          // Verify the user is authenticated
          const authHeader = request.headers.get("Authorization");
          if (!authHeader?.startsWith("Bearer ")) {
            return new Response("Unauthorized", { status: 401 });
          }

          const sessionToken = authHeader.slice(7); // Remove 'Bearer ' prefix
          const payload = await verifyToken(sessionToken, env.AUTH_SECRET);

          if (!payload) {
            return new Response("Invalid session token", { status: 401 });
          }

          // Generate a short-lived web auth code using JWT
          // Include email if it exists in the session token
          const jwtPayload: { userId: string; email?: string } = { 
            userId: payload.userId 
          };
          
          if (payload.email) {
            jwtPayload.email = payload.email;
          }
          
          const code = await new SignJWT(jwtPayload)
            .setProtectedHeader({ alg: "HS256" })
            .setAudience("WEB_AUTH")
            .setExpirationTime("5m")
            .sign(new TextEncoder().encode(env.AUTH_SECRET));

          return new Response(
            JSON.stringify({
              code,
              expiresIn: 300 // 5 minutes
            }),
            {
              headers: { "Content-Type": "application/json" }
            }
          );
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

    // Check for web auth code in URL
    const webAuthCode = url.searchParams.get('code');
    if (webAuthCode) {
      try {
        // Verify the web auth code JWT
        const verified = await jwtVerify(
          webAuthCode,
          new TextEncoder().encode(env.AUTH_SECRET),
          { audience: "WEB_AUTH" }
        );

        const payload = verified.payload as { userId: string; email?: string };
        if (!payload.userId) {
          throw new Error('Invalid payload');
        }

        // Create new session for the web client
        const sessionId = crypto.randomUUID();
        
        // Use email from the web auth code if available
        const newSessionToken = await createSessionToken(
          payload.userId, 
          env.AUTH_SECRET,
          "15m",
          payload.email
        );
        const newRefreshToken = await createRefreshToken(payload.userId, env.AUTH_SECRET);

        // Redirect to remove the code from URL
        const redirectUrl = new URL(request.url);
        redirectUrl.searchParams.delete('code');
        
        const response = new Response(null, {
          status: 302,
          headers: {
            'Location': redirectUrl.toString()
          }
        });

        // Set the auth cookies
        response.headers.append(
          "Set-Cookie",
          `${SESSION_TOKEN_COOKIE}=${newSessionToken}; HttpOnly; Secure; SameSite=Strict; Path=/`
        );
        response.headers.append(
          "Set-Cookie",
          `${REFRESH_TOKEN_COOKIE}=${newRefreshToken}; HttpOnly; Secure; SameSite=Strict; Path=/`
        );

        return response;
      } catch (error) {
        // Invalid code, continue with normal auth flow
        console.error('Invalid web auth code:', error);
      }
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
          
          // Get the user's email if available
          let email: string | undefined;
          if (hooks.getUserEmail) {
            email = await hooks.getUserEmail({ userId, env, request });
          }
          
          newSessionToken = await createSessionToken(userId, env.AUTH_SECRET, "15m", email);
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
