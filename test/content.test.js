const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

async function setup({ label = "", placeholder = "", classes = [], name = "", search = "" } = {}) {
  const listeners = new Map();
  const popups = [];
  const inputEvents = [];
  class Textarea {
    constructor() {
      this.value = "/de";
      this.selectionStart = this.selectionEnd = 3;
      this.name = name;
      this.placeholder = placeholder;
      this.classList = { contains: (c) => classes.includes(c) };
    }
    getAttribute(attr) { return attr === "aria-label" ? label : null; }
    closest() { return null; }
    getBoundingClientRect() { return { top: 100, bottom: 200, left: 10, width: 500 }; }
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
    dispatchEvent(event) { inputEvents.push(event); }
    focus() {}
  }
  const document = {
    addEventListener(type, callback) { listeners.set(type, callback); },
    querySelectorAll() { return []; },
    body: {
      appendChild(popup) { popups.push(popup); },
      classList: { add() {}, remove() {} },
    },
    createElement() {
      return {
        style: {},
        setAttribute() {},
        addEventListener() {},
        querySelector() { return null; },
      };
    },
  };
  vm.runInNewContext(source, {
    document,
    HTMLTextAreaElement: Textarea,
    InputEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init); } },
    location: { pathname: "/owner/repo/pull/1", search },
    window: { addEventListener() {}, innerHeight: 1000, scrollX: 0, scrollY: 0 },
    chrome: { storage: { onChanged: { addListener() {} } } },
    GHSlashFetcher: { async getCommands() { return [{ command: "/deploy", workflow: "Deploy", file: "deploy.yml" }]; } },
    setInterval() {},
  });
  // Let the initial workflow prefetch finish before typing.
  await new Promise(setImmediate);
  const textarea = new Textarea();
  return {
    textarea,
    popups,
    inputEvents,
    input() { listeners.get("input")({ target: textarea }); },
    key(key) {
      const event = { target: textarea, key, prevented: false, stopped: false,
        preventDefault() { this.prevented = true; },
        stopImmediatePropagation() { this.stopped = true; },
      };
      listeners.get("keydown")(event);
      return event;
    },
  };
}

for (const [name, attributes, key = "Tab"] of [
  ["legacy comment field", { classes: ["js-comment-field"] }],
  ["legacy body field", { name: "comment[body]" }],
  ["new PR overview", { label: "Markdown value", placeholder: "Add your comment here, be kind", search: "?overview=true" }, "Enter"],
  ["comment label", { label: "Add a reply", placeholder: "Write here" }],
  ["comment placeholder", { placeholder: "Write a review" }],
]) {
  test(`autocomplete and insertion work for ${name}`, async () => {
    const page = await setup(attributes);
    page.input();
    assert.equal(page.popups.length, 1, "typing a slash token should open suggestions");
    const popup = page.popups[0];
    assert.equal(popup.hidden, false);
    assert.match(popup.innerHTML, /Deploy/);
    const event = page.key(key);
    assert.equal(event.prevented, true);
    assert.equal(event.stopped, true);
    assert.equal(page.textarea.value, "/deploy ");
    assert.equal(page.textarea.selectionStart, 8);
    assert.equal(page.textarea.selectionEnd, 8);
    assert.equal(popup.hidden, true);
    assert.equal(page.inputEvents.length, 1);
    assert.equal(page.inputEvents[0].type, "input");
    assert.equal(page.inputEvents[0].bubbles, true);
  });
}

test("unrelated textarea does not open autocomplete", async () => {
  const page = await setup({ label: "Search", placeholder: "Find text" });
  page.input();
  assert.equal(page.popups.length, 0);
});
