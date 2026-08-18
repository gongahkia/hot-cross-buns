# Self-hosted reliable web deployment

This is the only deployment that keeps a refresh token, a full Calendar and Task mirror, or Web Push subscriptions. You operate the domain, reverse proxy, PostgreSQL database, Google OAuth client, encryption key, and VAPID keys. Hot Cross Buns does not operate this service for you.

The public Cloudflare Pages build remains direct-only. It cannot do unattended Google refresh, background mirror sync, or closed-tab reminders.

## Deploy

1. Point a DNS name you control at this host, then copy `selfhost/.env.example` to `selfhost/.env` and set the values.
2. Copy `backend/.env.example` to `backend/.env`. Set `HCB_PUBLIC_ORIGIN` and `HCB_FRONTEND_ORIGINS` to exactly `https://<HCB_DOMAIN>`, set your Google Web OAuth client credentials, and set `HCB_RELIABLE_SYNC_ENABLED=true`.
3. Generate one encryption key and VAPID key pair. Do not commit either. The backend README shows commands and the complete environment contract.
4. In Google Cloud, authorize exactly `https://<HCB_DOMAIN>/api/auth/google/callback` as the redirect URI and `https://<HCB_DOMAIN>` as a JavaScript origin.
5. Start the same-origin stack:

   ```sh
   docker compose --env-file selfhost/.env -f selfhost/compose.yml up --build -d
   ```

`gateway` is the only public container. It terminates HTTPS, serves the PWA, and passes only `/api/*` to Fastify on the same origin. `scheduler` polls Google every minute and syncs each connected account at least every five minutes. When `HCB_GOOGLE_CALENDAR_WEBHOOK_URL` is configured to the same public HTTPS origin, Calendar watch notifications ask the scheduler to sync sooner; the polling fallback remains required.

## Limits

Web Push is best effort. Browser and operating-system permissions, network availability, battery policy, and the push provider can delay or drop delivery. Unsupported or denied browsers retain foreground reminders while the PWA is open. Google Calendar popup reminders are the only Calendar reminders mirrored to Web Push. Google Tasks are considered by the worker only when their notes contain the explicit HCB task-reminder marker.
