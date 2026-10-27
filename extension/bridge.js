/*
 * AuraBeats Connector — runs on the AuraBeats website only. Passes the
 * page's YouTube requests to the extension and the answers back.
 */
(() => {
  const VERSION = chrome.runtime.getManifest().version;
  const post = (data) => window.postMessage({ source: "aurabeats-ext", version: VERSION, ...data }, location.origin);

  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.source !== "aurabeats-page") return;
    const { type, id, req } = e.data;
    if (type === "hello") post({ type: "hello" });
    else if (type === "request" && id) {
      try {
        chrome.runtime.sendMessage({ kind: "yt-request", req }, (res) => {
          const err = chrome.runtime.lastError;
          post({ type: "response", id, res: err ? { status: 0, body: "", error: err.message } : res });
        });
      } catch (err) {
        // the extension was reloaded / updated: this page needs a reload
        post({ type: "response", id, res: { status: 0, body: "", error: "reload" } });
      }
    }
  });

  post({ type: "hello" });
})();
