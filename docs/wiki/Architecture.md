# Architecture

Forkcast uses Expo/React Native, TypeScript and React Navigation. The browser build is an installable PWA; native builds share the same backend.

| Component              | Responsibility                                                              |
| ---------------------- | --------------------------------------------------------------------------- |
| Static frontend        | Screens, local preferences, PWA installation and update prompt              |
| Supabase Auth          | Email/password and optional Google OAuth sessions                           |
| Postgres               | Organizations, reviews, lunch plans, bookings, orders and payments          |
| Storage                | Private meal images and receipts                                            |
| Realtime               | Organization/private change signals that refresh visible screens            |
| `places` Edge Function | Authenticated provider requests, shared restaurant facts and walking routes |
| Optional Node worker   | Grouped, rate-limited Web Push delivery                                     |

Database access policies and RPCs enforce organization membership, roles, capacity and payment rules. External restaurant facts are stored separately from team reviews; original OSM IDs keep those relationships stable across provider changes.

Provider keys and administrator database credentials stay on the server. Public frontend settings contain only the backend URL, publishable/anon key and optional public configuration.

Realtime updates are backed by foreground/reconnect refreshes and periodic checks. PWA releases prompt users to reload; neither offline app operation nor automatic payment-provider reconciliation is implemented.

See [repository development guide](https://github.com/edriste/Forkcast) for code-level checks.
