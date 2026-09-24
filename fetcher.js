// Loads a repository's workflow files and returns the slash commands they respond to,
// cached in chrome.storage.local per repository.
//
// Runs inside the content script, so requests to github.com are same-origin and carry
// the user's session cookie: private repos work with no token. The GitHub REST API is
// only a fallback, used if the same-origin routes change shape, and needs a token for
// private repositories (set on the options page).
(function (root) {
  "use strict";

  const WORKFLOWS_DIR = ".github/workflows";
  const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

  function storageGet(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  }

  function storageSet(obj) {
    return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
  }

  async function settings() {
    const s = await storageGet({ token: "", ttlHours: 6 });
    const ttl = Number(s.ttlHours);
    return { token: s.token || "", ttlMs: ttl > 0 ? ttl * 60 * 60 * 1000 : DEFAULT_TTL_MS };
  }

  // Depth-first search for the first object that has a `tree.items` array. GitHub
  // nests the tree payload under a route key that has changed name before, so we don't
  // pin the path.
  function findTreeItems(node, depth = 0) {
    if (!node || typeof node !== "object" || depth > 8) return null;
    if (Array.isArray(node.tree?.items)) return node.tree.items;
    for (const v of Object.values(node)) {
      const found = findTreeItems(v, depth + 1);
      if (found) return found;
    }
    return null;
  }

  function isWorkflowFile(name) {
    return /\.ya?ml$/i.test(name);
  }

  async function listViaTreeJSON(owner, repo) {
    const res = await fetch(`/${owner}/${repo}/tree/HEAD/${WORKFLOWS_DIR}`, {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    });
    if (!res.ok) throw new Error(`tree json ${res.status}`);
    const json = await res.json();
    const items = findTreeItems(json);
    if (!items) throw new Error("tree json: no items");
    return items.filter((i) => i.contentType === "file" && isWorkflowFile(i.name)).map((i) => i.name);
  }

  async function listViaTreeHTML(owner, repo) {
    const res = await fetch(`/${owner}/${repo}/tree/HEAD/${WORKFLOWS_DIR}`, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`tree html ${res.status}`);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const script = doc.querySelector('script[data-target="react-app.embeddedData"]');
    if (!script) throw new Error("tree html: no embedded data");
    const items = findTreeItems(JSON.parse(script.textContent));
    if (!items) throw new Error("tree html: no items");
    return items.filter((i) => i.contentType === "file" && isWorkflowFile(i.name)).map((i) => i.name);
  }

  async function listViaAPI(owner, repo, token) {
    const headers = { Accept: "application/vnd.github+json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${WORKFLOWS_DIR}`, { headers });
    if (!res.ok) throw new Error(`api ${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json)) throw new Error("api: not a directory");
    return json.filter((i) => i.type === "file" && isWorkflowFile(i.name)).map((i) => i.name);
  }

  async function fetchRaw(owner, repo, name, token) {
    const res = await fetch(`/${owner}/${repo}/raw/HEAD/${WORKFLOWS_DIR}/${name}`, { credentials: "same-origin" });
    if (res.ok) return res.text();
    const headers = { Accept: "application/vnd.github.raw+json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const api = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${WORKFLOWS_DIR}/${name}`, {
      headers,
    });
    if (!api.ok) throw new Error(`raw ${name}: ${res.status} / api ${api.status}`);
    return api.text();
  }

  async function listWorkflows(owner, repo, token) {
    const errors = [];
    for (const attempt of [listViaTreeJSON, listViaTreeHTML, (o, r) => listViaAPI(o, r, token)]) {
      try {
        return await attempt(owner, repo);
      } catch (e) {
        errors.push(e.message);
      }
    }
    throw new Error(`could not list workflows: ${errors.join("; ")}`);
  }

  async function loadFresh(owner, repo) {
    const { token } = await settings();
    const names = await listWorkflows(owner, repo, token);
    const files = await Promise.all(
      names.map(async (name) => {
        try {
          return { path: name, text: await fetchRaw(owner, repo, name, token) };
        } catch (e) {
          console.warn("[gh-slash] skipping", name, e.message);
          return null;
        }
      }),
    );
    return root.GHSlashParser.extractSlashCommands(files.filter(Boolean));
  }

  const inflight = new Map();

  // Returns the cached command list for owner/repo, refreshing it when older than the
  // TTL. Concurrent callers on the same page share one request.
  async function getCommands(owner, repo, { force = false } = {}) {
    const key = `commands:${owner}/${repo}`;
    const { ttlMs } = await settings();
    if (!force) {
      const cached = (await storageGet(key))[key];
      if (cached && Date.now() - cached.fetchedAt < ttlMs) return cached.commands;
    }
    if (inflight.has(key)) return inflight.get(key);
    const p = loadFresh(owner, repo)
      .then(async (commands) => {
        await storageSet({ [key]: { fetchedAt: Date.now(), commands } });
        return commands;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  root.GHSlashFetcher = { getCommands };
})(globalThis);
