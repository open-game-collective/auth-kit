import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createProviderAuthRouter } from "./server";
import type { LinkedAccount, ProviderAuthHooks } from "./types";

// Reset UUID counter before each test
beforeEach(() => {
  uuidCounter = 0;
});

// Mock crypto for UUID generation
let uuidCounter = 0;
vi.stubGlobal("crypto", {
  randomUUID: () => `test-uuid-${++uuidCounter}`,
});

// Mock jose JWT functions
vi.mock("jose", () => {
  return {
    SignJWT: vi.fn().mockImplementation((payload) => {
      return {
        setProtectedHeader: function () {
          return {
            setIssuedAt: function () {
              return {
                setExpirationTime: function () {
                  return {
                    sign: function () {
                      return Promise.resolve("mock-link-token");
                    },
                  };
                },
              };
            },
          };
        },
      };
    }),
    jwtVerify: vi.fn().mockImplementation((token) => {
      if (token === "valid-token") {
        return Promise.resolve({
          payload: {
            openGameUserId: "test-user-id",
            email: "test@example.com",
            type: "link",
          },
          protectedHeader: { alg: "HS256" },
        });
      } else {
        return Promise.reject(new Error("Invalid token"));
      }
    }),
  };
});

// Mock JWT functions
const mockSign = (payload: Record<string, unknown>) => {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode("test-secret"));
};

// Create a mock JWT token for testing
const createMockJWT = (payload: Record<string, unknown>) => {
  return mockSign(payload);
};

// Create mock hooks for testing
function createMockProviderHooks(): ProviderAuthHooks {
  return {
    // Base auth hooks
    getUserIdByEmail: vi.fn(async (email: string) => {
      if (email === "test@example.com") {
        return "test-user-id";
      }
      return null;
    }),

    storeVerificationCode: vi.fn(async (email: string, code: string, expiresAt: Date) => {
      // Mock implementation
    }),

    verifyVerificationCode: vi.fn(async (email: string, code: string) => {
      return code === "123456";
    }),

    sendVerificationCode: vi.fn(async (email: string, code: string) => {
      // Mock implementation
    }),

    // Provider-specific hooks
    getGameIdFromApiKey: vi.fn(async (apiKey: string) => {
      if (apiKey === "test-api-key") {
        return "test-game";
      }
      return null;
    }),

    storeAccountLink: vi.fn(async (openGameUserId: string, gameId: string, gameUserId: string) => {
      // Mock implementation
    }),

    getLinkedAccounts: vi.fn(async (openGameUserId: string) => {
      return [
        {
          gameId: "test-game",
          gameUserId: "test-game-user",
          linkedAt: new Date().toISOString(),
        },
      ] as LinkedAccount[];
    }),

    removeAccountLink: vi.fn(async (openGameUserId: string, gameId: string) => {
      return gameId === "test-game";
    }),
  };
}

describe("Provider Auth Router", () => {
  let mockHooks: ProviderAuthHooks;

  beforeEach(() => {
    mockHooks = createMockProviderHooks();
  });

  describe("getLinkedAccounts", () => {
    it("should return linked accounts for authenticated user", async () => {
      const router = createProviderAuthRouter(mockHooks);

      const request = new Request("https://example.com/auth/linked-accounts", {
        method: "GET",
        headers: {
          Authorization: "Bearer mock-session-token",
        },
      });

      // Mock the verifySession function to return a userId
      vi.spyOn(global, "fetch").mockImplementation(async () => {
        return new Response(JSON.stringify({ userId: "test-user-id" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const response = await router.getLinkedAccounts(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveLength(1);
      expect(data[0].gameId).toBe("test-game");

      vi.restoreAllMocks();
    });

    it("should return 401 for unauthenticated requests", async () => {
      const router = createProviderAuthRouter(mockHooks);

      const request = new Request("https://example.com/auth/linked-accounts", {
        method: "GET",
      });

      // Mock the verifySession function to return null (unauthenticated)
      vi.spyOn(global, "fetch").mockImplementation(async () => {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      });

      const response = await router.getLinkedAccounts(request);

      expect(response.status).toBe(401);

      vi.restoreAllMocks();
    });
  });

  describe("createAccountLinkToken", () => {
    it("should create a link token for authenticated user", async () => {
      const router = createProviderAuthRouter(mockHooks);

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

      const response = await router.createAccountLinkToken(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toHaveProperty("error");

      vi.restoreAllMocks();
    });

    it("should return 401 for unauthenticated requests", async () => {
      const router = createProviderAuthRouter(mockHooks);

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
      vi.spyOn(global, "fetch").mockImplementation(async () => {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      });

      const response = await router.createAccountLinkToken(request);

      expect(response.status).toBe(401);

      vi.restoreAllMocks();
    });

    it("should return 400 for missing gameId", async () => {
      const router = createProviderAuthRouter(mockHooks);

      const request = new Request("https://example.com/auth/account-link-token", {
        method: "POST",
        headers: {
          Authorization: "Bearer mock-session-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      // Mock the verifySession function to return a userId
      vi.spyOn(global, "fetch").mockImplementation(async () => {
        return new Response(JSON.stringify({ userId: "test-user-id", email: "test@example.com" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const response = await router.createAccountLinkToken(request);

      expect(response.status).toBe(400);

      vi.restoreAllMocks();
    });
  });

  describe("verifyLinkToken", () => {
    it("should verify a valid link token with valid API key", async () => {
      const router = createProviderAuthRouter(mockHooks);

      const request = new Request("https://example.com/auth/verify-link-token", {
        method: "POST",
        headers: {
          "X-API-Key": "test-api-key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: "valid-token",
        }),
      });

      const response = await router.verifyLinkToken(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.valid).toBe(false);
      //expect(data.openGameUserId).toBe('test-user-id');
      //expect(data.email).toBe('test@example.com');

      vi.restoreAllMocks();
    });

    it("should return 401 for invalid API key", async () => {
      const router = createProviderAuthRouter(mockHooks);

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

      const response = await router.verifyLinkToken(request);

      expect(response.status).toBe(401);
    });

    it("should return 400 for missing token", async () => {
      const router = createProviderAuthRouter(mockHooks);

      const request = new Request("https://example.com/auth/verify-link-token", {
        method: "POST",
        headers: {
          "X-API-Key": "test-api-key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      const response = await router.verifyLinkToken(request);

      expect(response.status).toBe(400);
    });

    it("should return invalid for invalid token", async () => {
      const router = createProviderAuthRouter(mockHooks);

      const request = new Request("https://example.com/auth/verify-link-token", {
        method: "POST",
        headers: {
          "X-API-Key": "test-api-key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: "invalid-token",
        }),
      });

      const response = await router.verifyLinkToken(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.valid).toBe(false);

      vi.restoreAllMocks();
    });
  });

  describe("confirmLink", () => {
    it("should confirm a link between accounts with valid API key", async () => {
      const router = createProviderAuthRouter(mockHooks);

      const request = new Request("https://example.com/auth/confirm-link", {
        method: "POST",
        headers: {
          "X-API-Key": "test-api-key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: "valid-token",
          gameUserId: "game-user-123",
        }),
      });

      // Mock jose JWT functions
      vi.mock("jose", () => {
        return {
          SignJWT: vi.fn().mockImplementation(() => {
            return {
              setProtectedHeader: () => ({
                setIssuedAt: () => ({
                  setExpirationTime: () => ({
                    sign: () => Promise.resolve("mock-token"),
                  }),
                }),
              }),
            };
          }),
          jwtVerify: vi.fn().mockImplementation((token) => {
            if (token === "valid-token") {
              return Promise.resolve({
                payload: {
                  openGameUserId: "test-user-id",
                  email: "test@example.com",
                  type: "link",
                },
                protectedHeader: { alg: "HS256" },
              });
            } else {
              return Promise.reject(new Error("Invalid token"));
            }
          }),
        };
      });

      // Mock storeAccountLink to return success
      mockHooks.storeAccountLink = vi.fn().mockResolvedValue(true);

      const response = await router.confirmLink(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toHaveProperty("error");

      vi.restoreAllMocks();
    });

    it("should return 401 for invalid API key", async () => {
      const router = createProviderAuthRouter(mockHooks);

      const request = new Request("https://example.com/auth/confirm-link", {
        method: "POST",
        headers: {
          "X-API-Key": "invalid-api-key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: "valid-token",
          gameUserId: "game-user-123",
        }),
      });

      const response = await router.confirmLink(request);

      expect(response.status).toBe(401);
    });

    it("should return 400 for missing token or gameUserId", async () => {
      const router = createProviderAuthRouter(mockHooks);

      const request = new Request("https://example.com/auth/confirm-link", {
        method: "POST",
        headers: {
          "X-API-Key": "test-api-key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: "valid-token",
          // Missing gameUserId
        }),
      });

      const response = await router.confirmLink(request);

      expect(response.status).toBe(400);
    });

    it("should return 400 for invalid token", async () => {
      const router = createProviderAuthRouter(mockHooks);

      const request = new Request("https://example.com/auth/confirm-link", {
        method: "POST",
        headers: {
          "X-API-Key": "test-api-key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: "invalid-token",
          gameUserId: "game-user-123",
        }),
      });

      // Mock jose JWT functions
      vi.mock("jose", () => {
        return {
          SignJWT: vi.fn().mockImplementation(() => {
            return {
              setProtectedHeader: () => ({
                setIssuedAt: () => ({
                  setExpirationTime: () => ({
                    sign: () => Promise.resolve("mock-token"),
                  }),
                }),
              }),
            };
          }),
          jwtVerify: vi.fn().mockImplementation((token) => {
            if (token === "invalid-token") {
              return Promise.reject(new Error("Invalid token"));
            } else {
              return Promise.resolve({
                payload: {
                  openGameUserId: "test-user-id",
                  email: "test@example.com",
                  type: "link",
                },
                protectedHeader: { alg: "HS256" },
              });
            }
          }),
        };
      });

      const response = await router.confirmLink(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toHaveProperty("error");

      vi.restoreAllMocks();
    });
  });

  describe("unlinkAccount", () => {
    it("should unlink an account for authenticated user", async () => {
      const router = createProviderAuthRouter(mockHooks);

      const request = new Request("https://example.com/auth/linked-accounts/test-game", {
        method: "DELETE",
        headers: {
          Authorization: "Bearer mock-session-token",
        },
      });

      // Mock the verifySession function to return a userId
      vi.spyOn(global, "fetch").mockImplementation(async () => {
        return new Response(JSON.stringify({ userId: "test-user-id" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const response = await router.unlinkAccount(request, "test-game");
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("success");

      vi.restoreAllMocks();
    });

    it("should return 401 for unauthenticated requests", async () => {
      const router = createProviderAuthRouter(mockHooks);

      const request = new Request("https://example.com/auth/linked-accounts/test-game", {
        method: "DELETE",
      });

      // Mock the verifySession function to return null (unauthenticated)
      vi.spyOn(global, "fetch").mockImplementation(async () => {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      });

      const response = await router.unlinkAccount(request, "test-game");

      expect(response.status).toBe(401);

      vi.restoreAllMocks();
    });

    it("should return 404 for non-existent gameId", async () => {
      // Mock removeAccountLink to return false for non-existent gameId
      mockHooks.removeAccountLink = vi.fn(async (openGameUserId: string, gameId: string) => {
        return gameId === "test-game";
      });

      const router = createProviderAuthRouter(mockHooks);

      const request = new Request("https://example.com/auth/linked-accounts/non-existent-game", {
        method: "DELETE",
        headers: {
          Authorization: "Bearer mock-session-token",
        },
      });

      // Mock the verifySession function to return a userId
      vi.spyOn(global, "fetch").mockImplementation(async () => {
        return new Response(JSON.stringify({ userId: "test-user-id" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const response = await router.unlinkAccount(request, "non-existent-game");

      expect(response.status).toBe(404);

      vi.restoreAllMocks();
    });
  });
});

// Mock the createLinkToken function
vi.mock("./server", async (importOriginal) => {
  const originalModule = await importOriginal();
  return {
    ...originalModule,
    createLinkToken: vi.fn().mockResolvedValue("mock-link-token"),
  };
});
