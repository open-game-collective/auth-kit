import { afterAll, afterEach, beforeAll } from 'vitest';
import { setupServer } from 'msw/node';
import '@testing-library/jest-dom';

// Create a pristine server instance for each test file
export const server = setupServer();

// Establish API mocking before all tests
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

// Reset any request handlers that we may add during the tests,
// so they don't affect other tests
afterEach(() => {
  server.resetHandlers();
});

// Clean up after the tests are finished
afterAll(() => {
  server.close();
}); 