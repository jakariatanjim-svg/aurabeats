// AuraBeats Connector popup: YouTube sign-in status, then the accounts signed
// in to YouTube in this browser (they load a moment later).
const $ = (id) => document.getElementById(id);
const ADD = "https://accounts.google.com/AddSession?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F";
const SIGN_IN = "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F";

$("ver").textContent = `v${chrome.runtime.getManifest().version}`;

function setStatus(state, text) {
  $("status").dataset.state = state;
  $("status-text").textContent = text;
}

function accountRow(a) {
  const row = document.createElement("div");
  row.className = "acct";
  let pic;
  if (a.photo) {
    pic = document.createElement("img");
    pic.src = a.photo;
    pic.alt = "";
    pic.referrerPolicy = "no-referrer";
  } else {
    pic = document.createElement("i");
    pic.textContent = (a.name || "?").trim().charAt(0).toUpperCase();
  }
  const text = document.createElement("div");
  const name = document.createElement("b");
  name.textContent = a.name || "YouTube account";
  text.append(name);
  if (a.email) {
    const mail = document.createElement("small");
    mail.textContent = a.email;
    text.append(mail);
  }
  row.append(pic, text);
  return row;
}

function signedOut() {
  setStatus("off", "Not signed in to YouTube");
  $("accounts").replaceChildren();
  $("yt").href = SIGN_IN;
  $("yt-text").textContent = "Sign in on YouTube";
}

chrome.runtime.sendMessage({ kind: "status" }, (r) => {
  if (chrome.runtime.lastError || !r || !r.signedIn) return signedOut();
  setStatus("ok", "Connected to YouTube");
  $("yt").href = ADD;
  chrome.runtime.sendMessage({ kind: "accounts" }, (res) => {
    const list = (!chrome.runtime.lastError && res && res.accounts) || [];
    $("accounts").replaceChildren(...list.map(accountRow));
    if (list.length > 1) setStatus("ok", `Connected · ${list.length} accounts`);
  });
});
