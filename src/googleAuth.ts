import { GOOGLE_DRIVE_SCOPE, type GoogleSession } from './googleDrive.ts';

export type GoogleConfig = { clientId: string; apiKey: string; projectNumber: string };
type TokenResponse = { access_token?: string; expires_in?: number | string; scope?: string; error?: string };
type TokenClient = { requestAccessToken: (options: { prompt: string; login_hint?: string }) => void };
type IdentityServices = { initTokenClient: (config: { client_id: string; scope: string; include_granted_scopes: boolean; callback: (response: TokenResponse) => void; error_callback: (error: { type?: string }) => void }) => TokenClient };
type PickerResult = { action?: string; docs?: Array<{ id?: string }> };
type Picker = { setVisible: (visible: boolean) => void; dispose?: () => void };
type PickerBuilder = { setDeveloperKey: (key: string) => PickerBuilder; setAppId: (id: string) => PickerBuilder; setOAuthToken: (token: string) => PickerBuilder; setOrigin: (origin: string) => PickerBuilder; addView: (view: unknown) => PickerBuilder; setCallback: (callback: (data: PickerResult) => void) => PickerBuilder; build: () => Picker };
type PickerServices = { View: new (id: string) => { setMimeTypes: (mime: string) => unknown }; ViewId: { DOCS: string }; PickerBuilder: new () => PickerBuilder; Action: { PICKED: string; CANCEL: string } };
type GoogleWindow = Window & { google?: { accounts?: { oauth2?: IdentityServices }; picker?: PickerServices }; gapi?: { load: (name: string, options: { callback: () => void; onerror: () => void; timeout: number; ontimeout: () => void }) => void } };
const browser = () => window as GoogleWindow;
let identityLoading: Promise<void> | null = null;
let pickerLoading: Promise<void> | null = null;
let authorizing = false;

export function validateGoogleConfig(config: GoogleConfig): GoogleConfig {
  const clean = { clientId: config.clientId.trim(), apiKey: config.apiKey.trim(), projectNumber: config.projectNumber.trim() };
  if (!/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clean.clientId) || clean.clientId.length > 512) throw new Error('Enter a Google Web OAuth client ID ending in .apps.googleusercontent.com.');
  if (clean.apiKey && (!/^[A-Za-z0-9_-]+$/.test(clean.apiKey) || clean.apiKey.length > 512)) throw new Error('Enter a valid Google Picker API key.');
  if (clean.projectNumber && !/^\d{1,32}$/.test(clean.projectNumber)) throw new Error('The Google Cloud project number contains digits only.');
  return clean;
}
function script(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const element = document.createElement('script'); element.src = src; element.async = true;
    const timeout = window.setTimeout(() => { element.remove(); reject(new Error('Google services took too long to load. Retry when online.')); }, 15_000);
    element.onload = () => { clearTimeout(timeout); resolve(); };
    element.onerror = () => { clearTimeout(timeout); element.remove(); reject(new Error('Google services could not load. Check your connection or content blocker.')); };
    document.head.append(element);
  });
}
export function preloadGoogle(): Promise<void> {
  if (browser().google?.accounts?.oauth2) return Promise.resolve();
  if (!identityLoading) identityLoading = script('https://accounts.google.com/gsi/client').then(() => { if (!browser().google?.accounts?.oauth2) throw new Error('Google sign-in did not initialize.'); }).catch(error => { identityLoading = null; throw error; });
  return identityLoading;
}
// requestAccessToken must run directly in the click handler, before any await.
export function authorizeGoogle(config: GoogleConfig, expected?: { accountId: string; email: string }): Promise<GoogleSession> {
  const clean = validateGoogleConfig(config);
  const services = browser().google?.accounts?.oauth2;
  if (!services) throw new Error('Google sign-in is still loading. Try Connect Google Drive again.');
  if (authorizing) throw new Error('Finish the Google sign-in already in progress.');
  authorizing = true;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error: unknown, session?: GoogleSession) => {
      if (settled) return;
      settled = true; authorizing = false; clearTimeout(timeout);
      if (session) resolve(session); else reject(error);
    };
    const timeout = window.setTimeout(() => finish(new Error('Google sign-in timed out. Try again.')), 120_000);
    try {
      const client = services.initTokenClient({ client_id: clean.clientId, scope: `openid email ${GOOGLE_DRIVE_SCOPE}`, include_granted_scopes: false,
        callback: response => { void (async () => {
          if (settled) return;
          if (response.error || !response.access_token) throw new Error(response.error === 'access_denied' ? 'Google Drive access was declined. Your local journal is unchanged.' : 'Google did not return an access token. Try connecting again.');
          const expires = Number(response.expires_in);
          if (!Number.isFinite(expires) || expires <= 30 || !response.scope?.split(/\s+/).includes(GOOGLE_DRIVE_SCOPE)) throw new Error('Google Drive file access was not granted or the session already expired.');
          const expiresAt = Date.now() + expires * 1000;
          const identity = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${response.access_token}` }, credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(20_000) });
          if (!identity.ok) throw new Error('Could not verify the Google account. Reconnect to try again.');
          const profile = await identity.json() as { sub?: string; email?: string };
          if (typeof profile.sub !== 'string' || !profile.sub || expiresAt <= Date.now() + 30_000) throw new Error('Google returned an invalid or expired account session.');
          if (expected && expected.accountId !== profile.sub) throw new Error(`Choose ${expected.email || 'the account linked to this file'} to reconnect. Unlink the file before changing accounts.`);
          finish(null, { accessToken: response.access_token, expiresAt, accountId: profile.sub, email: typeof profile.email === 'string' ? profile.email : '' });
        })().catch(error => finish(error)); },
        error_callback: error => finish(new Error(error.type === 'popup_failed_to_open' ? 'Google sign-in was blocked. Allow popups and connect again.' : 'Google sign-in was closed or could not finish. Try again.')),
      });
      client.requestAccessToken({ prompt: 'select_account', ...(expected?.email ? { login_hint: expected.email } : {}) });
    } catch (error) { finish(error); }
  });
}
export async function pickGoogleFile(config: GoogleConfig, session: GoogleSession): Promise<string | null> {
  if (!config.apiKey || !config.projectNumber) throw new Error('Add a Google Picker API key and Cloud project number to browse existing files. Files already opened by this app are also listed below.');
  if (!browser().google?.picker) {
    if (!pickerLoading) pickerLoading = (async () => {
      if (!browser().gapi) await script('https://apis.google.com/js/api.js');
      await new Promise<void>((resolve, reject) => {
        if (!browser().gapi) { reject(new Error('Google Picker did not initialize.')); return; }
        browser().gapi!.load('picker', { callback: resolve, onerror: () => reject(new Error('Google Picker could not load.')), timeout: 15000, ontimeout: () => reject(new Error('Google Picker took too long to load.')) });
      });
    })().catch(error => { pickerLoading = null; throw error; });
    await pickerLoading;
  }
  const services = browser().google?.picker;
  if (!services) throw new Error('Google Picker is unavailable. Try again.');
  return new Promise(resolve => {
    const view = new services.View(services.ViewId.DOCS); view.setMimeTypes('text/markdown,text/plain,application/octet-stream');
    const picker = new services.PickerBuilder().setDeveloperKey(config.apiKey).setAppId(config.projectNumber).setOAuthToken(session.accessToken).setOrigin(location.origin).addView(view).setCallback(data => {
      if (data.action === services.Action.CANCEL) { picker.dispose?.(); resolve(null); }
      if (data.action === services.Action.PICKED) { const id = data.docs?.[0]?.id; picker.dispose?.(); resolve(typeof id === 'string' && id ? id : null); }
    }).build();
    picker.setVisible(true);
  });
}
