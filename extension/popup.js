chrome.runtime.sendMessage({ kind: "status" }, (r) => {
  const el = document.getElementById("status");
  if (r && r.signedIn) {
    el.textContent = "Signed in to YouTube ✓";
    el.className = "status ok";
  } else {
    el.textContent = "Not signed in to YouTube in this browser";
    el.className = "status warn";
    document.getElementById("yt").hidden = false;
  }
});
