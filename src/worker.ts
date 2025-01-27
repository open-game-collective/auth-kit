import { SignJWT, jwtVerify } from "jose";
import type { AuthHooks } from "./types";

const SESSION_TOKEN_COOKIE = "auth_session_token";
const REFRESH_TOKEN_COOKIE = "auth_refresh_token";

interface TokenPayload {
  userId: string;
  sessionId?: string;
  aud?: string;
}

async function createSessionToken(userId: string, secret: string): Promise<string> {
  const sessionId = crypto.randomUUID();
  return await new SignJWT({ userId, sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("SESSION")
    .setExpirationTime("15m")
    .sign(new TextEncoder().encode(secret));
}

async function createRefreshToken(userId: string, secret: string): Promise<string> {
  return await new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .setAudience("REFRESH")
    .sign(new TextEncoder().encode(secret));
}

async function verifyToken(token: string, secret: string): Promise<TokenPayload | null> {
  try {
    const verified = await jwtVerify(token, new TextEncoder().encode(secret));
    console.log('JWT verify result:', verified);
    const payload = verified.payload as unknown as TokenPayload;
    console.log('Parsed payload:', payload);
    
    // For refresh tokens, we only need userId
    if (payload.aud === 'REFRESH') {
      if (!payload.userId) {
        console.log('Missing userId in refresh token');
        return null;
      }
      return payload;
    }
    
    // For session tokens, we need both userId and sessionId
    if (!payload.userId || !payload.sessionId) {
      console.log('Missing required fields in session token');
      return null;
    }
    return payload;
  } catch (error) {
    console.log('JWT verify error:', error);
    return null;
  }
}

function getCookie(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return undefined;
  
  const cookies = cookieHeader.split(';').map(cookie => cookie.trim());
  const cookie = cookies.find(cookie => cookie.startsWith(`${name}=`));
  return cookie ? cookie.split('=')[1] : undefined;
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
      return new Response("Not Found", { status: 404 });
    }

    // Remove 'auth' from path
    path.shift();
    const route = path.join("/");

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      switch (route) {
        case "verify": {
          const { email, code } = await request.json() as { email: string; code: string };
          
          // Look up the user ID for this email
          let userId = await hooks.getUserIdByEmail({ email, env, request });
          const isNewUser = !userId;
          
          // Verify the code
          const isValid = await hooks.verifyVerificationCode({ email, code, env, request });
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
          const sessionToken = await createSessionToken(userId, env.AUTH_SECRET);
          const refreshToken = await createRefreshToken(userId, env.AUTH_SECRET);

          return new Response(JSON.stringify({ 
            success: true,
            userId,
            sessionToken,
            refreshToken
          }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }

        case "request-code": {
          const { email } = await request.json() as { email: string };
          
          // Generate a new verification code
          const code = generateVerificationCode();
          
          // Store the code
          await hooks.storeVerificationCode({ email, code, env, request });
          
          // Send the code via email
          const sent = await hooks.sendVerificationCode({ email, code, env, request });
          if (!sent) {
            return new Response("Failed to send verification code", { status: 500 });
          }
          
          return new Response(JSON.stringify({ 
            success: true,
            message: "Code sent to email",
            expiresIn: 600 // 10 minutes
          }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }

        case "refresh": {
          const authHeader = request.headers.get('Authorization');
          console.log('Auth header:', authHeader);
          
          if (!authHeader?.startsWith('Bearer ')) {
            console.log('No Bearer token found');
            return new Response("No refresh token provided", { status: 401 });
          }

          const refreshToken = authHeader.slice(7); // Remove 'Bearer ' prefix
          console.log('Refresh token:', refreshToken);
          
          const payload = await verifyToken(refreshToken, env.AUTH_SECRET);
          console.log('Verify token result:', payload);
          
          if (!payload) {
            console.log('Invalid token payload');
            return new Response("Invalid refresh token", { status: 401 });
          }

          const newSessionToken = await createSessionToken(payload.userId, env.AUTH_SECRET);
          const newRefreshToken = await createRefreshToken(payload.userId, env.AUTH_SECRET);
          console.log('New tokens generated:', { newSessionToken, newRefreshToken });

          return new Response(JSON.stringify({
            success: true,
            sessionToken: newSessionToken,
            refreshToken: newRefreshToken
          }), {
            headers: { 'Content-Type': 'application/json' }
          });
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
      console.error("Auth router error:", error);
      return new Response("Internal server error", { status: 500 });
    }
  };
}

export function withAuth<TEnv extends { AUTH_SECRET: string }>(
  handler: (request: Request, env: TEnv & { userId: string; sessionId: string }) => Promise<Response>,
  config: {
    hooks?: AuthHooks<TEnv>;
  }
) {
  const { hooks } = config;

  return async (request: Request, env: TEnv): Promise<Response> => {
    const sessionToken = getCookie(request, SESSION_TOKEN_COOKIE);
    const refreshToken = getCookie(request, REFRESH_TOKEN_COOKIE);

    let userId: string;
    let sessionId: string;
    let newSessionToken: string | undefined;
    let newRefreshToken: string | undefined;

    if (sessionToken) {
      const payload = await verifyToken(sessionToken, env.AUTH_SECRET);
      if (payload) {
        userId = payload.userId;
        sessionId = payload.sessionId || crypto.randomUUID();
      } else if (refreshToken) {
        const refreshPayload = await verifyToken(refreshToken, env.AUTH_SECRET);
        if (refreshPayload) {
          userId = refreshPayload.userId;
          sessionId = crypto.randomUUID();
          newSessionToken = await createSessionToken(userId, env.AUTH_SECRET);
          newRefreshToken = await createRefreshToken(userId, env.AUTH_SECRET);
        } else {
          // Both tokens invalid, create new anonymous user
          userId = crypto.randomUUID();
          sessionId = userId;
          newSessionToken = await createSessionToken(userId, env.AUTH_SECRET);
          newRefreshToken = await createRefreshToken(userId, env.AUTH_SECRET);
          
          if (hooks?.onNewUser) {
            await hooks.onNewUser({ userId, env, request });
          }
        }
      } else {
        // No refresh token, create new anonymous user
        userId = crypto.randomUUID();
        sessionId = userId;
        newSessionToken = await createSessionToken(userId, env.AUTH_SECRET);
        newRefreshToken = await createRefreshToken(userId, env.AUTH_SECRET);
        
        if (hooks?.onNewUser) {
          await hooks.onNewUser({ userId, env, request });
        }
      }
    } else {
      // No session token, create new anonymous user
      userId = crypto.randomUUID();
      sessionId = userId;
      newSessionToken = await createSessionToken(userId, env.AUTH_SECRET);
      newRefreshToken = await createRefreshToken(userId, env.AUTH_SECRET);
      
      if (hooks?.onNewUser) {
        await hooks.onNewUser({ userId, env, request });
      }
    }

    const response = await handler(request, { ...env, userId, sessionId });

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
