# Kinfolk

Kinfolk matches renters with compatible roommates and finds an apartment the group can afford together. You talk to it over text, and you stay anonymous until you and a match both say yes.

It's live at [usekinfolk.com](https://usekinfolk.com). Built with [Jack Munhall](https://github.com/jackmunhall). (WIP testing around ability to build a compelling user experience with text agent enrichment) 

![The Kinfolk homepage: "Matching changes which doors are open."](docs/assets/homepage.png)

## Stack

- Next.js and React in `apps/web`
- Supabase for the database, with migrations in `supabase/`
- Clerk for sign-in
- Sendblue and Linq for texting
- Mapbox for the apartment map
- Vercel AI SDK for the text agent

## Run it locally

You need Node 22.13 or later and your own accounts for the services above.

```bash
corepack enable
pnpm install
cp apps/web/.env.example apps/web/.env.local
pnpm dev:web
```

Fill in `apps/web/.env.local` before you start the app. `pnpm dev:web` runs only the site. `pnpm dev` also opens a `cloudflared` tunnel so that texting webhooks can reach your machine.

This repo doesn't include the tools we used to import listings, so you'll need your own listing data.

## Tests

```bash
pnpm test
pnpm typecheck
```

## License

[MIT](./LICENSE)
