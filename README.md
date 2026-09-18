# deadair community

The catalogue behind [deadair.radio/community](https://deadair.radio/community): stations people
run, plugins people wrote, characters people put on the air, and the apps that play and drive a
station. One file per entry, so two submissions never touch the same file.

This repository holds content, not code the station runs. Nothing here is fetched by a station, and
nothing merged here changes one.

| Kind | File | What it is |
| --- | --- | --- |
| Stations | `stations/<slug>.json` | A station on the air, with its public address. The directory checks whether it is on air by reading its `/api/nowplaying`, which every station answers without a sign-in. |
| Plugins | `plugins/<slug>.json` | A plugin, described by its author, with where to get it. **Listed is not vetted.** A plugin is code that runs inside the station's own process; install one only from somebody you trust. |
| Personas | `personas/<slug>.json` | A character, as the console's Personas page exports it, plus a line for the card. The file is published on its own, so a download goes straight into the console's Import. |
| Apps | `apps/<slug>.json` | A player, a remote, an integration or a library. Links only. |

A file's name is its slug: lowercase letters, digits and hyphens, starting with a letter or digit, at
most 49 characters. Each kind has a schema under `schemas/`; put `"$schema": "../schemas/<kind>.schema.json"`
at the top of an entry and an editor will check it as you type.

## Building it

```bash
npm install
npm run check    # what a pull request runs
npm test
npm run build    # writes dist/: catalog.json, each persona's file, the schemas
```

`schemas/persona.file.schema.json` is generated from the station's own contract, so a persona the
catalogue accepts is one the console's Import accepts. When that contract changes, regenerate it
against a deadair checkout whose `apps/api` has its dependencies installed:

```bash
node scripts/persona.schema.sync.mjs ../deadair
```

## Licence

Every entry is dedicated to the public domain under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/), so anybody can take a character or a
listing and do what they like with it. A plugin listed here keeps its own licence; the entry only
describes it.
