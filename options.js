(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  function setStatus(msg) {
    $("status").textContent = msg;
    setTimeout(() => ($("status").textContent = ""), 2500);
  }

  function renderCached(all) {
    const ul = $("cached");
    ul.innerHTML = "";
    const keys = Object.keys(all).filter((k) => k.startsWith("commands:"));
    if (!keys.length) {
      ul.innerHTML = "<li>None yet. Open a pull request and type <code>/</code> in a comment.</li>";
      return;
    }
    for (const k of keys.sort()) {
      const { fetchedAt, commands } = all[k];
      const li = document.createElement("li");
      const names = commands.map((c) => c.command).join(" ");
      li.innerHTML = `<code>${k.slice("commands:".length)}</code> — ${commands.length} command${
        commands.length === 1 ? "" : "s"
      }, fetched ${new Date(fetchedAt).toLocaleString()}<br /><span style="color:#656d76">${names}</span>`;
      ul.appendChild(li);
    }
  }

  function load() {
    chrome.storage.local.get(null, (all) => {
      $("token").value = all.token || "";
      $("ttl").value = all.ttlHours || 6;
      renderCached(all);
    });
  }

  $("save").addEventListener("click", () => {
    chrome.storage.local.set(
      { token: $("token").value.trim(), ttlHours: Math.max(1, Number($("ttl").value) || 6) },
      () => setStatus("Saved"),
    );
  });

  $("clear").addEventListener("click", () => {
    chrome.storage.local.get(null, (all) => {
      const keys = Object.keys(all).filter((k) => k.startsWith("commands:"));
      chrome.storage.local.remove(keys, () => {
        setStatus(`Cleared ${keys.length} cached repositor${keys.length === 1 ? "y" : "ies"}`);
        load();
      });
    });
  });

  load();
})();
