# Site adapters

This starter keeps site-level setup in `config.ts`.

For production, create one file per website, for example:

```text
src/sites/hays.ts
src/sites/randstad.ts
src/sites/michaelpage.ts
```

Each adapter should define:

- start URLs
- listing selectors
- detail-page selectors
- pagination logic
- any network/API endpoint discovered with Playwright DevTools
