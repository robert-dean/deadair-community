# Adding to the catalogue

## The easy way

Open the form for what you are adding. A bot turns your answers into a pull request with one file
in it, or comments on the issue with what has to change; edit the issue and it tries again.

- [Add a station](https://github.com/robert-dean/deadair-community/issues/new?template=add-station.yml)
- [Share a persona](https://github.com/robert-dean/deadair-community/issues/new?template=add-persona.yml)
- [List a plugin](https://github.com/robert-dean/deadair-community/issues/new?template=add-plugin.yml)
- [List an app](https://github.com/robert-dean/deadair-community/issues/new?template=add-app.yml)
- [Share a language](https://github.com/robert-dean/deadair-community/issues/new?template=add-language.yml)

Submitting needs a GitHub account: it is how an entry is credited, and how it is kept yours. Only
the account that submitted an entry can replace it through a form. **Asking for an entry to come
down does not need one**; see [TAKEDOWN.md](TAKEDOWN.md).

Questions, and anything that is not a submission, go to the deadair repository's
[Discussions](https://github.com/robert-dean/deadair/discussions).

## By hand

Fork, add one file under `stations/`, `plugins/`, `personas/`, `apps/` or `languages/`, and open a pull request.
The file's name is its slug. Put `"$schema": "../schemas/<kind>.schema.json"` at the top and your
editor checks it as you type; leave `listing` for a maintainer to fill in. Then:

```bash
npm install
npm run check
```

For a persona, export the one character from its own page in the console and put the file under
`file`, as it came out. Its `key` must match the file's name, and must not be one of the characters
every station already ships, because the console's Import merges by key and would overwrite that
station's own copy.

For a language, export it from **Settings, Languages** in the console, or start from the English
template every deadair release carries (`deadair-console-en.json`), and put the pack under `file`, as
it is. Name the file after its language tag in lower case, `languages/pt-br.json` for `pt-BR`. There is
one entry per language, so if yours is already listed, improve that one with whoever submitted it.
[Languages](https://deadair.radio/docs/features/languages) on the deadair site has the rules a
translation has to follow for every string to be used.

The form works for a language too, but a pack is too big to paste into an issue: it asks for an
https address that downloads the file (a gist's Raw link, or a release asset) and fetches it from
there.

## What a maintainer checks

The check covers the shape. A person reads for the rest, and will ask for a change or decline:

- **Stations.** The address answers and plays. What you broadcast, and whether you may, is yours to
  settle before you list it: read [music licensing](https://deadair.radio/docs/licensing).
- **Personas.** A character, not a real, living person, and nothing the station's own content policy
  would stop it saying. What is in the file is public once merged, stories included.
- **Plugins.** The source is public and the description matches the manifest. **That is all.** Nobody
  reviews a listed plugin's code, the directory says so on every card, and a plugin runs inside the
  station's own process. Install one only from somebody you trust.
- **Apps.** It exists, and it does what the listing says.
- **Languages.** It is the language it says it is, and it says nothing the console's English does
  not. Nobody here checks a translation's quality: a card says how many strings a pack holds, and the
  console says, when a pack is imported, how many of its own it covers.

## A pull request the bot opened

GitHub does not start checks on a pull request that a workflow opened with its own token. The bot
runs the same check before it opens one and says so in the description. To run the checks again,
close and reopen the pull request.

## Licence

By submitting an entry you dedicate it to the public domain under [CC0 1.0](LICENSE). A plugin or an
app keeps its own licence: the entry describes it and does not relicense it.

The [code of conduct](CODE_OF_CONDUCT.md) applies here as it does everywhere the project is.
