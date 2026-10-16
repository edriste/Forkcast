# Cloudflare and Supabase

Cloudflare serves the PWA. Supabase provides the database, authentication, images, live updates and restaurant-search function. Optional device push needs a [separate worker](https://github.com/edriste/Forkcast/wiki/Device-notifications).

## 1. Prepare Supabase

Create a Supabase project. From your Forkcast checkout, with Node 22.14+ installed:

```sh
npm ci
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
npx supabase functions deploy places --no-verify-jwt
```

The function validates signed-in users and organization membership itself.

Configure [authentication](https://github.com/edriste/Forkcast/wiki/Authentication). Set provider keys in **Edge Functions → Secrets**, following [Maps and location](https://github.com/edriste/Forkcast/wiki/Maps-and-location). Keep these secrets out of Cloudflare's frontend settings.

## 2. Connect Cloudflare to the repository

Use Workers Static Assets with these settings:

| Field           | Value                                      |
| --------------- | ------------------------------------------ |
| Project name    | `forkcast`                                 |
| Build command   | `npm run build:web`                        |
| Deploy command  | `npx wrangler deploy`                      |
| Preview command | `npx wrangler versions upload`             |
| Path            | `/`                                        |
| API token       | Let Cloudflare create the deployment token |

The checked-in `wrangler.json` supplies the compatibility date and SPA routing.

Add **build variables**:

```dotenv
NODE_VERSION=22.14.0
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_PUBLISHABLE_OR_ANON_KEY
EXPO_PUBLIC_GOOGLE_AUTH_ENABLED=false
```

Enable Google only after configuring its provider. Optional public settings are listed in [.env.example](https://github.com/edriste/Forkcast/blob/main/.env.example).

## 3. Deploy and test

Deploy, then set Supabase Auth's **Site URL** and allowed redirect URL to your final HTTPS app address. Test sign-in, office selection and restaurant search.

Build variables are embedded in the app: changing them requires a new build. Cloudflare runtime secrets do not update an exported frontend.

For a local deployment, put the same public settings in the ignored `.env.production.local`, then run:

```sh
npm run build:web
npx wrangler deploy
```

Check that another local env file or shell variable is not overriding the production URL. See [Maintenance](https://github.com/edriste/Forkcast/wiki/Maintenance) for future releases and [Troubleshooting](https://github.com/edriste/Forkcast/wiki/Troubleshooting) for common setup errors.
