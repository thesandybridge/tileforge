/** Reject external redirects, including lookalike hosts and protocol-relative URLs. */
export function safeRedirect(url: string, baseUrl: string): string {
  try {
    const base = new URL(baseUrl);
    const target = new URL(url, base);
    if (target.origin === base.origin) return target.href;
  } catch {
    // Malformed callback URLs fall back to the application origin.
  }
  return baseUrl;
}

/** A link cookie expresses intent only; the signed session supplies authority. */
export function verifiedLinkUserId(
  requestedId: string | undefined,
  sessionUserId: string | undefined,
): string | undefined {
  return requestedId && requestedId === sessionUserId ? sessionUserId : undefined;
}
