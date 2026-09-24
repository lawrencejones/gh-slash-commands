const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { extractSlashCommands, findTokens } = require("../parser.js");

const names = (cmds) => cmds.map((c) => c.command);

test("startsWith / contains / equality forms", () => {
  const text = `
name: Bot
on:
  issue_comment:
    types: [created]
jobs:
  a:
    if: startsWith(github.event.comment.body, '/gen-api') && github.event.issue.pull_request
  b:
    if: |
      github.event.comment.body == '/ack' ||
      contains(github.event.comment.body,
        "/deploy")
  c:
    if: '/exact' == github.event.comment.body
`;
  assert.deepEqual(names(extractSlashCommands([{ path: "bot.yml", text }])), ["/ack", "/deploy", "/exact", "/gen-api"]);
});

test("negated checks are not attributed to the workflow", () => {
  const text = `
on: issue_comment
jobs:
  a:
    if: contains(github.event.comment.body, '/approve') && !contains(github.event.comment.body, '/approve-bypass')
`;
  assert.deepEqual(names(extractSlashCommands([{ path: "a.yml", text }])), ["/approve"]);
});

test("workflows without a comment trigger are ignored", () => {
  const text = `
on: push
jobs:
  a:
    if: startsWith(github.event.comment.body, '/nope')
`;
  assert.deepEqual(extractSlashCommands([{ path: "a.yml", text }]), []);
});

test("github-script and shell forms", () => {
  const text = `
on: [issue_comment]
jobs:
  a:
    steps:
      - uses: actions/github-script@v7
        with:
          script: |
            const body = context.payload.comment.body;
            if (body.startsWith('/rerun')) {}
      - env:
          COMMENT_BODY: \${{ github.event.comment.body }}
        run: |
          case "$COMMENT_BODY" in
            /retry*) echo retry ;;
          esac
          cat /tmp/not-a-command
`;
  assert.deepEqual(names(extractSlashCommands([{ path: "a.yml", text }])), ["/rerun", "/retry"]);
});

test("slash-command-dispatch commands list", () => {
  const text = `
on:
  issue_comment:
    types: [created]
jobs:
  d:
    steps:
      - uses: peter-evans/slash-command-dispatch@v4
        with:
          commands: |
            deploy
            rebase
          token: x
`;
  assert.deepEqual(names(extractSlashCommands([{ path: "d.yml", text }])), ["/deploy", "/rebase"]);
});

test("description prefers the header paragraph naming the command", () => {
  const text = `---
# Runs make generate-api and commits any changes back.
#
# Comment \`/gen-api\` to trigger a run.
name: Generate API
on:
  issue_comment:
    types: [created]
jobs:
  a:
    if: startsWith(github.event.comment.body, '/gen-api')
`;
  const [cmd] = extractSlashCommands([{ path: "g.yml", text }]);
  assert.equal(cmd.workflow, "Generate API");
  assert.equal(cmd.description, "Comment `/gen-api` to trigger a run.");
});

test("description does not borrow a comment about a longer command", () => {
  const text = `
# Handles /approve. NB /approve-bypass belongs to approve-bot.
on: issue_comment
jobs:
  a:
    if: contains(github.event.comment.body, '/approve')
    steps:
      - run: echo # only /approve-bypass is documented on this line
`;
  const [cmd] = extractSlashCommands([{ path: "a.yml", text }]);
  assert.equal(cmd.command, "/approve");
  assert.equal(cmd.description, "Handles /approve. NB /approve-bypass belongs to approve-bot.");

  const only = `
on: issue_comment
jobs:
  a:
    if: contains(github.event.comment.body, '/approve')
    # /approve-bypass is a different command
`;
  assert.equal(extractSlashCommands([{ path: "b.yml", text: only }])[0].description, "");
});

test("a command owned by two workflows is listed once", () => {
  const a = `on: issue_comment\njobs:\n  a:\n    if: contains(github.event.comment.body, '/x')`;
  const b = `on: issue_comment\njobs:\n  b:\n    if: contains(github.event.comment.body, '/x')`;
  const cmds = extractSlashCommands([
    { path: "a.yml", text: a },
    { path: "b.yml", text: b },
  ]);
  assert.equal(cmds.length, 1);
  assert.equal(cmds[0].workflows.length, 2);
  assert.equal(cmds[0].workflow, "a, b");
});

test("bare slash and paths are not commands", () => {
  const { positive } = findTokens(`on: issue_comment\nif: startsWith(github.event.comment.body, '/')`);
  assert.equal(positive.size, 0);
});

// Optional: run against a real checkout when one is available.
const coreWorkflows = process.env.WORKFLOWS_DIR || path.join(__dirname, "..", "..", "core", ".github", "workflows");
test("real workflows in a sibling checkout", { skip: !fs.existsSync(coreWorkflows) }, () => {
  const files = fs
    .readdirSync(coreWorkflows)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => ({ path: f, text: fs.readFileSync(path.join(coreWorkflows, f), "utf8") }));
  const cmds = extractSlashCommands(files);
  assert.ok(cmds.length > 0, "expected at least one command");
  for (const c of cmds) {
    assert.match(c.command, /^\/[A-Za-z][\w-]*$/);
    assert.ok(c.workflow);
  }
});
