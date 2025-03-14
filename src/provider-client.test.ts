import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProviderAuthClient } from "./provider-client";
import type { ProviderAuthState } from "./types";

describe("Provider Auth Client", () => {
  // Mock server setup
  const server = setupServer(
    // GET /linked-accounts
    http.get("http://localhost/linked-accounts", () => {
      return HttpResponse.json([
        {
          gameId: "game1",
          gameUserId: "game-user-123",
          linkedAt: "2023-01-01T00:00:00Z",
          gameName: "Game 1",
        },
      ]);
    }),

    // POST /account-link-token
    http.post("http://localhost/account-link-token", () => {
      return HttpResponse.json({
        linkToken: "test-link-token",
        expiresAt: "2023-01-01T01:00:00Z",
      });
    }),

    // DELETE /linked-accounts/:gameId
    http.delete("http://localhost/linked-accounts/game1", () => {
      return HttpResponse.json({ success: true });
    }),

    // DELETE /linked-accounts/:gameId (non-existent)
    http.delete("http://localhost/linked-accounts/non-existent-game", () => {
      return HttpResponse.json({ success: false }, { status: 404 });
    })
  );

  // Start server before tests
  beforeEach(() => server.listen());

  // Reset handlers after each test
  afterEach(() => server.resetHandlers());

  // Close server after all tests
  afterAll(() => server.close());

  it("should initialize with the provided state", () => {
    const initialState: Partial<ProviderAuthState> = {
      userId: "user123",
      sessionToken: "session-token",
      email: "user@example.com",
      linkedAccounts: [
        {
          gameId: "game1",
          gameUserId: "game-user-123",
          linkedAt: "2023-01-01T00:00:00Z",
          gameName: "Game 1",
        },
      ],
    };

    const client = createProviderAuthClient({
      host: "localhost",
      userId: "user123",
      sessionToken: "session-token",
      initialState,
    });

    expect(client.getState().userId).toBe("user123");
    expect(client.getState().sessionToken).toBe("session-token");
    expect(client.getState().email).toBe("user@example.com");
    expect(client.getState().linkedAccounts).toHaveLength(1);
    expect(client.getState().linkedAccounts[0].gameId).toBe("game1");
  });

  it("should fetch linked accounts", async () => {
    const client = createProviderAuthClient({
      host: "localhost",
      userId: "user123",
      sessionToken: "session-token",
    });

    const accounts = await client.getLinkedAccounts();

    expect(accounts).toHaveLength(1);
    expect(accounts[0].gameId).toBe("game1");
    expect(accounts[0].gameUserId).toBe("game-user-123");
    expect(client.getState().linkedAccounts).toEqual(accounts);
  });

  it("should initiate account linking", async () => {
    const client = createProviderAuthClient({
      host: "localhost",
      userId: "user123",
      sessionToken: "session-token",
    });

    const result = await client.initiateAccountLinking("game1");

    expect(result.linkToken).toBe("test-link-token");
    expect(result.expiresAt).toBe("2023-01-01T01:00:00Z");
  });

  it("should unlink an account", async () => {
    const client = createProviderAuthClient({
      host: "localhost",
      userId: "user123",
      sessionToken: "session-token",
      initialState: {
        linkedAccounts: [
          {
            gameId: "game1",
            gameUserId: "game-user-123",
            linkedAt: "2023-01-01T00:00:00Z",
            gameName: "Game 1",
          },
        ],
      },
    });

    const result = await client.unlinkAccount("game1");

    expect(result).toBe(true);
    expect(client.getState().linkedAccounts).toHaveLength(0);
  });

  it("should handle errors when unlinking non-existent account", async () => {
    const client = createProviderAuthClient({
      host: "localhost",
      userId: "user123",
      sessionToken: "session-token",
    });

    const result = await client.unlinkAccount("non-existent-game");

    expect(result).toBe(false);
  });
});
