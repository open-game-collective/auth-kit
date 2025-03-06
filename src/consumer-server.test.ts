import * as jose from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConsumerAuthHooks, createConsumerAuthRouter } from "./server";

// Reset UUID counter before each test
beforeEach(() => {
  uuidCounter = 0;
});

// Mock crypto for UUID generation
let uuidCounter = 0;
vi.stubGlobal("crypto", {
  randomUUID: () => `test-uuid-${++uuidCounter}`,
});

// Create a mock verifySession function
const _mockVerifySession = vi.fn();

// Mock jose JWT functions
vi.mock("jose", () => {
  const mockSign = (payload: Record<string, unknown>) => {
    // Return different tokens based on audience
    if (payload.aud === "SESSION") {
      return Promise.resolve("mock-session-token");
    }
    if (payload.aud === "REFRESH") {
      return Promise.resolve("mock-refresh-token");
    }
    return Promise.resolve("mock-token");
  };

  const createMockJWT = (payload: Record<string, unknown>) => {
    const chain = {
      setProtectedHeader: () => chain,
      setAudience: (aud: string) => {
        payload.aud = aud;
        return chain;
      },
      setExpirationTime: () => chain,
      setIssuedAt: () => chain,
      setIssuer: () => chain,
      setJti: () => chain,
      setNotBefore: () => chain,
      setSubject: () => chain,
      sign: () => mockSign(payload),
    };
    return chain;
  };

  return {
    SignJWT: (payload: Record<string, unknown>) => createMockJWT(payload),
    jwtVerify: async (token: string) => {
      if (token === "invalid-token") {
        throw new Error("Invalid token");
      }

      // Different payloads based on token type
      if (token === "mock-session-token") {
        return {
          payload: { userId: "test-user", aud: "SESSION" },
        };
      }
      if (token === "mock-refresh-token") {
        return {
          payload: { userId: "test-user", aud: "REFRESH" },
        };
      }
      if (token === "valid-token") {
        return {
          payload: {
            openGameUserId: "og-user-123",
            type: "link",
          },
        };
      }

      return {
        payload: { userId: "test-user" },
      };
    },
  };
});

// Create mock hooks for testing
function createMockConsumerHooks(): ConsumerAuthHooks {
  return {
    // Base auth hooks
    getUserIdByEmail: vi.fn(async (email) => {
      if (email === "user@example.com") {
        return "test-user-id";
      }
      return null;
    }),
    storeVerificationCode: vi.fn(),
    verifyVerificationCode: vi.fn(),
    sendVerificationCode: vi.fn(),

    // Consumer-specific hooks
    storeOpenGameLink: vi.fn().mockResolvedValue(true),
    getOpenGameUserId: vi.fn(async (gameUserId) => {
      if (gameUserId === "game-user-123") {
        return "og-user-123";
      }
      return null;
    }),
    getOpenGameProfile: vi.fn(async (openGameUserId) => {
      if (openGameUserId === "og-user-123") {
        return {
          displayName: "OpenGame User",
          avatarUrl: "https://example.com/avatar.png",
        };
      }
      return null;
    }),
  };
}

describe("Consumer Auth Router", () => {
  let mockHooks: ConsumerAuthHooks;

  beforeEach(() => {
    mockHooks = createMockConsumerHooks();
  });

  describe("getOpenGameLinkStatus", () => {
    it("should return link status when user is linked", async () => {
      const router = createConsumerAuthRouter(mockHooks);

      // Ensure getOpenGameUserId returns a value for test-user-id
      mockHooks.getOpenGameUserId = vi.fn().mockImplementation(async (userId) => {
        if (userId === "test-user-id") {
          return "og-user-123";
        }
        return null;
      });

      const request = new Request("https://example.com/auth/opengame-link", {
        method: "GET",
        headers: {
          Authorization: "Bearer mock-session-token",
        },
      });

      const response = await router.getOpenGameLinkStatus(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.isLinked).toBe(true);
      expect(data.openGameUserId).toBe("og-user-123");

      vi.restoreAllMocks();
    });

    it("should return not linked status when user is not linked", async () => {
      const router = createConsumerAuthRouter(mockHooks);

      // Mock getOpenGameUserId to return null
      mockHooks.getOpenGameUserId = vi.fn(async () => null);

      const request = new Request("https://example.com/auth/opengame-link", {
        method: "GET",
        headers: {
          Authorization: "Bearer mock-session-token",
        },
      });

      const response = await router.getOpenGameLinkStatus(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("isLinked", false);
      expect(data).not.toHaveProperty("openGameUserId");
    });

    it("should return 401 for unauthenticated requests", async () => {
      const router = createConsumerAuthRouter(mockHooks);

      const request = new Request("https://example.com/auth/opengame-link", {
        method: "GET",
      });

      const response = await router.getOpenGameLinkStatus(request);

      expect(response.status).toBe(401);
    });
  });

  describe("POST /verify-link-token", () => {
    it("should verify a link token", async () => {
      const router = createConsumerAuthRouter(mockHooks);

      // Mock the JWT verification
      vi.spyOn(jose, "jwtVerify").mockResolvedValue({
        payload: {
          openGameUserId: "og-user-123",
          email: "user@example.com",
          type: "link",
        },
        protectedHeader: { alg: "HS256" },
      } as unknown);

      const request = new Request("https://example.com/auth/verify-link", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer mock-session-token",
        },
        body: JSON.stringify({
          token: "valid-token",
        }),
      });

      const response = await router.verifyLinkToken(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("valid", true);
      expect(data).toHaveProperty("openGameUserId", "og-user-123");
      expect(data).toHaveProperty("email", "user@example.com");
    });

    it("should return invalid for invalid token", async () => {
      const router = createConsumerAuthRouter(mockHooks);

      // Mock the JWT verification to throw an error
      vi.spyOn(jose, "jwtVerify").mockRejectedValue(new Error("Invalid token"));

      const request = new Request("https://example.com/auth/verify-link", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer mock-session-token",
        },
        body: JSON.stringify({
          token: "invalid-token",
        }),
      });

      const response = await router.verifyLinkToken(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("valid", false);
    });

    it("should return 400 for missing token", async () => {
      const router = createConsumerAuthRouter(mockHooks);

      const request = new Request("https://example.com/auth/verify-link", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer mock-session-token",
        },
        body: JSON.stringify({}),
      });

      const response = await router.verifyLinkToken(request);

      expect(response.status).toBe(400);
    });

    it("should handle API errors", async () => {
      const router = createConsumerAuthRouter(mockHooks);

      // Mock the request.json() to throw an error
      const request = new Request("https://example.com/auth/verify-link", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer mock-session-token",
        },
      });

      // Override the json method to throw an error
      Object.defineProperty(request, "json", {
        value: () => {
          throw new Error("API error");
        },
      });

      const response = await router.verifyLinkToken(request);

      expect(response.status).toBe(500);
    });
  });

  describe("POST /confirm-link", () => {
    it("should confirm a link between accounts", async () => {
      const router = createConsumerAuthRouter(mockHooks);

      // Mock the JWT verification
      vi.spyOn(jose, "jwtVerify").mockResolvedValue({
        payload: {
          openGameUserId: "og-user-123",
          email: "user@example.com",
          type: "link",
        },
        protectedHeader: { alg: "HS256" },
      } as unknown);

      const request = new Request("https://example.com/auth/confirm-link", {
        method: "POST",
        headers: {
          Authorization: "Bearer mock-session-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: "valid-token",
          gameUserId: "game-user-123",
        }),
      });

      const response = await router.confirmLink(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("success", true);
      expect(mockHooks.storeOpenGameLink).toHaveBeenCalledWith("test-user-id", "og-user-123");
    });

    it("should return 401 for unauthenticated requests", async () => {
      const router = createConsumerAuthRouter(mockHooks);

      const request = new Request("https://example.com/auth/confirm-link", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: "valid-token",
        }),
      });

      const response = await router.confirmLink(request);

      expect(response.status).toBe(401);
    });

    it("should return 400 for missing token", async () => {
      const router = createConsumerAuthRouter(mockHooks);

      const request = new Request("https://example.com/auth/confirm-link", {
        method: "POST",
        headers: {
          Authorization: "Bearer mock-session-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      const response = await router.confirmLink(request);

      expect(response.status).toBe(400);
    });

    it("should handle API errors", async () => {
      const router = createConsumerAuthRouter(mockHooks);

      // Mock the request.json() to throw an error
      const request = new Request("https://example.com/auth/confirm-link", {
        method: "POST",
        headers: {
          Authorization: "Bearer mock-session-token",
          "Content-Type": "application/json",
        },
      });

      // Override the json method to throw an error
      Object.defineProperty(request, "json", {
        value: () => {
          throw new Error("API error");
        },
      });

      const response = await router.confirmLink(request);

      expect(response.status).toBe(500);
    });

    it("should handle OpenGame API rejecting the link", async () => {
      const router = createConsumerAuthRouter(mockHooks);

      // Mock the JWT verification
      vi.spyOn(jose, "jwtVerify").mockResolvedValue({
        payload: {
          openGameUserId: "og-user-123",
          email: "user@example.com",
          type: "link",
        },
        protectedHeader: { alg: "HS256" },
      } as unknown);

      // Mock storeOpenGameLink to return false
      mockHooks.storeOpenGameLink = vi.fn().mockImplementation(async () => {
        return false;
      });

      const request = new Request("https://example.com/auth/confirm-link", {
        method: "POST",
        headers: {
          Authorization: "Bearer mock-session-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: "valid-token",
        }),
      });

      const response = await router.confirmLink(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("success", false);
    });
  });
});
