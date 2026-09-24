# Chrome Web Store listing

Everything to paste into the Developer Dashboard. Assets are in `docs/store/`; the
upload ZIP comes from `scripts/package.sh`.

## Store listing tab

**Title** (from manifest)

GitHub slash command autocomplete

**Summary** (from manifest description, max 132 characters)

Autocompletes the /commands that a repository's GitHub Actions workflows respond to, in PR and issue comment boxes.

**Description**

Many repositories have GitHub Actions that run when someone comments a slash command
on a pull request: /hotfix, /gen-api, /rebase, /deploy and so on. Nobody remembers
them all.

This extension reads the repository's .github/workflows files through your existing
github.com session, finds the commands those workflows respond to, and offers them as
suggestions when you type / at the start of a line in a PR, issue or discussion
comment box. Each suggestion shows the workflow that owns the command and, when the
workflow documents it, a one-line description. Enter or Tab inserts the command.

It works on private repositories with no setup, because it uses the same session
your browser already has. Commands are cached per repository for six hours; the
options page lets you clear the cache or change the interval.

It finds commands in:
• if: expressions such as startsWith(github.event.comment.body, '/gen-api'), contains(...) and == '/ack'
• actions/github-script snippets such as body.startsWith('/rerun')
• shell steps that switch on $COMMENT_BODY
• peter-evans/slash-command-dispatch command lists

No analytics, no server, no data leaves your browser except requests to github.com.
Open source: https://github.com/lawrencejones/gh-slash-commands

**Category**: Developer Tools
**Language**: English

**Store icon**: `icons/icon-128.png`
**Screenshots**: `docs/store/screenshot-1280x800.png`
**Small promo tile** (optional): `docs/store/promo-440x280.png`

## Privacy practices tab

**Single purpose description**

Suggests and autocompletes the slash commands a repository's GitHub Actions workflows
respond to, inside GitHub comment boxes.

**Permission justifications**

- `storage`: caches the list of commands found per repository so suggestions appear
  instantly, stores the user's options (cache interval and an optional GitHub token).
- Host permission `https://github.com/*`: the extension runs on GitHub pages to show
  suggestions in comment boxes, and fetches the repository's workflow files from
  github.com using the user's existing session.
- Host permission `https://api.github.com/*`: fallback for reading workflow files
  through the REST API if the same-origin routes are unavailable, using a token the
  user optionally provides.

**Remote code**: No, I am not using remote code.

**Data usage**: tick only "Authentication information" (the optional personal access
token, stored locally and sent only to api.github.com). Leave every other category
unticked.

Certify all three statements: not sold to third parties, not used for purposes
unrelated to the single purpose, not used for creditworthiness or lending.

**Privacy policy URL**

https://github.com/lawrencejones/gh-slash-commands/blob/main/PRIVACY.md

## Distribution tab

**Visibility**: Unlisted to start (anyone with the link can install; not in search).
Switch to Public once it has been used for a bit.

**Regions**: all.
