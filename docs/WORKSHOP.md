# Robot Workshop

The in-game workshop (menu: WORKSHOP) is a starter editor for writing your own
robot. It gives you a template, runs static sanity checks as you type, and
produces a downloadable `.ts` file.

## What it does

1. **Template** — the one-file robot shape from `docs/ROBOT_API.md` (meta +
   default loadout + `create()` factory with an aim-and-chase stub), ready to
   edit in the browser.
2. **Static checks** — every keystroke re-runs plain string analysis:
   - structure: exported `meta` (id, name, author, version, description),
     lowercase meta id, exported default `loadout`, exported `create()`
     factory, and an Intent-shaped return (throttle/turn/towerTurn/fire/charge);
   - loadout: a statically readable build must fit the 6-point budget and use
     known skill ids (dynamic loadouts are skipped, not failed);
   - safety: imports limited to `../sim/*` and `./common`; no random/time APIs
     (use `sense.rand()`), no network/storage APIs, no DOM or code-escape APIs.
   - Mentions inside comments and string literals don't count — only real code
     is scanned.
3. **Download** — one click downloads your draft as `<meta-id>.ts` (or
   `my-robot.ts` when the id isn't usable yet). Copy-to-clipboard and template
   reset are one click too.

## What it doesn't do

The workshop **never executes your code** — not in an iframe, not in a worker,
not via dynamic import. The checks are guidance, not a sandbox: the guarantee
is the absence of execution. Test your robot locally (`npm run test:sim`, plus
your own matchups in a scratch script) and submit it via pull request as
described in `CONTRIBUTING.md`.
