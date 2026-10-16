# Device notifications

The header inbox works without a push worker. Optional **Web Push** can also notify users while Forkcast is closed. Native Android/iOS binaries currently use the inbox only.

## User controls

Enable alerts under **Your team → Your account → Device notifications**. Permission is requested only after that action. On iPhone/iPad, first [install Forkcast on the Home Screen](https://github.com/edriste/Forkcast/wiki/Install-on-your-phone).

Defaults limit interruptions:

- At most three updates per local day across organizations and devices; users can lower the limit.
- Quiet hours from 22:00 to 08:00, five-minute grouping and 30-minute spacing for routine updates.
- Alerts are suppressed while the user is active. Payment reminders and organizer activity start disabled.

Device settings do not dismiss unpaid inbox reminders. Delivery is best effort.

## Set up the worker

Apply all database migrations using your normal deployment workflow. From the Forkcast checkout:

```sh
cp deploy/push.env.example deploy/push.env
npm ci --prefix deploy
node deploy/push/keys.mjs
```

Save the generated pair in `deploy/push.env`:

```dotenv
DATABASE_URL=YOUR_ADMIN_DATABASE_CONNECTION
WEB_PUSH_APP_URL=https://lunch.example.com
WEB_PUSH_SUBJECT=mailto:admin@example.com
WEB_PUSH_PUBLIC_KEY=YOUR_VAPID_PUBLIC_KEY
WEB_PUSH_PRIVATE_KEY=YOUR_VAPID_PRIVATE_KEY
```

Use a private administrator connection to the **actual app database**, with special password characters URL-encoded. The file is server-only.

Set `EXPO_PUBLIC_WEB_PUSH_KEY` to the same **public** key in your frontend settings. Rebuild a Cloudflare frontend; for Docker, recreate the web container with the updated runtime environment.

### With Docker Supabase

```sh
docker compose -f deploy/compose.push.yml up -d --build
```

The example joins `supabase_default` and connects to `db:5432`. Set `FORKCAST_SUPABASE_NETWORK` if your backend network has a different name.

### With Supabase Cloud

Run the worker on a server using Node 22.14+ and a persistent process manager:

```sh
node --env-file=deploy/push.env deploy/push/worker.mjs
```

Use a reachable TLS database connection from Supabase's Connect dialog; the Docker hostname `db` will not work here. The worker needs outbound HTTPS and database access, with no inbound port.

## Verify delivery

Enable one consenting device, schedule cooking from a second account and allow the five-minute grouping window. Check HTTPS, browser permission and matching public/private keys if nothing arrives.

For Docker logs:

```sh
docker compose -f deploy/compose.push.yml logs --tail=100 push
```

Keep the VAPID pair stable and back it up. Rotating it requires users to re-enable subscriptions. [Apple's Web Push guide](https://webkit.org/blog/13878/) explains iPhone/iPad requirements.
