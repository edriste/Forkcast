# Troubleshooting

| Symptom                                                          | What to check                                                                                                                                                          |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google: “provider is not enabled”                                | Enable Google in the **same Supabase project** used by the frontend.                                                                                                   |
| Google: `redirect_uri_mismatch`                                  | Register Supabase's exact `/auth/v1/callback` URL in the Google OAuth client.                                                                                          |
| Login returns to localhost                                       | Set Supabase Auth's Site URL and allowed redirects to the deployed Forkcast URL. Start a fresh sign-in; callback links are single-use.                                 |
| App points to `forkcast-test.supabase.co`                        | Rebuild with real production frontend variables. That hostname belongs only to browser tests.                                                                          |
| Organization creation fails with `organizations_created_by_fkey` | Apply all pending migrations, including profile backfill. Do not delete the user account.                                                                              |
| Office search fails                                              | Check the geocoding provider and key; office lookup and restaurant search use separate services.                                                                       |
| Restaurant search times out                                      | Check `places` logs and the selected provider. For hosted-network Overpass failures, configure [Geoapify](https://github.com/edriste/Forkcast/wiki/Maps-and-location). |
| Only straight-line distances appear                              | Add an ORS key with Matrix access. Check quota and function logs; office coordinates must be saved.                                                                    |
| Repeated searches say to wait                                    | A failed search has a short cooldown; an active refresh can hold a lease for up to two minutes.                                                                        |
| No email code                                                    | Check SMTP delivery and that the signup email template includes `{{ .Token }}`. Local mail is at port 54324.                                                           |
| No device notifications                                          | Check [worker setup](https://github.com/edriste/Forkcast/wiki/Device-notifications), permission, quiet hours and the daily cap. On iPhone, use the Home Screen app.    |

For Supabase Cloud, open **Edge Functions → places → Logs**. On a Docker backend:

```sh
docker compose logs --tail=100 functions auth rest
```

An HTTP 401/403 usually indicates rejected credentials/access, 429 indicates rate limiting, and 5xx/timeout indicates a service or connection failure. A normal `EarlyDrop` shutdown entry alone does not explain a failed request.

A Cloudflare frontend deployment does not deploy functions or database migrations. If something still fails, record the action, timestamp, selected provider and relevant status code; keep keys and personal data out of shared logs.
