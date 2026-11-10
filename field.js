// Decides whether a textarea is a GitHub comment box we should autocomplete in.
//
// Runs both as a content script (attached to globalThis) and under node for the
// tests. It only touches tagName, classList, name, placeholder, getAttribute and
// closest, so the tests can pass plain objects.
//
// GitHub has two comment editors. The classic one marks its textarea with
// `js-comment-field` and wraps it in `<text-expander>`. The React one on the new PR
// pages is Primer's markdown editor: hashed class names, no `<text-expander>`, and an
// aria-label that describes the editor rather than the comment. Match both.
(function (root) {
  "use strict";

  const COMMENT_ANCESTORS = [
    "text-expander",
    ".CommentBox",
    "[data-testid*='comment' i]",
    "[class*='CommentBox']",
    "[class*='MarkdownEditor']",
    "[class*='MarkdownInput']",
  ].join(", ");

  const COMMENT_LABEL = /comment|reply|review|markdown/i;

  function isCommentField(el) {
    if (!el || el.tagName !== "TEXTAREA") return false;
    if (el.classList.contains("js-comment-field")) return true;
    if (/\[body\]$/.test(el.name || "")) return true;
    if (el.closest(COMMENT_ANCESTORS)) return true;
    // Check the aria-label and the placeholder separately: the React editor sets an
    // aria-label that doesn't mention comments, and only its placeholder does.
    return [el.getAttribute("aria-label"), el.placeholder].some((s) => COMMENT_LABEL.test(s || ""));
  }

  const api = { isCommentField, COMMENT_ANCESTORS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.GHSlashField = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
