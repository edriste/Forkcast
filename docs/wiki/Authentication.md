# Authentication

Configure the backend first, then enable the corresponding sign-in option in the frontend.

## Email and password

On Supabase Cloud, enable email signup and confirmation, set a minimum password length of eight, and configure custom SMTP. In **Authentication → Email Templates → Confirm signup**, use [Forkcast's template](https://github.com/edriste/Forkcast/blob/main/supabase/templates/confirmation.html), which displays `{{ .Token }}` as a six-digit code.

For a Docker backend, configure SMTP in its `.env` as described in [Self-hosting](https://github.com/edriste/Forkcast/wiki/Self-hosting). Local development emails appear at `http://127.0.0.1:54324`.

## Google sign-in

1. In Google Cloud, configure OAuth branding/audience. Add testers if the app is in Testing.
2. Create a **Web application** OAuth client. Register the exact callback shown by Supabase, usually `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`.
3. Enable Google's provider in Supabase and enter the client ID and secret. Leave **Skip nonce checks** and **Allow users without an email** disabled.
4. Set Supabase's **Site URL** and redirect allowlist to the deployed app URL. Add localhost only for development and `forkcast://auth` for native builds.
5. Set the frontend's `EXPO_PUBLIC_GOOGLE_AUTH_ENABLED=true` and redeploy.

For self-hosted Auth, set `GOOGLE_ENABLED=true`, `GOOGLE_CLIENT_ID` and `GOOGLE_SECRET` in the backend environment, then recreate `auth`. Use `https://YOUR_API_DOMAIN/auth/v1/callback` as Google's callback.

Google redirects to **Supabase**, which then redirects to **Forkcast**. Do not register Forkcast's URL or `forkcast://auth` as Google's callback. Signing in creates an account; it does not automatically grant team membership.

See [Supabase's Google guide](https://supabase.com/docs/guides/auth/social-login/auth-google).
