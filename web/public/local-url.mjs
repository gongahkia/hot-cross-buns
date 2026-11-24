export function localAppURL(value, ownURL = location.href) {
  try {
    const url = new URL(value);
    const own = new URL(ownURL);
    if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1'].includes(url.hostname) || url.username || url.password) return null;
    // loopback aliases must not embed this application's own control surface.
    if ((url.port || (url.protocol === 'https:' ? '443' : '80')) === (own.port || (own.protocol === 'https:' ? '443' : '80'))) return null;
    return url.href;
  } catch { return null; }
}
