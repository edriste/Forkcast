// Accept codes only on the configured callback, never on invite or unrelated links.
export function createOAuthCallbackHandler(
  redirectTo: string,
  exchange: (code: string) => Promise<void>,
) {
  const expected = new URL(redirectTo);
  let lastCode = '';
  let pending: Promise<void> | undefined;
  return async (input: string): Promise<boolean> => {
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      return false;
    }
    if (
      url.protocol !== expected.protocol ||
      url.host !== expected.host ||
      url.pathname !== expected.pathname
    )
      return false;
    const error = url.searchParams.get('error');
    if (error) {
      throw new Error(
        error === 'access_denied'
          ? 'Google sign-in was cancelled. Please try again.'
          : 'Google sign-in could not be completed. Please try again.',
      );
    }
    const code = url.searchParams.get('code');
    if (!code) return false;
    // The browser result and Linking event can deliver the same code concurrently.
    if (code !== lastCode) {
      lastCode = code;
      pending = exchange(code);
    }
    await pending;
    return true;
  };
}
