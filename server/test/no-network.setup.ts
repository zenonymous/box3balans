// Fails any test that reaches the real network instead of its stubbed fetch.
globalThis.fetch = (async (input: unknown) => {
  throw new Error(`Real network call in a test: ${String(input instanceof Request ? input.url : input)}`);
}) as typeof fetch;
