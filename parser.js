// Extracts the slash commands that GitHub Actions workflows respond to.
//
// Runs both as a content script (attached to globalThis) and under node for the
// tests, so it has no DOM or chrome.* dependencies. It works on the raw YAML text
// rather than a parsed document: the commands live inside `if:` expressions and
// shell snippets, which a YAML parser would hand back as opaque strings anyway.
(function (root) {
  "use strict";

  const COMMENT_EVENTS = /\b(issue_comment|pull_request_review_comment|discussion_comment)\b/;

  // A command token: slash, then a word. Stops before anything that isn't part of a
  // command name, so '/split-migrations-full' and '/hotfix' both survive intact.
  const TOKEN = /^\/[A-Za-z][\w-]*/;

  // Expression-function forms: startsWith(github.event.comment.body, '/foo'),
  // contains(...), endsWith(...). Whitespace and newlines are allowed anywhere YAML
  // block scalars might fold them. Group 1 captures a leading `!` so negated checks
  // (`!contains(body, '/other')`) can be attributed elsewhere.
  const FUNC_FORM =
    /(!?)\s*\b(?:startsWith|contains|endsWith)\s*\(\s*[\w.\[\]'"-]*comment\.body\s*,\s*(['"])(\/[^'"]*)\2\s*\)/g;

  // Equality forms in either order: comment.body == '/foo' or '/foo' == comment.body.
  const EQ_FORM_LHS = /comment\.body\s*(==|!=)\s*(['"])(\/[^'"]*)\2/g;
  const EQ_FORM_RHS = /(['"])(\/[^'"]*)\1\s*(==|!=)\s*[\w.\[\]'"-]*comment\.body/g;

  // JavaScript (actions/github-script) forms: body.startsWith('/foo'),
  // body.includes('/foo'), and regex literals like /^\/foo\b/.
  const JS_METHOD_FORM = /\.(?:startsWith|includes|indexOf|match|test)\(\s*(['"`])(\/[^'"`]*)\1/g;

  // Lines that clearly deal with the comment body in shell: `case "$COMMENT_BODY"`,
  // `[[ "$BODY" == /foo* ]]`, `grep -q '^/foo'`. We only look at lines that mention a
  // body-ish variable so paths like /tmp don't leak in.
  const SHELL_BODY_LINE = /(COMMENT_BODY|comment_body|COMMENT|\$BODY|\bbody\b)/;
  const SHELL_TOKEN = /(?:^|[\s'"(|^])(\/[A-Za-z][\w-]*)/g;

  function fileName(path) {
    return path.split("/").pop();
  }

  function workflowName(text) {
    const m = text.match(/^name:\s*(.+?)\s*$/m);
    if (!m) return null;
    return m[1].replace(/^['"]|['"]$/g, "");
  }

  // The header comment block: consecutive `#` lines at the top of the file (after an
  // optional `---`), split into paragraphs on blank `#` lines.
  function headerParagraphs(text) {
    const lines = text.split("\n");
    let i = 0;
    while (i < lines.length && (lines[i].trim() === "" || lines[i].trim() === "---")) i++;
    const paras = [];
    let cur = [];
    for (; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trimStart().startsWith("#")) break;
      const body = line.replace(/^\s*#\s?/, "");
      if (body.trim() === "") {
        if (cur.length) paras.push(cur.join(" ").replace(/\s+/g, " ").trim());
        cur = [];
      } else {
        cur.push(body);
      }
    }
    if (cur.length) paras.push(cur.join(" ").replace(/\s+/g, " ").trim());
    return paras.filter(Boolean);
  }

  // True when `text` mentions the command as a whole word, so `/approve` does not match
  // a comment about `/approve-bypass`.
  function mentions(text, command) {
    const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`${escaped}(?![\\w-])`).test(text);
  }

  // Every `#` comment paragraph in the file: runs of consecutive comment lines, split on
  // blank `#` lines. Mid-file comments such as "# Only run if the comment is `/gen-api`"
  // often describe a command better than the header does, and joining the run means a
  // sentence wrapped over several lines comes back whole.
  function commentParagraphs(text) {
    const paras = [];
    let cur = [];
    const flush = () => {
      if (cur.length) paras.push(cur.join(" ").replace(/\s+/g, " ").trim());
      cur = [];
    };
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("#")) {
        flush();
        continue;
      }
      const body = t.replace(/^#\s?/, "");
      if (body.trim() === "") flush();
      else cur.push(body);
    }
    flush();
    return paras.filter(Boolean);
  }

  function describe(text, command, paras) {
    // Prefer a header paragraph that names the command, then any comment paragraph that
    // does, then the first header paragraph.
    const named = paras.find((p) => mentions(p, command));
    if (named) return trimDescription(named);
    const anywhere = commentParagraphs(text).find((p) => mentions(p, command));
    if (anywhere) return trimDescription(anywhere);
    return paras.length ? trimDescription(paras[0]) : "";
  }

  function trimDescription(s) {
    const max = 220;
    if (s.length <= max) return s;
    const cut = s.slice(0, max);
    const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(" "));
    return cut.slice(0, stop > 60 ? stop : max).trim() + "…";
  }

  function toToken(raw) {
    const m = raw.match(TOKEN);
    return m ? m[0] : null;
  }

  // Returns {positive: Set, negative: Set} of command tokens found in one workflow.
  function findTokens(text) {
    const positive = new Set();
    const negative = new Set();
    const add = (raw, negated) => {
      const tok = toToken(raw);
      if (!tok) return;
      (negated ? negative : positive).add(tok);
    };

    let m;
    FUNC_FORM.lastIndex = 0;
    while ((m = FUNC_FORM.exec(text))) add(m[3], m[1] === "!");
    EQ_FORM_LHS.lastIndex = 0;
    while ((m = EQ_FORM_LHS.exec(text))) add(m[3], m[1] === "!=");
    EQ_FORM_RHS.lastIndex = 0;
    while ((m = EQ_FORM_RHS.exec(text))) add(m[2], m[3] === "!=");
    JS_METHOD_FORM.lastIndex = 0;
    while ((m = JS_METHOD_FORM.exec(text))) add(m[2], false);

    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trimStart().startsWith("#")) continue;
      if (!SHELL_BODY_LINE.test(line)) continue;
      // Skip the expression forms; they were handled above with negation awareness.
      if (/comment\.body/.test(line)) continue;
      SHELL_TOKEN.lastIndex = 0;
      let s;
      while ((s = SHELL_TOKEN.exec(line))) add(s[1], false);

      // `case "$COMMENT_BODY" in` — the patterns live on the following lines, up to esac.
      if (/\bcase\b.*\bin\s*$/.test(line)) {
        for (let j = i + 1; j < lines.length && !/^\s*esac\b/.test(lines[j]); j++) {
          const pat = lines[j].match(/^\s*([^)]*)\)/);
          if (!pat) continue;
          SHELL_TOKEN.lastIndex = 0;
          while ((s = SHELL_TOKEN.exec(" " + pat[1]))) add(s[1], false);
        }
      }
    }

    // slash-command-dispatch style: `commands: hotfix, deploy` or a block list. The
    // value is the rest of the line plus any lines indented deeper than the key.
    if (/slash-command-dispatch/.test(text)) {
      const idx = lines.findIndex((l) => /^\s*commands:/.test(l));
      if (idx !== -1) {
        const indent = lines[idx].match(/^\s*/)[0].length;
        let value = lines[idx].replace(/^\s*commands:\s*[|>]?[-+]?\s*/, "");
        for (let j = idx + 1; j < lines.length; j++) {
          const l = lines[j];
          if (l.trim() === "") continue;
          if (l.match(/^\s*/)[0].length <= indent) break;
          value += " " + l.trim();
        }
        for (const c of value.split(/[\s,]+/)) {
          const t = c.replace(/^['"-]+|['"]$/g, "").trim();
          if (/^[A-Za-z][\w-]*$/.test(t)) positive.add("/" + t);
        }
      }
    }

    for (const n of negative) if (positive.has(n)) negative.delete(n);
    return { positive, negative };
  }

  // files: [{path, text}] -> [{command, workflow, file, description}], sorted by
  // command. A command claimed by several workflows appears once with each workflow
  // listed in `workflows`.
  function extractSlashCommands(files) {
    const byCommand = new Map();
    for (const f of files) {
      if (!f || typeof f.text !== "string") continue;
      if (!COMMENT_EVENTS.test(f.text)) continue;
      const { positive } = findTokens(f.text);
      if (!positive.size) continue;
      const wf = workflowName(f.text) || fileName(f.path).replace(/\.ya?ml$/, "");
      const paras = headerParagraphs(f.text);
      for (const command of positive) {
        const entry = byCommand.get(command) || { command, workflows: [] };
        entry.workflows.push({
          workflow: wf,
          file: fileName(f.path),
          description: describe(f.text, command, paras),
        });
        byCommand.set(command, entry);
      }
    }
    return [...byCommand.values()]
      .map((e) => ({
        command: e.command,
        workflow: e.workflows.map((w) => w.workflow).join(", "),
        file: e.workflows.map((w) => w.file).join(", "),
        description: e.workflows.map((w) => w.description).find(Boolean) || "",
        workflows: e.workflows,
      }))
      .sort((a, b) => a.command.localeCompare(b.command));
  }

  const api = { extractSlashCommands, findTokens, headerParagraphs, workflowName };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.GHSlashParser = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
