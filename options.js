/* SubSell — options page (tabbed). Reads/writes the full settings object
 * in chrome.storage.local. Tables for listings / follow-ups / videos. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);

  const DEFAULTS = {
    enabled: false,
    apiKey: "",
    model: "claude-sonnet-4-6",
    responseDelaySec: 30,
    jitterSec: 60,
    hourlyCap: 30,
    dailyCap: 200,
    wpmMin: 38,
    wpmMax: 78,
    businessHoursEnabled: true,
    businessHoursStart: 9,
    businessHoursEnd: 22,
    businessName: "SubSell",
    businessAddress: "757 Rue Beaubien E, Montréal",
    businessHoursText: "9AM–10PM, 7 days",
    businessInfo:
      "Used iPhone sales in Montreal. Pickup at 757 Rue Beaubien E, Montréal. Cash or e-transfer.",
    instructions:
      "Be friendly and concise. Auto-detect the buyer's language (French or English) and reply in the same language; for French use casual Quebec French. Quote prices from the listings. Never discount more than 10% without flagging a human. If the buyer is rude, scammy, or asking something unusual, return [HUMAN] with a short reason.",
    listings: [],
    followUps: [],
    videos: [],
  };

  let settings = Object.assign({}, DEFAULTS);

  /* ----- tabs ----- */
  document.querySelectorAll(".tab").forEach((t) => {
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
      document.querySelectorAll("section").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      $(t.dataset.tab).classList.add("active");
    });
  });

  /* ----- field bindings (simple inputs) ----- */
  const FIELDS = [
    ["apiKey", "value"],
    ["model", "value"],
    ["responseDelaySec", "number"],
    ["jitterSec", "number"],
    ["hourlyCap", "number"],
    ["dailyCap", "number"],
    ["wpmMin", "number"],
    ["wpmMax", "number"],
    ["businessHoursEnabled", "checked"],
    ["businessHoursStart", "number"],
    ["businessHoursEnd", "number"],
    ["businessName", "value"],
    ["businessAddress", "value"],
    ["businessHoursText", "value"],
    ["businessInfo", "value"],
    ["instructions", "value"],
  ];

  function fieldsToForm() {
    for (const [id, kind] of FIELDS) {
      const el = $(id);
      if (!el) continue;
      if (kind === "checked") el.checked = !!settings[id];
      else el.value = settings[id] != null ? settings[id] : "";
    }
  }
  function formToFields() {
    for (const [id, kind] of FIELDS) {
      const el = $(id);
      if (!el) continue;
      if (kind === "checked") settings[id] = el.checked;
      else if (kind === "number") settings[id] = Number(el.value);
      else settings[id] = el.value;
    }
  }

  /* ----- generic table editor ----- */
  function renderTable(tbodySel, items, cols, onChange) {
    const tbody = document.querySelector(tbodySel);
    tbody.innerHTML = "";
    items.forEach((item, idx) => {
      const tr = document.createElement("tr");
      for (const col of cols) {
        const td = document.createElement("td");
        let input;
        if (col.type === "checkbox") {
          input = document.createElement("input");
          input.type = "checkbox";
          input.checked = item[col.key] !== false;
        } else if (col.type === "textarea") {
          input = document.createElement("textarea");
          input.value = item[col.key] != null ? item[col.key] : "";
        } else {
          input = document.createElement("input");
          input.type = col.type || "text";
          input.value = item[col.key] != null ? item[col.key] : "";
        }
        input.addEventListener("input", () => {
          item[col.key] =
            col.type === "checkbox" ? input.checked : col.type === "number" ? Number(input.value) : input.value;
        });
        input.addEventListener("change", () => {
          item[col.key] = col.type === "checkbox" ? input.checked : input.value;
        });
        td.appendChild(input);
        tr.appendChild(td);
      }
      const tdDel = document.createElement("td");
      const del = document.createElement("button");
      del.textContent = "✕";
      del.className = "danger";
      del.addEventListener("click", () => {
        items.splice(idx, 1);
        onChange();
      });
      tdDel.appendChild(del);
      tr.appendChild(tdDel);
      tbody.appendChild(tr);
    });
  }

  function renderListings() {
    renderTable(
      "#listingsTable tbody",
      settings.listings,
      [
        { key: "title" },
        { key: "model" },
        { key: "storage" },
        { key: "condition" },
        { key: "price", type: "number" },
        { key: "videoUrl" },
        { key: "available", type: "checkbox" },
      ],
      renderListings
    );
  }
  function renderFollowUps() {
    renderTable(
      "#followupsTable tbody",
      settings.followUps,
      [
        { key: "name" },
        { key: "afterMinutes", type: "number" },
        { key: "message", type: "textarea" },
        { key: "enabled", type: "checkbox" },
      ],
      renderFollowUps
    );
  }
  function renderVideos() {
    renderTable(
      "#videosTable tbody",
      settings.videos,
      [{ key: "name" }, { key: "url" }, { key: "notes", type: "textarea" }],
      renderVideos
    );
  }

  $("addListing").addEventListener("click", () => {
    settings.listings.push({ title: "", model: "", storage: "", condition: "", price: 0, videoUrl: "", available: true });
    renderListings();
  });
  $("addFollowUp").addEventListener("click", () => {
    settings.followUps.push({ name: "", afterMinutes: 60, message: "", enabled: true });
    renderFollowUps();
  });
  $("addVideo").addEventListener("click", () => {
    settings.videos.push({ name: "", url: "", notes: "" });
    renderVideos();
  });

  $("exportListings").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(settings.listings, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "subsell-listings.json";
    a.click();
    URL.revokeObjectURL(url);
  });
  $("importListings").addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.addEventListener("change", () => {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (Array.isArray(data)) {
            settings.listings = data;
            renderListings();
          } else alert("Expected a JSON array.");
        } catch (e) {
          alert("Invalid JSON: " + e.message);
        }
      };
      reader.readAsText(file);
    });
    input.click();
  });

  /* ----- test responses ----- */
  $("runTest").addEventListener("click", () => {
    formToFields();
    chrome.storage.local.set({ settings }, () => {
      $("testStatus").textContent = "Calling Claude…";
      chrome.runtime.sendMessage(
        { type: "TEST_REPLY", buyerMessage: $("testInput").value },
        (resp) => {
          if (chrome.runtime.lastError) {
            $("testStatus").textContent = "Error: " + chrome.runtime.lastError.message;
            return;
          }
          if (!resp || !resp.ok) {
            $("testStatus").textContent = "Error: " + (resp && resp.error);
            $("testResult").textContent = "—";
            return;
          }
          $("testStatus").textContent = "Done.";
          const p = resp.parsed;
          let label = "";
          if (p.kind === "human") label = `[HUMAN] ${p.reason}`;
          else if (p.kind === "video") label = `[VIDEO ${p.url}] ${p.caption}`;
          else label = p.text;
          $("testResult").textContent = label + "\n\n— raw —\n" + resp.raw;
        }
      );
    });
  });

  /* ----- save / load ----- */
  function save() {
    formToFields();
    chrome.storage.local.set({ settings }, () => {
      $("savedMsg").textContent = "Saved ✓";
      setTimeout(() => ($("savedMsg").textContent = ""), 1500);
    });
  }
  $("save").addEventListener("click", save);

  function load() {
    chrome.storage.local.get(["settings"], (res) => {
      settings = Object.assign({}, DEFAULTS, res.settings || {});
      // ensure arrays exist
      settings.listings = settings.listings || [];
      settings.followUps = settings.followUps || [];
      settings.videos = settings.videos || [];
      fieldsToForm();
      renderListings();
      renderFollowUps();
      renderVideos();
    });
  }

  load();
})();
