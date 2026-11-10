const test = require("node:test");
const assert = require("node:assert/strict");
const { isCommentField } = require("../field.js");

// A stand-in for a textarea. `ancestors` lists the selectors closest() should match.
function textarea({ classes = [], name = "", ariaLabel = null, placeholder = "", ancestors = [], tagName = "TEXTAREA" } = {}) {
  return {
    tagName,
    name,
    placeholder,
    classList: { contains: (c) => classes.includes(c) },
    getAttribute: (a) => (a === "aria-label" ? ariaLabel : null),
    closest: (selector) => (ancestors.some((a) => selector.split(", ").includes(a)) ? {} : null),
  };
}

test("classic comment box", () => {
  assert.equal(isCommentField(textarea({ classes: ["js-comment-field"] })), true);
  assert.equal(isCommentField(textarea({ name: "comment[body]" })), true);
  assert.equal(isCommentField(textarea({ ancestors: ["text-expander"] })), true);
});

test("React editor whose aria-label doesn't mention comments", () => {
  const el = textarea({ ariaLabel: "Markdown value", placeholder: "Use Markdown to format your comment" });
  assert.equal(isCommentField(el), true);
});

test("React editor matched by placeholder alone, with an unrelated aria-label", () => {
  const el = textarea({ ariaLabel: "Body", placeholder: "Leave a comment" });
  assert.equal(isCommentField(el), true);
});

test("React editor matched by its container", () => {
  assert.equal(isCommentField(textarea({ ancestors: ["[class*='MarkdownEditor']"] })), true);
});

test("unrelated fields are ignored", () => {
  assert.equal(isCommentField(textarea({ ariaLabel: "Search", placeholder: "Filter files" })), false);
  assert.equal(isCommentField(textarea({ tagName: "INPUT", classes: ["js-comment-field"] })), false);
  assert.equal(isCommentField(null), false);
});
