# Privacy policy

GitHub slash command autocomplete runs entirely in your browser. It has no server,
collects no analytics, and sends nothing to anyone but GitHub.

## What it reads

When you open a pull request, issue or discussion on github.com, the extension fetches
that repository's `.github/workflows/*.yml` files from github.com using the session
you are already signed in with. It extracts the slash commands those workflows respond
to and shows them as suggestions in the comment box.

It does not read your comments, the page content beyond the comment box you are typing
in, or any other GitHub data.

## What it stores

- The list of commands found for each repository, kept in the extension's local
  storage in your browser so the suggestions appear instantly. Cleared from the
  options page or when you remove the extension.
- Optionally, a GitHub personal access token that you enter on the options page. It is
  stored in the extension's local storage, sent only to `api.github.com` as a fallback
  when the same-origin workflow routes fail, and never sent anywhere else. You can
  delete it from the options page at any time.

## What it sends

Requests go only to `github.com` and `api.github.com`, to read workflow files. No data
is sent to the extension's author or to any third party.

## Changes

This policy lives in the repository at
https://github.com/lawrencejones/gh-slash-commands/blob/main/PRIVACY.md; any change is
visible in its history.
