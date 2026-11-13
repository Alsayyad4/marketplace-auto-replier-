// In-page stand-in for supabase-js: one settings row, Activity rows, a storage that accepts any upload.
(function () {
  const clone = (v) => JSON.parse(JSON.stringify(v));
  let stampN = 0;
  const nextStamp = () => "2026-11-12T12:00:" + String(++stampN).padStart(2, "0") + "+00:00";
  const state = window.__state = {
    row: { config: window.__seedConfig || {}, config_key: "ck", updated_at: nextStamp() },
    writes: 0, uploads: [], feed: window.__seedFeed || [],
  };
  function table(name) {
    const base = {
      _payload: null, _filters: {}, _head: false,
      select(_c, opts) { if (opts && opts.head) base._head = true; return q; },
      eq(col, val) { base._filters[col] = val; return q; },
      update(p) { base._payload = p; return q; }, insert(p) { base._payload = p; return q; },
      maybeSingle: async () => (name === "subsell_configs" ? { data: { config: clone(state.row.config), config_key: state.row.config_key, updated_at: state.row.updated_at }, error: null } : { data: null, error: null }),
      then(res, rej) {
        let out = { data: [], error: null };
        if (name === "subsell_configs" && base._payload) {
          if ("updated_at" in base._filters && base._filters.updated_at !== state.row.updated_at) out = { data: [], error: null };
          else { state.writes++; state.row.config = clone(base._payload.config); state.row.updated_at = nextStamp(); out = { data: [{ updated_at: state.row.updated_at }], error: null }; }
        } else if (name === "subsell_messages") {
          const k = base._filters.kind;
          if (base._head) out = { data: null, count: state.feed.length, error: null };
          else out = { data: k ? [] : clone(state.feed), error: null };
        }
        return Promise.resolve(out).then(res, rej);
      },
    };
    const q = new Proxy(base, { get(t, p) { if (p in t) return t[p]; if (typeof p === "symbol") return undefined; return () => q; } });
    return q;
  }
  window.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session: { user: { id: "u1", email: "owner@example" } } } }), onAuthStateChange() {}, signInWithPassword: async () => ({}), signOut: async () => ({}) },
      from: table,
      storage: { from: () => ({
        list: async () => ({ data: [], error: null }),
        upload: async (path, file) => { state.uploads.push({ path, name: file && file.name, size: file && file.size }); return { data: { path }, error: null }; },
        getPublicUrl: (path) => ({ data: { publicUrl: "https://example.supabase.co/storage/v1/object/public/subsell-videos/" + path } }),
      }) },
    }),
  };
})();
