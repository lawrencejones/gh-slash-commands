// Autocomplete popup for workflow slash commands in GitHub comment boxes.
//
// Listens for input on any comment textarea, and when the text before the caret on the
// current line is a lone `/word`, shows the matching commands for this repository. Enter
// or Tab inserts the highlighted command. While the popup is showing, GitHub's own `/`
// menu (code block, table, ...) is hidden so the two don't fight over the arrow keys.
(function () {
  "use strict";

  const fetcher = globalThis.GHSlashFetcher;

  const REPO_PATH = /^\/([^/]+)\/([^/]+)\/(?:pull|issues|discussions)\/\d+/;
  const TOKEN_AT_CARET = /(^|\n)[ \t]*(\/[\w-]*)$/;

  const state = {
    textarea: null,
    query: null, // the `/foo` token currently being completed
    tokenStart: 0,
    tokenEnd: 0,
    items: [],
    selected: 0,
    status: null, // 'loading' | 'error' | null
    commands: null, // cached for the current repo
    repoKey: null,
  };

  // --- Repo and commands -------------------------------------------------------

  function currentRepo() {
    const m = location.pathname.match(REPO_PATH);
    return m ? { owner: m[1], repo: m[2], key: `${m[1]}/${m[2]}` } : null;
  }

  async function ensureCommands(force = false) {
    const r = currentRepo();
    if (!r) return null;
    if (!force && state.commands && state.repoKey === r.key) return state.commands;
    state.repoKey = r.key;
    state.status = "loading";
    try {
      state.commands = await fetcher.getCommands(r.owner, r.repo, { force });
      state.status = null;
    } catch (e) {
      console.warn("[gh-slash]", e);
      state.commands = [];
      state.status = "error";
      state.error = e.message;
    }
    if (state.repoKey !== r.key) return null;
    return state.commands;
  }

  // --- Textarea detection --------------------------------------------------------

  function isCommentField(el) {
    if (!(el instanceof HTMLTextAreaElement)) return false;
    if (el.classList.contains("js-comment-field")) return true;
    if (/\[body\]$/.test(el.name || "")) return true;
    if (el.closest("text-expander, .CommentBox, [data-testid*='comment' i], [class*='CommentBox']")) return true;
    return /comment|reply|review/i.test(el.getAttribute("aria-label") || el.placeholder || "");
  }

  // --- Popup -----------------------------------------------------------------------

  let popup = null;

  function ensurePopup() {
    if (popup) return popup;
    popup = document.createElement("div");
    popup.className = "ghsc-popup";
    popup.setAttribute("role", "listbox");
    popup.hidden = true;
    popup.addEventListener("mousedown", (e) => e.preventDefault()); // keep textarea focus
    popup.addEventListener("click", (e) => {
      const item = e.target.closest(".ghsc-item");
      if (!item) return;
      state.selected = Number(item.dataset.index);
      accept();
    });
    document.body.appendChild(popup);
    return popup;
  }

  function position() {
    if (!popup || !state.textarea) return;
    const rect = state.textarea.getBoundingClientRect();
    const popupHeight = popup.offsetHeight || 200;
    const below = rect.bottom + 4;
    const fitsBelow = below + popupHeight <= window.innerHeight;
    const top = fitsBelow ? below : Math.max(4, rect.top - popupHeight - 4);
    popup.style.top = `${top + window.scrollY}px`;
    popup.style.left = `${rect.left + window.scrollX}px`;
    popup.style.minWidth = `${Math.min(rect.width, 560)}px`;
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function highlight(command, query) {
    const q = query.toLowerCase();
    if (!command.toLowerCase().startsWith(q)) return escapeHTML(command);
    return `<mark>${escapeHTML(command.slice(0, q.length))}</mark>${escapeHTML(command.slice(q.length))}`;
  }

  function render() {
    const el = ensurePopup();
    if (state.status === "loading" && !state.items.length) {
      el.innerHTML = `<div class="ghsc-status">Loading workflow commands…</div>`;
    } else if (state.status === "error" && !state.items.length) {
      el.innerHTML = `<div class="ghsc-status ghsc-error">Couldn't load workflows: ${escapeHTML(state.error || "")}</div>`;
    } else if (!state.items.length) {
      hide();
      return;
    } else {
      el.innerHTML = state.items
        .map(
          (c, i) => `
          <div class="ghsc-item${i === state.selected ? " ghsc-selected" : ""}" role="option" data-index="${i}"
               aria-selected="${i === state.selected}">
            <div class="ghsc-row">
              <span class="ghsc-command">${highlight(c.command, state.query)}</span>
              <span class="ghsc-workflow" title="${escapeHTML(c.file)}">${escapeHTML(c.workflow)}</span>
            </div>
            ${c.description ? `<div class="ghsc-desc">${escapeHTML(c.description)}</div>` : ""}
          </div>`,
        )
        .join("");
      const sel = el.querySelector(".ghsc-selected");
      if (sel) sel.scrollIntoView({ block: "nearest" });
    }
    el.hidden = false;
    suppressGitHubMenu(true);
    position();
  }

  function hide() {
    if (popup) popup.hidden = true;
    state.query = null;
    state.items = [];
    suppressGitHubMenu(false);
  }

  function isOpen() {
    return popup && !popup.hidden && state.query !== null;
  }

  function suppressGitHubMenu(on) {
    const host = state.textarea?.closest("text-expander") || document.body;
    document.querySelectorAll(".ghsc-suppress").forEach((e) => e.classList.remove("ghsc-suppress"));
    if (on) host.classList.add("ghsc-suppress");
  }

  // --- Matching and insertion ------------------------------------------------------

  function filter(commands, query) {
    const q = query.toLowerCase();
    const prefix = [];
    const infix = [];
    for (const c of commands) {
      const name = c.command.toLowerCase();
      if (name.startsWith(q)) prefix.push(c);
      else if (q.length > 1 && name.includes(q.slice(1))) infix.push(c);
    }
    return prefix.concat(infix);
  }

  async function update(textarea) {
    const caret = textarea.selectionStart;
    if (caret !== textarea.selectionEnd) return hide();
    const before = textarea.value.slice(0, caret);
    const m = before.match(TOKEN_AT_CARET);
    if (!m) return hide();

    state.textarea = textarea;
    state.query = m[2];
    state.tokenStart = caret - m[2].length;
    state.tokenEnd = caret;

    let commands = state.commands && state.repoKey === currentRepo()?.key ? state.commands : null;
    if (!commands) {
      state.items = [];
      render();
      commands = await ensureCommands();
      // The user may have moved on while we were loading.
      if (!commands || state.textarea !== textarea || state.query === null) return;
      const again = textarea.value.slice(0, textarea.selectionStart).match(TOKEN_AT_CARET);
      if (!again) return hide();
      state.query = again[2];
      state.tokenStart = textarea.selectionStart - again[2].length;
      state.tokenEnd = textarea.selectionStart;
    }
    const items = filter(commands, state.query);
    if (items.length === 1 && items[0].command === state.query) return hide(); // already complete
    state.items = items;
    state.selected = Math.min(state.selected, Math.max(0, items.length - 1));
    render();
  }

  function setValue(textarea, value) {
    // Go through the prototype setter so React-managed textareas see the change.
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (setter) setter.call(textarea, value);
    else textarea.value = value;
  }

  function accept() {
    const item = state.items[state.selected];
    const ta = state.textarea;
    if (!item || !ta) return hide();
    const value = ta.value;
    const insert = item.command + " ";
    setValue(ta, value.slice(0, state.tokenStart) + insert + value.slice(state.tokenEnd));
    const caret = state.tokenStart + insert.length;
    ta.setSelectionRange(caret, caret);
    hide();
    ta.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: insert }));
    ta.focus();
  }

  // --- Events ------------------------------------------------------------------------

  document.addEventListener(
    "input",
    (e) => {
      const t = e.target;
      if (!isCommentField(t)) return;
      if (!currentRepo()) return;
      update(t);
    },
    true,
  );

  document.addEventListener(
    "keydown",
    (e) => {
      if (!isOpen() || e.target !== state.textarea) return;
      const n = state.items.length;
      switch (e.key) {
        case "ArrowDown":
          if (!n) return;
          state.selected = (state.selected + 1) % n;
          break;
        case "ArrowUp":
          if (!n) return;
          state.selected = (state.selected - 1 + n) % n;
          break;
        case "Enter":
        case "Tab":
          if (!n || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
          e.preventDefault();
          e.stopImmediatePropagation();
          accept();
          return;
        case "Escape":
          e.preventDefault();
          e.stopImmediatePropagation();
          hide();
          return;
        default:
          return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      render();
    },
    true,
  );

  document.addEventListener(
    "keyup",
    (e) => {
      // Caret moved without an input event (arrow left/right, home/end).
      if (!isCommentField(e.target)) return;
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) update(e.target);
    },
    true,
  );

  document.addEventListener("focusout", (e) => {
    if (e.target === state.textarea) setTimeout(() => document.activeElement !== state.textarea && hide(), 100);
  });
  document.addEventListener("mousedown", (e) => {
    if (isOpen() && !popup.contains(e.target) && e.target !== state.textarea) hide();
  });
  window.addEventListener("scroll", () => isOpen() && position(), true);
  window.addEventListener("resize", () => isOpen() && position());

  // Warm the cache when landing on a PR or issue so the first `/` is instant, and again
  // after GitHub's soft navigations.
  function prefetch() {
    if (currentRepo()) ensureCommands();
  }
  prefetch();
  document.addEventListener("turbo:load", prefetch);
  document.addEventListener("pjax:end", prefetch);
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      hide();
      prefetch();
    }
  }, 1000);

  chrome.storage.onChanged.addListener((changes) => {
    // The options page clears the cache; drop our in-memory copy too.
    if (Object.keys(changes).some((k) => k.startsWith("commands:") || k === "token")) {
      state.commands = null;
      prefetch();
    }
  });
})();
