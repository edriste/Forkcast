# Forkcast

An Expo/React Native app for private colleague lunch recommendations and shared office cooking. The app uses **OpenStreetMap restaurant data, MapLibre maps and OpenFreeMap tiles**. Maps require no Google API key or map-provider billing account. Google login uses separate OAuth credentials.

The MVP includes Google signup/login with email/password as a fallback, multiple organizations, invite codes/links, restaurant search and historical reviews, organization-specific ratings and map filters, cooking events, safe portion reservations, private images and PayPal.me payments. The app contains no mock data or demo login.

## Requirements and first run

- Node 22.14 or newer, npm.
- Supabase: either a hosted project or local Supabase CLI with Docker.
- For native builds: Android Studio/emulator or Xcode/macOS for iOS.

```sh
npm ci
cp .env.example .env
```

Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `.env`. The legacy anon key also works. Never put a service-role key in the mobile app. `npm ci` also copies the version-matched MapLibre browser worker and its license to `public/`; these generated files are ignored by Git.

## Daily lunch overview

The everyday screens use a compact layout: icon actions sit beside headings, restaurant/cooking entries are tappable rows, and secondary explanations and member participant lists expand on demand; organizers see the full payment roster directly. Icon controls have descriptive accessible labels and at least 44-pixel touch targets. Text sizes are retained. The shared theme uses bright tangerine orange, charcoal text, neutral backgrounds, soft card surfaces, pill-shaped organization/navigation controls, and focused input outlines. Primary orange buttons use dark text for contrast; smaller orange labels use a deeper accessible tone.

**Overview** is the default tab, headed “What's for lunch today?” / “Was gibts zum Mittagessen?”. Choose going out, eating in the office (packed lunches or shared cooking), ordering food to the office, or the combined no-lunch/away option; the two-column choice tiles show the team count for each answer, with unanswered members underneath. Answers belong to the current organization and Berlin calendar day, and can be changed or cleared. Choosing anything other than going out removes your restaurant vote.

Today's office cooking links to the existing portion signup and payment flow. Each day starts with an empty restaurant shortlist. **Suggest a restaurant for today** opens a searchable saved-place picker with a **Discover new places** action. The overview shows at most three nominations; **View all** opens the searchable full voting list. The picked restaurant stays first. Each going-out member has one changeable/removable vote, with visible totals. A unique voting leader is shown as a provisional restaurant plan; ties remain unresolved until votes change or the wheel is used.

**Spin the wheel / Glücksrad drehen** opens the animated wheel in a modal and saves one result for everyone in the organization. Today’s explicit nominations take priority; otherwise reviewed places matching the current Places filters have an equal chance. The saved wheel result takes precedence over the provisional voting leader, and another spin replaces it. Voting and spinning require the going-out answer. Counts, votes and cooking plans update automatically through the shared live connection and when returning to the foreground. Each new day starts fresh answers/votes/picks while keeping historical rows separate.

The wheel shows **Picking from N restaurants** and an expandable candidate list, searchable for larger pools. When using reviewed places, it shows the active cuisine and rating filters with **Adjust filters** linking to Places. Empty pools explain whether reviews are missing or filters exclude all restaurants, with actions to reset filters or suggest a place. Searching the candidate preview does not alter the wheel's pool.

Apply `202610120015_daily_lunch.sql` and `202610120016_lunch_not_in_office.sql` to the target Supabase database (`npx supabase migration up --local` for local development), then reload the app. The migration has already been applied to this workspace's running local Supabase. Hosted deployments must apply it too. It adds protected daily tables and RPCs without resetting existing data; OSM services need no changes. The four bottom tabs are Overview, Places, Cooking and Your team.

## Organization header

**Cooking discussions**: open any cooking event and use **Questions & comments** to ask about ingredients, portions or payment. All current organization members can read and reply, even without a reservation or after signup closes. Authors can edit or delete their own comments; deletion asks for confirmation. The latest 20 comments appear in chronological order, with **Show earlier comments** for longer threads. Replies refresh automatically and preserve unfinished drafts. English and German follow system settings. Apply `202610140040_cooking_comments.sql` to hosted Supabase projects; it has already been applied locally.

**Notifications**: a header bell shows the unread count for your current organization. Open it for new cooking invitations, outstanding lunch payments and organizers’ payment updates. Invitations link to the lunch or reserve one portion with **Join · 1 portion**; opening the lunch lets you adjust portions or leave. Dismissing an invitation hides the notification without changing a reservation. Payment reminders cannot be dismissed or marked as read, including by **Mark all as read**. They keep the alert marker until payment is marked or you leave; they link to the existing PayPal/payment screen. Organizers see payment amounts, self-reported paid status and their confirmations. They receive signup alerts when colleagues join; participants receive a notification when the organizer confirms payment. Read/dismissed states persist on the server for other notifications. The inbox updates from private live signals, on foregrounding, when opened, and after participation/payment changes. These are in-app notifications; background device push is not configured. Apply migrations `202610120017_notifications.sql`, `202610120018_persistent_payment_reminders.sql` and `202610130030_unread_payment_reminders.sql` to hosted Supabase projects. Previously dismissed/read unpaid reminders are restored by the latter migrations.

The organization name appears once in the top header on Overview, Places and Cooking. Tap its dropdown arrow to switch between your memberships; the picker marks the active organization and offers **Manage organizations** for joining or creating groups. Switching preserves the selected tab, reloads data for the new group and remembers that group across app restarts. Closing the picker or choosing the current organization preserves the current filters. The picker opens centered on the screen, with a scrollable list sized for the viewport and safe areas. It supports German, dark mode and narrow screens.

## Map and place filters

**Places** combines the map and ranked restaurant list in one tab. A compact **Map / List** switch shares cuisine and rating filters between both views. The map shows the office and reviewed restaurant pins, with direct pin-to-review navigation; the office remains visible independently of the filters. The list compares ratings and opens reviews, including entries without coordinates and when tiles cannot load. Changing views preserves filters without reloading the restaurant data.

Cuisine, rating and votes use three compact controls. Tap one to open its selection modal: a bottom sheet on small screens or a centered dialog on larger screens. Selecting an option applies it immediately; close, tap outside or use Escape/Android Back to dismiss without changing it. Active filters show their current values and a **Reset filters** action. Larger cuisine lists include a local search field. The organization pin remains visible regardless of restaurant filters.

## System language

Forkcast selects German or English from the device/browser's ordered preferred languages, using the first supported language. German regional variants (Germany, Austria and Switzerland) use German translations; if no supported language is listed, the app falls back to English. Dates, euros and ratings use the selected locale. Cuisine labels and the cuisine picker search support German while saved OSM tags stay canonical. Restaurant names, addresses, reviews and other user content retain their original text.

Language changes update the UI without losing the session or typed input. Android also rereads preferences when the app returns to the foreground. iOS/Android register English and German so an OS per-app language preference can override the device default. The iOS photo-library permission prompt is localized too. There is no in-app language toggle.

Restart Expo and reload the web app after installing this update. Installed native apps require a new prebuild/build for `expo-localization` and the supported-language configuration; use the native build commands below. This change needs no Supabase migrations or Google configuration. To test German on web, put German first in your browser's preferred languages and reload; on native, change the device or per-app language to German.

## System appearance

Forkcast follows the device/browser's light or dark setting and updates immediately when it changes. Both themes keep the orange branding; dark mode uses warm dark surfaces and brighter orange accents. Forms, navigation, status bars, map markers and the basemap adapt without clearing the current session or typed input.

Web needs a reload after upgrading. Native installations need a new prebuild/build because `userInterfaceStyle` is now `automatic` and `expo-system-ui` enables Android appearance changes. Run the existing native prebuild/run commands below, then toggle the system appearance in the emulator or device settings.

The default basemaps are OpenFreeMap Positron for light mode and Dark for dark mode. `EXPO_PUBLIC_OSM_MAP_STYLE_URL` overrides the light style; `EXPO_PUBLIC_OSM_DARK_MAP_STYLE_URL` overrides the dark style. Restart Expo after changing either environment variable.

## Walking distances (openrouteservice)

Places use walking routes from the organization's saved office when the server has an openrouteservice key. Labels lead with an estimated walking time rounded up to whole minutes, followed by distance (for example, **≈ 8 min · 600 m**). Durations come from the same cached matrix response, so this adds no API calls. Straight-line estimates never acquire a walking-time estimate. The same routed distances drive labels, nearest sorting, distance filters and the wheel's reviewed fallback. Search results, favorites and place details share the integration. A confirmed unavailable route is shown as **No walking route found** and is excluded by distance limits. If routing is not configured, temporarily unavailable or rate-limited, distances fall back to clearly labelled straight-line estimates.

1. Obtain a key from the [HeiGIT account dashboard](https://account.heigit.org/). Enable access to openrouteservice's matrix service for your key.
2. Apply `202610160041_walking_distances.sql` to the target database (`npx supabase migration up --local` for local development).
3. Locally, set `OPENROUTESERVICE_API_KEY=your-key` in the ignored `supabase/.env.local` file and restart `npx supabase functions serve places --env-file supabase/.env.local`. Keep the other existing values in that file.
4. For hosted Supabase, set the **Edge Function secret** `OPENROUTESERVICE_API_KEY` in the dashboard and deploy the updated `places` function. Keep this key on the server; never put it in `.env` as an `EXPO_PUBLIC_` value.
5. Set the organization's office location and reload the app.

The function uses the current `https://api.heigit.org/openrouteservice/v2/matrix/foot-walking` endpoint, following the [provider's API address migration](https://ask.openrouteservice.org/t/deprecating-api-openrouteservice-org-in-favour-of-api-heigit-org/7912). It sends only office/restaurant coordinates, with up to 100 destinations in one request. Successful distances are shared across colleagues and cached for 30 days; confirmed unreachable routes are cached for one day. Moving either endpoint invalidates its cached route. Credentials and cached routing tables are not readable by app clients.

Forkcast limits this connection to 400 upstream requests per rolling 24-hour window and spaces reservations by at least 2.1 seconds across all server instances; cached results use no upstream calls. These are application safeguards, not a guarantee of available provider quota—your account may also be used by other applications. Authentication/quota responses pause new requests for one hour. Additional spots that cannot be routed during a busy request use labelled estimates until an automatic refresh can fill their cache. First uncached loads may take longer while the walking matrix is calculated. These distances follow the provider's mapped walking network; paths, entrances and access data can affect results. Provider attribution is centralized under **Credits & licenses**.

## Local backend

```sh
npx supabase start
npx supabase migration up --local
npx supabase status
```

Copy the local API URL and publishable key from `status` into `.env`. The browser uses `http://127.0.0.1:54321`; Android emulators use `http://10.0.2.2:54321`; physical devices need the development computer's LAN IP.

Start the places function in another terminal:

```sh
npx supabase functions serve places
```

Restaurant search itself needs no API secret. Walking distances use the optional server key described above. You can also customize public-service identification and endpoints:

```sh
cp supabase/.env.example supabase/.env.local
npx supabase functions serve places --env-file supabase/.env.local
```

Local signup emails are captured in the test inbox at `http://127.0.0.1:54324`; read the verification code and enter it in Forkcast. The included email template displays the code. Local Studio is at `http://127.0.0.1:54323`.

Run the browser app:

```sh
npm run web
```

For native maps, create an installed build; MapLibre is not part of Expo Go:

```sh
npx expo prebuild --platform android
npx expo run:android
# On macOS:
npx expo prebuild --platform ios
npx expo run:ios
```

An existing Google-based native build must be rebuilt after this change. Restart Expo after changing `.env`. Web, iOS and Android now all have an interactive reviewed-place map. If tiles/WebGL are unavailable, the reviewed-place list remains usable.

## Hosted Supabase

With the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started):

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase functions deploy places
```

Set your hosted project URL/public key in `.env`. The function uses the built-in server-side Supabase service-role key to register external OSM facts and maintain refresh leases. Every request first validates the user and organization membership; private reviews are read through the authenticated RLS client.

Enable email/password signups, confirmations and a minimum password length of 8. Configure the hosted Confirm signup email template to display `{{ .Token }}` (the local template is in `supabase/templates/confirmation.html`). Configure SMTP for reliable delivery.

Optional server secrets: `OSM_USER_AGENT` (an application identifier with an operator contact URL/email), `OSM_NOMINATIM_URL`, `OSM_OVERPASS_URL`. The defaults work without API keys. Supply a contact identifier for a public deployment and respect provider policies. `EXPO_PUBLIC_OSM_MAP_STYLE_URL` can replace the default OpenFreeMap Positron style with another compatible style/provider.

Create your own terms/privacy pages and set `EXPO_PUBLIC_TERMS_URL` and `EXPO_PUBLIC_PRIVACY_URL` to their HTTPS URLs.

## How OSM search works

1. When creating a group, search an office address or area, select a result and optionally tap the preview map to fine-tune the pin. The saved organization pin appears immediately, even without restaurant reviews. Administrators can set/change it under Your team → Set/Change organization location. Existing groups with a known cached center reuse it; others need a location selected.
2. On the first explicit restaurant search, the backend uses the selected office coordinates (or geocodes the text area once for an older group) and queries Overpass for named restaurants, cafes, fast food, food courts and bakeries within **3 km** of its center.
3. The regional catalogue and normalized external place facts are saved in Postgres. IDs include both OSM element type and number, for example `osm:node:123` and `osm:way:123`, so different elements cannot collide.
4. Subsequent searches match name/cuisine/address against the cached catalogue. There is no upstream request per keystroke. Map/list and detail reads reuse fresh facts, refreshing saved OSM objects by ID after 24 hours; manual source refresh is also available.
5. On a search after **30 days**, the backend refreshes that region. It reuses its saved center, acquires a two-minute per-group lease and throttles public-service requests globally within the project. If a refresh fails or Overpass reports a partial result, saved data is retained and a warning is shown. Failures have a one-minute retry cooldown.
6. The organization pin always remains visible, independently of restaurant filters. Restaurant pins require reviews for the selected organization. Unreviewed basemap POI layers are hidden. Supabase supplies the organization's ratings, votes and comments.

Reviewed-place records remain readable independently of upstream search availability. OSM data is community maintained: cuisine, addresses, hours or websites may be absent. The UI labels missing cuisine/hours rather than guessing. Hours are shown in OSM notation; they are not used to assert that a place is currently open. There is no automatic restaurant photo gallery.

External OSM facts are kept separately from organization-specific reviews. Full source credits and the cuisine-preset ISC notice are centralized under **Your team → Credits & licenses**. Restaurant lists show one compact OpenStreetMap source link for the whole view, instead of repeating a notice under each card. Web maps retain MapLibre’s automatic attribution and omit the duplicate block below; native maps keep a compact adjacent credit. This follows [OSM attribution guidance](https://osmfoundation.org/wiki/Attribution_Guidelines) and [OpenFreeMap’s attribution guidance](https://openfreemap.org/#attribution). Public services are best-effort, not a guaranteed unlimited production backend. See [Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/) and [Overpass guidance](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html). Providers can be replaced through configuration. Backend hosting and image storage remain separate costs.

## Cuisine corrections and editing OpenStreetMap

On an OSM restaurant's detail page, **Add cuisine for your team** fills missing cuisine; **Edit cuisine for your team** corrects an existing value. Search the bundled OSM iD cuisine catalogue and select up to eight options. Friendly labels such as **Italian**, **Pizza** and **Tex-Mex** save their exact OSM values (`italian`, `pizza`, `tex-mex`). Selections remain while you search. **Add a custom cuisine** is available when no preset fits; existing uncommon tags remain editable. Every organization member can save a correction for a restaurant found in that group's catalogue or already reviewed by the group. The correction appears in place details, restaurant searches and cuisine filters for that organization. **Use OpenStreetMap cuisine** removes it and restores the imported value.

Team corrections live in `place_cuisine_overrides`, separate from shared OSM metadata. Catalogue refreshes preserve them, and another organization's cuisine values remain independent. The UI identifies team-supplied cuisine. Apply `202610120013_place_cuisines.sql` and `202610120014_osm_cuisine_tags.sql`, restart/redeploy `places`, and reload the app to enable this feature on an existing installation. The second migration permits established hyphenated values; existing groups, reviews and corrections are retained.

The catalogue contains an offline snapshot of 104 common options from the [OSM iD tagging schema](https://github.com/openstreetmap/id-tagging-schema/blob/d80761bd2ed1/data/fields/cuisine.json). The exact source commit is recorded in `supabase/functions/_shared/cuisineTags.ts`; its ISC license is retained in `docs/licenses/osm-id-tagging-schema.txt`. Search makes no external calls. Friendly labels and known spelling variants normalize to canonical values, including older `tex_mex` entries when read, keeping cuisine filters consistent. OSM cuisine values remain open-ended, so the catalogue is a list of presets rather than a closed vocabulary.

**Edit on OpenStreetMap** opens the exact node, way or relation in OSM's iD editor. Users sign in with their own OSM account, review verified facts and publish changes there. Forkcast's cuisine form saves only to the organization; it does not publish to OSM. Public changes are checked when returning from the editor, and a team override remains in effect until removed. See [OSM cuisine tagging](https://wiki.openstreetmap.org/wiki/Key:cuisine) and the [editing guide](https://wiki.openstreetmap.org/wiki/Beginners%27_guide).

## Organization location upgrade

Apply `202610120012_organization_location.sql`, restart/redeploy the `places` function and reload the app. The migration preserves groups and reviews, adds saved coordinates, and reuses valid existing regional cache centers. New groups select a location before creation; administrators can set a location for older groups or change it later. Changing it clears only the restaurant catalogue, preserving review history.

Location lookup runs only when **Find organization location** is pressed, not while typing. The authenticated backend permits lookup before group creation, caches matching queries for 30 days and uses the same project-wide Nominatim request gate as restaurant search. The office point also becomes the center of the 3 km restaurant search. Public [Nominatim usage rules](https://operations.osmfoundation.org/policies/nominatim/) apply: no autocomplete, at most one request per second for the whole app, attribution and application identification. The default endpoint is configurable for an operator-managed provider.

## Upgrade existing Google-linked reviews

Apply **`202610120010_osm.sql`** before deploying the updated function/app. Earlier migrations are intentionally retained so existing installations upgrade without resetting data.

The migration adds provider metadata and cache tables; it does not delete reviews or guess matches. Previous Google entries remain in the reviewed-place list with their original authors, dates, comments and ratings. They have no invented coordinates and are absent from the map until matched.

An **organization administrator** opens a previous entry, taps **Match to an OSM place**, searches for the correct restaurant and confirms it. `link_legacy_place` atomically changes only that group's reviews to the OSM identifier. If the target already has reviews, both histories contribute to the aggregate. Another group's history is untouched. The original external Google reference can be opened to help identify the restaurant, but the app makes no Google API calls.

Google API environment variables/secrets are no longer read and can be removed from your own configuration.

## Google signup and login

**Continue with Google** creates an account on the first login and signs into it thereafter, without an app password or email verification code. Users still create or join a team. Email/password remains available for existing users. Apply `202610120011_google_auth.sql` so new profiles use Google's name; existing profiles and memberships are retained.

Following the [Supabase Google provider guide](https://supabase.com/docs/guides/auth/social-login/auth-google):

1. In Google Cloud, configure Google Auth Platform branding/audience and the `openid`, email and profile scopes. For External apps in Testing, add your testers; Internal is suitable when everyone belongs to your Google Workspace organization.
2. Create an OAuth client of type **Web application**, including for this mobile browser flow. Add the Supabase callback URI to Google's **Authorized redirect URIs**: `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback` for hosted Supabase or `http://127.0.0.1:54321/auth/v1/callback` for the local backend. Copy the exact URI from your Supabase Google provider settings. Do not put `forkcast://auth` in Google’s redirect URI list.
3. For hosted Supabase, enable **Authentication → Sign In / Providers → Google** and enter the client ID/secret there. Keep the secret out of app code and `EXPO_PUBLIC_` variables.
4. Under Supabase **Authentication → URL Configuration**, allow `forkcast://auth` and the exact browser app URLs, such as `http://localhost:8081` and `http://127.0.0.1:8081`. Set the Site URL to your browser app URL. Add your deployed HTTPS URL before deployment. When running Expo on another port, allow that URL too.
5. Restart Expo. For installed Android/iOS apps, rebuild after adding `expo-web-browser`; the app already registers the `forkcast` scheme. Test with an installed development build rather than Expo Go.

For local Supabase, copy `supabase/.env.example` to `supabase/.env.local`, fill the Google client ID/secret, set `[auth.external.google].enabled = true` in `supabase/config.toml`, and load the credentials into the CLI process:

```sh
set -a
source supabase/.env.local
set +a
# Restart a running local backend without resetting its data:
npx supabase stop
npx supabase start
npx supabase migration up --local
```

The checked-in Google provider is disabled until credentials are supplied, so email development remains usable. For mobile testing, a hosted Supabase backend is simplest; a local backend must have a browser-reachable callback/API address (Android's emulator alias alone is not a Google callback URL).

OAuth uses PKCE. Web returns to the app's current path; installed apps return to `forkcast://auth`. The app exchanges the one-time code, persists the session, removes callback parameters from the browser URL and preserves pending invites across browser navigation. Cancellation or failed exchanges show a retryable error. Google login does not grant organization membership based on email domain.

## Organizations, portions, images and payments

Members can create groups and join by invite code. Administrators can share or rotate the code; installed-app links look like `forkcast://join?code=…`. Incoming invites survive authentication. Group switching remounts navigation, and Postgres independently enforces membership.

Events use Berlin calendar dates and integer EUR cents. Joins, edits and opt-outs use `set_portions`, which locks the event row and checks capacity in the same transaction. Direct table writes cannot bypass the lock. Changing quantities resets self-reported payment status.

Organizers upload meal photos and receipts to a private bucket. Images are resized to a longest edge of 1600px, compressed as JPEG and limited to 5MiB. Members view them through signed URLs lasting ten minutes; Refresh images renews them. A failed metadata write attempts to remove the uploaded object.

Paid lunches require a PayPal.me destination. Pay opens `https://paypal.me/USERNAME/12.87EUR` with the exact amount. Participants confirm in PayPal and can mark themselves paid; transfers are not automatically verified.

## Checks

```sh
npm run check
npm run edge:check
npm run edge:test
npm run format:check
npm run export
```

For browser checks:

```sh
npm run test:ui:build
npx playwright install chromium
npm run test:ui
```

Browser tests use network fixtures only in tests. `FORKCAST_CHROMIUM_PATH` can point to an existing Chromium binary. The test build is isolated at `/tmp/forkcast-test-web`.

PostgreSQL portion-race tests run against a disposable server:

```sh
docker run --name forkcast-test-db --rm -d \
  -e POSTGRES_PASSWORD=forkcast-test-only \
  -p 127.0.0.1:55439:5432 postgres:17-alpine
FORKCAST_TEST_DATABASE_URL=postgres://postgres:forkcast-test-only@127.0.0.1:55439/postgres npm run test:postgres
docker stop forkcast-test-db
```

See [decisions](docs/decisions.md) and [verification](docs/verification.md). Optional AI macros, background push and automatic payment verification remain deferred.

## OSM edits and saved-place freshness

Opening Places or a saved place checks source facts older than 24 hours by their exact OSM IDs, independently of the monthly office catalogue discovery cache. Returning from **Edit on OpenStreetMap** automatically checks updated facts, with further checks during a ten-minute window and a five-minute cooldown per place. Source changes also update cached search entries without extending the catalogue lifetime. Reviews and private team cuisine overrides are preserved. To stop using a team override, select **Use OpenStreetMap cuisine**; this also requests fresh source facts. Public Overpass servers may take time to reflect an OSM edit. Failed or incomplete lookups keep saved facts and show a warning.

Apply `202610120019_osm_place_refresh.sql` and deploy the updated `places` Edge Function on hosted projects. Locally the migration is applied and the updated function is served. Leases, the existing shared Overpass request gate, and retry cooldowns prevent repeated/concurrent upstream requests.

## Automatic updates

The selected organization uses one Supabase Realtime connection for small organization and recipient-private change signals. Relevant visible screens reload after changes, with 350 ms burst coalescing. Foregrounding, reconnecting and web online events reload snapshots to catch missed changes. Subscriptions and network refreshes pause in the background. The app checks visible data every five minutes while connected and every minute if Realtime is unavailable, also handling Berlin day rollover. Routine refresh controls are removed; failed loads retain retry actions. Review/portion drafts and already-loaded list pages survive refreshes. Search refreshes only a previously submitted query, never the text currently being typed.

Apply `202610120020_live_updates.sql` and `202610120021_notification_signal_scope.sql` to hosted Supabase before deploying the app; it adds the two access-controlled signal tables to the existing `supabase_realtime` publication. Local migration and real authenticated Realtime delivery have been verified.

Review editing: apply `202610130022_editable_reviews.sql`. Each colleague’s latest review counts once per place and organization. Saved reviews prefill the form and can be edited; previous versions remain in the private review history. Existing repeated reviews are preserved, with only the latest per author counted.

Lunch picker: apply `202610130023_lunch_picker.sql`. The compact **Spin the wheel / Glücksrad drehen** action beside voting opens the wheel in a modal. Explicit nominations for today take priority; otherwise the picker uses reviewed OSM places matching the cuisine and rating filters in Places. Filters are shared within the selected organization’s current app session. Results remain visible in today’s shared plan.

Lunch responses: apply `202610130024_lunch_ordering.sql`. Saved “not in the office” answers, including historical dates, merge into “No lunch / away”. “Ordering in” has its own daily team count. Older clients sending absence responses are normalized to the combined choice. Restaurant votes and the picker remain for going-out members.

Daily shortlist: apply `202610130025_daily_shortlist.sql`. Existing nominations, votes and picks remain eligible; unused automatically seeded rows are retained but hidden. New days are not filled from review history. With no shortlist, **Spin the wheel** chooses a reviewed OSM place matching the Places filters and adds only that result to today’s list.

Star-only reviews: apply `202610130026_star_only_reviews.sql`. Reviews use stars and optional comments; recommendation selectors, totals and filters are removed. The new `save_review` RPC needs no recommendation and keeps editable review history. Historical recommendation fields and the legacy RPC are retained for compatibility, while rating aggregates expose only average and review count.

Cooking-linked attendance: apply `202610130027_cooking_attendance.sql` and `202610130028_preserve_manual_office_choice.sql`. Joining cooking selects **Eating in the office / Im Büro essen** for its scheduled day and removes that day’s restaurant vote. A **Joined office cooking** note appears on today’s overview. Leaving the last booking clears only an automatically selected answer; explicit choices, including an office answer selected before joining, remain. Portion/payment updates and repeated notification quick-joins do not overwrite later choices. Existing bookings fill only unanswered days.

Cooking organizer tools: apply `202610130029_cooking_meal_flags.sql`. Organizers see an expanded participant roster with portions, amounts, paid/unpaid groups and totals. Payment can be self-reported or confirmed by the organizer. Choose optional **Vegetarian**, **Vegan**, **Spicy**, **Gluten-free** and **Dairy-free** tags during creation, or edit them on the event page. Only the organizer may edit tags; members can view them in the cooking list, today’s plan and event details. Existing events start with no tags, and updates use the existing live connection.

Cooking signup deadlines: apply `202610130031_cooking_signup_deadlines.sql` and reload the app. Choose **Set a deadline** when creating a lunch, with a date and time in **Europe/Berlin**. The organizer can set/edit/remove the deadline on the event page, close signup immediately or reopen it. Deadlines must be in the future and on or before the lunch date; ambiguous/nonexistent clock-change times are rejected. Existing lunches keep no deadline. After the cutoff, new bookings and portion increases are blocked by the database, including notification quick joins and requests waiting on locks. Existing attendees may reduce portions, leave and mark payment. Cooking lists, today’s plan and invitations show the deadline/closed status; local timers update expiry without polling, and live changes refresh shared event data. Normal closure at the end of the lunch day still applies.

Organizer payment confirmation and signup alerts: apply `202610130032_cooking_payment_confirmation.sql`. Use **Confirm** beside an unpaid or self-reported paid participant in the event roster. This marks the participant paid, clears their unpaid reminder, and sends one private confirmation notification with no further action required. Repeated confirmation does not send another alert. Participants cannot undo organizer confirmation; changing portions resets payment/confirmation because the amount changes. The server checks the displayed portion count before confirming to reject stale amounts. Organizers receive a private new-signup alert linking to the event when a colleague books, including free lunches and notification quick joins. Quantity/payment edits do not repeat that alert, and cancellations remove it. Existing payments remain self-reported until confirmed; organizer confirmations and new-signup alerts are ordinary readable/dismissible notifications, while unresolved payment reminders remain persistent.

Personal restaurant favorites: apply `202610130033_restaurant_favorites.sql`, restart/redeploy the `places` Edge Function and reload the app. Use the bookmark button on an OSM restaurant's detail page or reviewed-place list. **Places → Favorites** shows your own bookmarks for the selected organization, with search for larger lists and a **+** action to nominate a restaurant for today. The overview's suggestion dialog opens favorites first when you have them, with a switch back to reviewed saved places. No review is required. Favorites remain accessible after regional cache refreshes; nominating shares the restaurant with colleagues, while your bookmark list stays private. Removing a bookmark keeps its existing nomination. Bookmarks alone do not change the wheel pool, and saving them creates no notifications. Changes use the existing private live refresh channel.

Organization roles: apply `202610130034_organization_roles.sql` before loading the updated app (already applied to local Supabase). Under **Your team → Members & roles**, administrators can promote colleagues to administrator or return them to member. Existing creators and new group creators start as administrators; invited colleagues start as members, and rejoining preserves their role. All administrators can manage invitations, the office location/search area and matching legacy restaurant entries. Creators have no special permissions after demotion. At least one administrator must remain, including during concurrent role changes. Members can view their group's roster, and role changes update through existing automatic refresh signals. Cooking controls continue to belong to each meal's organizer.

Member management: apply `202610130035_member_management.sql` (already applied locally). **Your team → Members & roles** shows the roster; tap a colleague's row as an administrator to change their role or remove their access. Removal requires confirmation and rotates the shared invitation code, invalidating older invitations. **Leave organization** lets members leave after confirmation. Administrators must appoint another administrator first if they are the last one. Leaving switches to another organization you belong to, or returns to the join/create screen. Reviews, cooking signups and payment records stay with the group; access changes do not cancel bookings or erase history. Existing signups can be settled by their meal organizer. A private membership signal updates the affected device after access revocation, and the same one-channel subscription also catches membership changes in other groups. When no group remains, a single account-only subscription watches for new memberships; foreground/reconnect and periodic fallbacks catch missed updates.

Distances use openrouteservice walking routes when configured, with device-calculated straight-line estimates as a clearly labelled fallback. They appear in reviewed lists, favorites, search results, restaurant details and lunch options/candidate previews. **Places → Distance** offers 500 m, 1 km, 2 km or 3 km limits; the sort icon switches between best rated and nearest first. Map and reviewed list share the filter, and the wheel's reviewed-place fallback uses it too; explicit nominations keep priority. Favorites remain independent of the reviewed-place filters. Missing office coordinates disable distance choices; unknown/unreachable distances sort last and are excluded when a distance limit is active. See **Walking distances (openrouteservice)** above for server setup and cache behavior. No device location permission is needed.

Shared office orders: apply `202610140036_office_orders.sql`, `202610140037_order_organizer_selection.sql`, `202610140038_order_date_validation.sql` and `202610140039_order_reminder_reads.sql` before loading the updated app. On **Overview → Ordering in**, use **+ / Start group order** or the list icon to browse upcoming/past orders. Choose the colleague who will place the order, restaurant/menu link, delivery address/instructions, Berlin signup deadline and optional PayPal.me payment recipient. Participants enter item names, quantities, unit prices and requests, then save as **Still choosing** or **Ready to order**. Joining automatically selects **Ordering in** on the order date; leaving/cancelling clears only automatically generated responses and preserves manual choices.

The organizer closes edits, uses the grouped checklist/copy action to place the purchase externally, then records the final delivery fee and optional arrival time and marks it placed. Identical choices combine only when prices and requests match; names and requested quantities remain in the copied order. Fees split equally per participant, with leftover cents assigned deterministically so every cent is accounted for. Payment amounts and items freeze on placement; the organizer's own share is settled automatically. Participants can open the payment link and self-report payment; the organizer can confirm it, clearing the persistent unpaid alert and notifying the participant. Arrival is announced manually. Changing the deadline/reopening and cancelling before placement are supported; placed orders cannot be cancelled in the app.

Order creation, scheduled ten-minute reminders for unready participants, placement, arrival and payment updates appear in the private in-app inbox. Scheduled reminders update the header through a deadline timer; they also appear on reopening the app. Background push and provider checkout integration are not part of this feature. Existing automatic refresh signals update the shared sheet. Other-device changes preserve unsaved drafts and their original revision; conflicts offer an explicit **Load latest order** confirmation instead of overwriting newer choices. Source menu prices and final fees are entered manually; no delivery-provider API/account integration is required.
