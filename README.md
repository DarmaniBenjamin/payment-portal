# Payment Portal

Self-hosted payment portal for Grenada, using WiPay as the card gateway.
One core service that WordPress sites, static sites and other apps connect to.

All rights reserved.

## Local setup

1. Install packages: `npm install`
2. Copy `.env.example` to `.env`, fill in your database details, and set
   `ENCRYPTION_KEY` to the output of `npm run -s gen:key`
3. Create the database tables: `npm run db:migrate`
4. Start in dev mode: `npm run dev`
5. Check it works: http://localhost:4000/api/health

## Connecting a site

Create a merchant and site, and get its API key:

```
npm run site:create -- --merchant "Business name" --email you@example.com --site "Site name" --type wordpress
```

The site sends the key as `Authorization: Bearer pp_...`. Test it with `GET /api/v1/me`.
