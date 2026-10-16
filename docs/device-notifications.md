# Optional device notifications

Forkcast supports **Web Push** for supported desktop/mobile browsers and installed Home Screen web apps. It is separate from the existing in-app inbox. Installed React Native binaries continue to use the inbox; native APNs/FCM SDK registration is not part of this implementation. On iPhone/iPad, add Forkcast to the Home Screen before enabling notifications. HTTPS is required except for localhost development. See [Apple's Web Push guidance](https://webkit.org/blog/13878/) and [the browser subscription API](https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe).

## Defaults designed to limit interruptions

- Completely opt-in: opening Forkcast never requests permission. Use **Your team → Your account → Device notifications → Enable on this device**.
- At most **three updates per local calendar day**, shared across organizations and devices. Users can reduce the cap to one or two. A group delivered to several registered devices counts as one update; each subscribed device may display it.
- Routine updates wait five minutes so a burst can become one alert. Routine dispatches are at least 30 minutes apart. A food-arrival alert can bypass spacing but still respects quiet hours and the daily cap.
- Default quiet hours are **22:00–08:00**, in the user's browser/system time zone. They can be changed; matching start/end hours disable quiet time. The time zone/language are refreshed while the subscribed user is active in the app.
- New lunch plans, signup deadlines, food arrival and replies to cooking questions are enabled by default. Organizer activity and payment reminders are **off** by default.
- Optional payment reminders start only after a payment has been outstanding for a day, and occur at most once every 72 hours per person, combining outstanding payments rather than sending one alert per meal.
- If the user is active in Forkcast, eligible device alerts are suppressed in favor of the in-app interface. Read/dismissed inbox items, comments already viewed and inaccessible organizations are excluded. Membership and subscription status are checked again before sending.
- Unpaid inbox alerts remain nondismissible, independently of device settings. Device pushes never mark an inbox item as read or alter participation/payment status.
- Food-arrival alerts expire after 15 minutes, deadline alerts at their useful cutoff, and discussion replies/new-plan alerts after a day. They do not accumulate into a stale morning flood. Routine alerts which reach their expiry while capped/quiet are discarded.
- Devices use a common replacement tag with `renotify: false` to avoid piling up identical notification cards. Payloads contain generic localized text and an internal link, without meal descriptions, payment amounts or colleague names.

Opening a notification selects its organization and opens the cooking event/order after authentication; grouped updates across targets open the overview. Links validate IDs and membership and stay on the configured app origin.

## Self-hosted setup

Apply migration `202610160042_web_push.sql` using your installation's existing migration workflow. It adds private queueing, protected preferences/subscription RPCs, and in-app cooking-reply notifications. It does not enable pushes for anyone.

From the Forkcast checkout:

```sh
cp deploy/push.env.example deploy/push.env
docker compose -f deploy/compose.push.yml build
docker run --rm --entrypoint node forkcast-push:local keys.mjs
```

Save the generated key pair securely. Put the public/private keys in `deploy/push.env`, together with:

- `DATABASE_URL`: a **server-only administrator connection** to the self-hosted Supabase database. The example uses `db:5432` on `supabase_default`. Keep this file private and outside the web service.
- `WEB_PUSH_APP_URL`: the exact public HTTPS frontend origin, e.g. `https://lunch.example.com`.
- `WEB_PUSH_SUBJECT`: an operator contact, e.g. `mailto:admin@example.com`.
- `WEB_PUSH_PUBLIC_KEY` and `WEB_PUSH_PRIVATE_KEY`: the generated VAPID pair.

Set **only the public key** in `deploy/web.env`:

```dotenv
EXPO_PUBLIC_WEB_PUSH_KEY=YOUR_VAPID_PUBLIC_KEY
```

Rebuild the web image for the new service worker/manifest and recreate it with its updated runtime settings. Then start the worker:

```sh
docker compose -f deploy/compose.web.yml up -d --build
docker compose -f deploy/compose.push.yml up -d
```

The worker joins the official Supabase Docker network. If its name differs, set `FORKCAST_SUPABASE_NETWORK` for Compose. It has no inbound port. It scans the database every 30 seconds and sends encrypted Web Push directly to browser push services using VAPID; no Supabase Cloud cron, Expo Push Service or separate notification SaaS account is needed. Browser delivery still travels through the browser vendor's push infrastructure, with outbound HTTPS required. The supported endpoint allowlist covers Chrome/FCM, Firefox/Mozilla and Safari/Apple push services; arbitrary endpoints/private addresses cannot be registered as outbound HTTP targets.

For development with Node 22.14+, install the deployment tool dependencies and generate keys with:

```sh
npm ci --prefix deploy
node deploy/push/keys.mjs
```

Configure the public key in `.env`, restart Expo, and run `node --env-file=deploy/push.env deploy/push/worker.mjs` with a loopback development database URL. The production compose example's `db` hostname is not resolvable from a host process. `npm run build:web` adds the PWA manifest, notification icon and public configuration bootstrap to a normal static export; use that export for Home Screen installation testing.

## Operations and verification

The SQL queue is transactionally populated from cooking/order notifications and discussion replies. The worker generates upcoming cooking cutoff and optional payment reminder candidates. It serializes reservations on the user's preference row, so multiple worker instances share the same cap and cannot claim the same batch. Counters are reserved before the network call. To favor fewer notifications over duplicates, an ambiguous failed send is not retried and still consumes its slot; the in-app record remains available. Browser push is best effort and is never a reliable alarm clock.

Expired subscriptions (404/410) are removed. Turning off the current device unsubscribes it from the browser and removes its server registration. Signing out attempts the same cleanup and unsubscribes the browser on a signed-out auth event. Users can remove all registered devices, and pause all their device alerts in settings. Paused/unenrolled users do not receive an old queue on re-enabling. Each account can register up to three devices. Native apps do not request browser permission.

Inspect the sender with:

```sh
docker compose -f deploy/compose.push.yml logs --tail=100 push
```

The image health check reports unhealthy if no successful database scan has completed for two minutes. Delivery failures are logged with a status code, without endpoint credentials or notification contents.

Check the public key matches the worker's pair, the frontend uses HTTPS, the notification permission is allowed, and the migration has run. On iOS, test from the Home Screen app. The web host must serve `/service-worker.js` as JavaScript, without SPA fallback or permanent caching, and `/manifest.webmanifest` plus `/push-icon.png` must be accessible. The supplied Nginx configuration handles this.

Test deliberately with consenting accounts/devices: enable one device, choose a daily cap of one, schedule cooking from another account, and allow the five-minute grouping window. Read an update in-app before dispatch and confirm no push. Test quiet hours, a second event after the cap, a notification click, signing out and permission denial. Re-enable normal settings after testing. These checks are not performed against real devices automatically.

Keep the VAPID pair stable and include it in encrypted deployment backups. After key rotation, update the web public key and have users disable/re-enable their device subscriptions. Stopping the worker or clearing the web public key does not erase the in-app inbox. Database delivery state, preferences and endpoint credentials are part of database backups; never expose them via public logs or web configuration.
