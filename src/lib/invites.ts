export function inviteCode(input: string): string {
  const trimmed = input.trim();
  let code = trimmed;
  if (trimmed.includes('://')) {
    try {
      const url = new URL(trimmed);
      if (url.protocol !== 'forkcast:' || url.hostname !== 'join') return '';
      code = url.searchParams.get('code') ?? '';
    } catch {
      return '';
    }
  }
  return /^[a-f0-9]{32}$/i.test(code) ? code.toLowerCase() : '';
}
