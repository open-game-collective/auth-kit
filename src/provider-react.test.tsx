import { act, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { createProviderAuthContext } from "./provider-react";
import { createProviderAuthMockClient } from "./test";

describe("Provider Auth Context", () => {
  describe("useClient", () => {
    it("should provide access to the auth client", () => {
      const mockClient = createProviderAuthMockClient({
        initialState: {
          userId: "test-user",
          sessionToken: "test-token",
          email: "test@example.com",
          isLoading: false,
          error: null,
          linkedAccounts: [],
          requests: {},
        },
      });

      const AuthContext = createProviderAuthContext();

      const TestComponent = () => {
        const client = AuthContext.useClient();
        return <div data-testid="user-id">{client.getState().userId}</div>;
      };

      render(
        <AuthContext.Provider client={mockClient}>
          <TestComponent />
        </AuthContext.Provider>
      );

      expect(screen.getByTestId("user-id").textContent).toBe("test-user");
    });
  });

  describe("useSelector", () => {
    it("should select and subscribe to state changes", async () => {
      const mockClient = createProviderAuthMockClient({
        initialState: {
          userId: "test-user",
          sessionToken: "test-token",
          email: "test@example.com",
          isLoading: false,
          error: null,
          linkedAccounts: [],
          requests: {},
        },
      });

      const AuthContext = createProviderAuthContext();

      const TestComponent = () => {
        const userId = AuthContext.useSelector((state) => state.userId);
        const linkedAccounts = AuthContext.useSelector((state) => state.linkedAccounts);

        return (
          <div>
            <div data-testid="user-id">{userId}</div>
            <div data-testid="linked-count">{linkedAccounts.length}</div>
          </div>
        );
      };

      render(
        <AuthContext.Provider client={mockClient}>
          <TestComponent />
        </AuthContext.Provider>
      );

      expect(screen.getByTestId("user-id").textContent).toBe("test-user");
      expect(screen.getByTestId("linked-count").textContent).toBe("0");

      // Update state
      act(() => {
        mockClient.produce((draft) => {
          draft.linkedAccounts = [
            {
              gameId: "game1",
              gameUserId: "game-user-123",
              linkedAt: "2023-01-01T00:00:00Z",
              gameName: "Game 1",
            },
          ];
        });
      });

      expect(screen.getByTestId("linked-count").textContent).toBe("1");
    });
  });

  describe("LinkedAccounts and NoLinkedAccounts", () => {
    it("should conditionally render based on linked accounts", async () => {
      const mockClient = createProviderAuthMockClient({
        initialState: {
          userId: "test-user",
          sessionToken: "test-token",
          email: "test@example.com",
          isLoading: false,
          error: null,
          linkedAccounts: [],
          requests: {},
        },
      });

      const AuthContext = createProviderAuthContext();

      const TestComponent = () => {
        return (
          <div>
            <AuthContext.LinkedAccounts>
              <div data-testid="has-accounts">Has linked accounts</div>
            </AuthContext.LinkedAccounts>
            <AuthContext.NoLinkedAccounts>
              <div data-testid="no-accounts">No linked accounts</div>
            </AuthContext.NoLinkedAccounts>
          </div>
        );
      };

      render(
        <AuthContext.Provider client={mockClient}>
          <TestComponent />
        </AuthContext.Provider>
      );

      // Initially no linked accounts
      expect(screen.queryByTestId("has-accounts")).toBeNull();
      expect(screen.getByTestId("no-accounts")).toBeInTheDocument();

      // Add linked accounts
      act(() => {
        mockClient.produce((draft) => {
          draft.linkedAccounts = [
            {
              gameId: "game1",
              gameUserId: "game-user-123",
              linkedAt: "2023-01-01T00:00:00Z",
              gameName: "Game 1",
            },
          ];
        });
      });

      // Now should show linked accounts
      expect(screen.getByTestId("has-accounts")).toBeInTheDocument();
      expect(screen.queryByTestId("no-accounts")).toBeNull();
    });
  });

  describe("LinkedAccountsList", () => {
    it("should render linked accounts list", async () => {
      const mockClient = createProviderAuthMockClient({
        initialState: {
          userId: "test-user",
          sessionToken: "test-token",
          email: "test@example.com",
          isLoading: false,
          error: null,
          linkedAccounts: [
            {
              gameId: "game1",
              gameUserId: "game-user-123",
              linkedAt: "2023-01-01T00:00:00Z",
              gameName: "Game 1",
            },
            {
              gameId: "game2",
              gameUserId: "game-user-456",
              linkedAt: "2023-01-02T00:00:00Z",
              gameName: "Game 2",
            },
          ],
          requests: {},
        },
      });

      const AuthContext = createProviderAuthContext();

      render(
        <AuthContext.Provider client={mockClient}>
          <AuthContext.LinkedAccountsList>
            {({ accounts, isLoading, error }) => (
              <div>
                <div data-testid="loading">{isLoading ? "Loading" : "Not Loading"}</div>
                <div data-testid="error">{error || "No Error"}</div>
                <div data-testid="count">{accounts.length}</div>
                {accounts.map((account) => (
                  <div key={account.gameId} data-testid={`game-${account.gameId}`}>
                    {account.gameName}
                  </div>
                ))}
              </div>
            )}
          </AuthContext.LinkedAccountsList>
        </AuthContext.Provider>
      );

      expect(screen.getByTestId("loading").textContent).toBe("Not Loading");
      expect(screen.getByTestId("error").textContent).toBe("No Error");
      expect(screen.getByTestId("count").textContent).toBe("2");
      expect(screen.getByTestId("game-game1").textContent).toBe("Game 1");
      expect(screen.getByTestId("game-game2").textContent).toBe("Game 2");
    });
  });
});
