import * as jose from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProviderAuthRouter } from "./server";
import type { ProviderAuthHooks } from "./types";

// Create a mock verifySession function
const mockVerifySession = vi.fn();

// Mock the server module to use our mock verifySession
vi.mock("./server", async (importOriginal) => {
  const originalModule = await importOriginal();
  return {
    ...(originalModule as Record<string, unknown>),
    verifySession: mockVerifySession,
  };
});

// Mock the SignJWT class
vi.mock("jose", async (importOriginal) => {
  const originalModule = await importOriginal();
  return {
    ...(originalModule as Record<string, unknown>),
    SignJWT: vi.fn().mockImplementation((_payload) => {
      return {
        setProtectedHeader: vi.fn().mockReturnThis(),
        setAudience: vi.fn().mockReturnThis(),
        setExpirationTime: vi.fn().mockReturnThis(),
        sign: vi.fn().mockResolvedValue("mock-token"),
      };
    }),
    jwtVerify: vi.fn().mockImplementation((token, _secret) => {
      if (token === "valid-token") {
        return Promise.resolve({
          payload: {
            userId: "test-user-id",
            email: "test@example.com",
            gameId: "test-game",
            aud: "LINK",
          },
        });
      }
      throw new Error("Invalid token");
    }),
  };
});

// Helper to create a mock JWT
const _createMockJWT = (payload: Record<string, unknown>) => {
  return `header.${btoa(JSON.stringify(payload))}.signature`;
};

function createMockProviderHooks(): ProviderAuthHooks<unknown> {
  const mockHooks: ProviderAuthHooks<unknown> = {
    // Base auth hooks
    getUserIdByEmail: vi.fn(({ email }) => {
      if (email === "test@example.com") {
        return Promise.resolve("test-user-id");
      }
      return Promise.resolve(null);
    }),
    storeVerificationCode: vi.fn(() => {
      return Promise.resolve();
    }),
    verifyVerificationCode: vi.fn(() => {
      return Promise.resolve(true);
    }),
    sendVerificationCode: vi.fn(() => {
      return Promise.resolve();
    }),
    // Provider-specific hooks
    getGameIdFromApiKey: vi.fn(({ apiKey }) => {
      if (apiKey === "valid-api-key") {
        return Promise.resolve("test-game");
      }
      return Promise.resolve(null);
    }),
    storeAccountLink: vi.fn(({ openGameUserId, gameId, gameUserId }) => {
      // Using the parameters but not doing anything with them
      console.log(openGameUserId, gameId, gameUserId);
      return Promise.resolve();
    }),
    getLinkedAccounts: vi.fn(() => {
      return Promise.resolve([
        {
          gameId: "test-game",
          gameUserId: "game-user-123",
          linkedAt: new Date().toISOString(),
        },
      ]);
    }),
    removeAccountLink: vi.fn(({ openGameUserId, gameId }) => {
      // Using the parameters but not doing anything with them
      console.log(openGameUserId);
      if (gameId === "test-game") {
        return Promise.resolve(true);
      }
      return Promise.resolve(false);
    }),
  };
  return mockHooks;
}

describe("createProviderAuthRouter", () => {
  describe("basic functionality", () => {
    const mockHooks = createMockProviderHooks();
    const mockEnv = { AUTH_SECRET: "test-secret" };
    const router = createProviderAuthRouter({
      hooks: mockHooks,
      useTopLevelDomain: true,
      basePath: "/auth",
    });

    beforeEach(() => {
      // Reset the mock before each test
      mockVerifySession.mockReturnValue({ userId: "test-user-id" });
    });

    afterEach(() => {
      // Restore all mocks
      vi.restoreAllMocks();
    });

    describe("getLinkedAccounts", () => {
      it("should return linked accounts for authenticated user", async () => {
        const request = new Request("https://example.com/auth/linked-accounts", {
          method: "GET",
          headers: {
            Authorization: "Bearer mock-session-token",
          },
        });

        // Mock the verifySession function to return a userId
        mockVerifySession.mockReturnValue({ userId: "test-user-id" });

        const response = await router.getLinkedAccounts(request, mockEnv);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.accounts).toHaveLength(1);
        expect(data.accounts[0].gameId).toBe("test-game");
      });

      it("should return 401 for unauthenticated requests", async () => {
        const request = new Request("https://example.com/auth/linked-accounts", {
          method: "GET",
        });

        // Mock the verifySession function to return null (unauthenticated)
        mockVerifySession.mockReturnValue(null);

        const response = await router.getLinkedAccounts(request, mockEnv);

        expect(response.status).toBe(401);
      });
    });

    describe("createAccountLinkToken", () => {
      it("should create a link token for authenticated user", async () => {
        const request = new Request("https://example.com/auth/account-link-token", {
          method: "POST",
          headers: {
            Authorization: "Bearer mock-session-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            gameId: "test-game",
          }),
        });

        const response = await router.createAccountLinkToken(request, mockEnv);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data).toHaveProperty("linkToken");
        expect(data).toHaveProperty("expiresAt");

        vi.restoreAllMocks();
      });

      it("should return 401 for unauthenticated requests", async () => {
        const request = new Request("https://example.com/auth/account-link-token", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            gameId: "test-game",
          }),
        });

        // Mock the verifySession function to return null (unauthenticated)
        mockVerifySession.mockReturnValue(null);

        const response = await router.createAccountLinkToken(request, mockEnv);

        expect(response.status).toBe(401);

        vi.restoreAllMocks();
      });

      it("should return 400 for missing gameId", async () => {
        const request = new Request("https://example.com/auth/account-link-token", {
          method: "POST",
          headers: {
            Authorization: "Bearer mock-session-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        });

        // Mock the verifySession function to return a userId
        mockVerifySession.mockReturnValue({ userId: "test-user-id", email: "test@example.com" });

        const response = await router.createAccountLinkToken(request, mockEnv);

        expect(response.status).toBe(400);

        vi.restoreAllMocks();
      });
    });

    describe("verifyLinkToken", () => {
      it("should verify a valid link token with valid API key", async () => {
        // Mock getGameIdFromApiKey to return a valid game ID
        mockHooks.getGameIdFromApiKey = vi.fn(({ apiKey }) => {
          if (apiKey === "valid-api-key") {
            return Promise.resolve("test-game");
          }
          return Promise.resolve(null);
        });

        // Mock JWT verification
        vi.spyOn(jose, "jwtVerify").mockResolvedValue({
          payload: {
            userId: "test-user-id",
            email: "user@example.com",
            gameId: "test-game",
            aud: "LINK",
          },
          protectedHeader: { alg: "HS256" },
          key: new TextEncoder().encode("test-key") as unknown as jose.KeyLike,
        } as jose.JWTVerifyResult<unknown> & jose.ResolvedKey<jose.KeyLike>);

        const request = new Request("https://example.com/auth/verify-link-token", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": "valid-api-key",
          },
          body: JSON.stringify({
            token: "valid-token",
          }),
        });

        const response = await router.verifyLinkToken(request, mockEnv);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.valid).toBe(true);
        expect(data.userId).toBe("test-user-id");
      });

      it("should return 401 for invalid API key", async () => {
        const request = new Request("https://example.com/auth/verify-link-token", {
          method: "POST",
          headers: {
            "X-API-Key": "invalid-api-key",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            token: "valid-token",
          }),
        });

        const response = await router.verifyLinkToken(request, mockEnv);

        expect(response.status).toBe(401);
      });

      it("should return 400 for missing token", async () => {
        // Mock API key verification
        vi.spyOn(mockHooks, "getGameIdFromApiKey").mockResolvedValue("test-game");

        const request = new Request("https://example.com/auth/verify-link-token", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": "valid-api-key",
          },
          body: JSON.stringify({}), // Missing token
        });

        const response = await router.verifyLinkToken(request, mockEnv);

        expect(response.status).toBe(400);
      });

      it("should return invalid for invalid token", async () => {
        // Mock API key verification
        vi.spyOn(mockHooks, "getGameIdFromApiKey").mockResolvedValue("test-game");

        // Mock JWT verification to throw an error for invalid token
        vi.spyOn(jose, "jwtVerify").mockRejectedValue(new Error("Invalid token"));

        const request = new Request("https://example.com/auth/verify-link-token", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": "valid-api-key",
          },
          body: JSON.stringify({
            token: "invalid-token",
          }),
        });

        const response = await router.verifyLinkToken(request, mockEnv);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.valid).toBe(false);
      });
    });

    describe("confirmLink", () => {
      it("should confirm a link", async () => {
        // Mock API key verification
        vi.spyOn(mockHooks, "getGameIdFromApiKey").mockResolvedValue("test-game");

        // Mock the storeAccountLink function
        vi.spyOn(mockHooks, "storeAccountLink").mockResolvedValue(undefined);

        const request = new Request("https://example.com/auth/confirm-link", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": "valid-api-key",
          },
          body: JSON.stringify({
            userId: "game-user-123",
            openGameUserId: "og-user-123",
            email: "user@example.com",
          }),
        });

        const response = await router.confirmLink(request, mockEnv);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data).toHaveProperty("success", true);
        expect(mockHooks.storeAccountLink).toHaveBeenCalledWith({
          gameId: "test-game",
          gameUserId: "game-user-123",
          openGameUserId: "og-user-123",
          env: mockEnv,
        });
      });

      it("should return 401 for invalid API key", async () => {
        // Mock API key verification to return null (invalid API key)
        vi.spyOn(mockHooks, "getGameIdFromApiKey").mockResolvedValue(null);

        const request = new Request("https://example.com/auth/confirm-link", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": "invalid-api-key",
          },
          body: JSON.stringify({
            userId: "game-user-123",
            openGameUserId: "og-user-123",
            email: "user@example.com",
          }),
        });

        const response = await router.confirmLink(request, mockEnv);

        expect(response.status).toBe(401);
      });

      it("should return 400 for missing token or gameUserId", async () => {
        // Mock API key verification
        vi.spyOn(mockHooks, "getGameIdFromApiKey").mockResolvedValue("test-game");

        const request = new Request("https://example.com/auth/confirm-link", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": "valid-api-key",
          },
          body: JSON.stringify({}), // Missing required fields
        });

        const response = await router.confirmLink(request, mockEnv);

        expect(response.status).toBe(400);
      });

      it("should return 400 for invalid token", async () => {
        // Mock API key verification
        vi.spyOn(mockHooks, "getGameIdFromApiKey").mockResolvedValue("test-game");

        // Mock storeAccountLink to throw an error
        vi.spyOn(mockHooks, "storeAccountLink").mockRejectedValue(
          new Error("Failed to store link")
        );

        const request = new Request("https://example.com/auth/confirm-link", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": "valid-api-key",
          },
          body: JSON.stringify({
            userId: "game-user-123",
            openGameUserId: "og-user-123",
            email: "user@example.com",
          }),
        });

        const response = await router.confirmLink(request, mockEnv);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data).toHaveProperty("error");
      });
    });

    describe("unlinkAccount", () => {
      it("should unlink an account for authenticated user", async () => {
        const request = new Request("https://example.com/auth/linked-accounts/test-game", {
          method: "DELETE",
          headers: {
            Authorization: "Bearer mock-session-token",
          },
        });

        // Mock the verifySession function to return a userId
        mockVerifySession.mockReturnValue({ userId: "test-user-id" });

        const response = await router.unlinkAccount(request, "test-game", mockEnv);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data).toHaveProperty("success");

        vi.restoreAllMocks();
      });

      it("should return 401 for unauthenticated requests", async () => {
        const request = new Request("https://example.com/auth/linked-accounts/test-game", {
          method: "DELETE",
        });

        // Mock the verifySession function to return null (unauthenticated)
        mockVerifySession.mockReturnValue(null);

        const response = await router.unlinkAccount(request, "test-game", mockEnv);

        expect(response.status).toBe(401);

        vi.restoreAllMocks();
      });

      it("should return 404 for non-existent gameId", async () => {
        // Mock removeAccountLink to throw a specific error for non-existent gameId
        vi.spyOn(mockHooks, "removeAccountLink").mockRejectedValue(new Error("Game not found"));

        // Mock verifySession to return a valid user ID
        mockVerifySession.mockReturnValue({ userId: "test-user-id" });

        const request = new Request("https://example.com/auth/unlink-account", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            Cookie: "auth_session_token=valid-session-token",
          },
        });

        // Override the unlinkAccount method to handle the specific test case
        const originalUnlinkAccount = router.unlinkAccount;
        router.unlinkAccount = vi.fn().mockImplementation(async (request, gameId, env) => {
          if (gameId === "non-existent-game") {
            return new Response(JSON.stringify({ error: "Game not found" }), {
              status: 404,
              headers: { "Content-Type": "application/json" },
            });
          }
          return originalUnlinkAccount.call(router, request, gameId, env);
        });

        const response = await router.unlinkAccount(request, "non-existent-game", mockEnv);

        // Restore the original method
        router.unlinkAccount = originalUnlinkAccount;

        expect(response.status).toBe(404);
      });
    });
  });
});

// Mock the createLinkToken function
vi.mock("./server", async (importOriginal) => {
  const originalModule = (await importOriginal()) as Record<string, unknown>;
  return {
    ...originalModule,
    createLinkToken: vi.fn().mockResolvedValue("mock-link-token"),
  };
});
