const BUZZ = {
  safe: { title: "Safe", voice: "Safe. All clear." },
  careful: { title: "Be careful", voice: "Be careful. Stay alert." },
  alert: { title: "Alert", voice: "Alert. Alert. Attention needed." },
};

const params = new URLSearchParams(location.search);
const state = {
  tab: params.get("tab") === "receive" ? "receive" : "send",
  room: slug(params.get("room") || "main"),
  seen: new Set(),
  clientId: Math.random().toString(36).slice(2, 10),
};

const els = {
  sendPanel: document.getElementById("sendPanel"),
  receivePanel: document.getElementById("receivePanel"),
  tabs: document.querySelectorAll(".tab"),
  roomInput: document.getElementById("roomInput"),
  roomLabel: document.getElementById("roomLabel"),
  connDot: document.getElementById("connDot"),
  unlockBtn: document.getElementById("unlockBtn"),
  lastEvent: document.getElementById("lastEvent"),
  shareBtn: document.getElementById("shareBtn"),
};

const players = {};
let mqttClient = null;
let ntfySource = null;
let channel = null;
let liveFlags = { mqtt: false, ntfy: false };

function slug(value) {
  return String(value || "main").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "main";
}
function topic() { return "buzzer-chopdekar-" + state.room; }
function markLive() {
  const ok = liveFlags.mqtt || liveFlags.ntfy;
  els.connDot.classList.toggle("live", ok);
  els.connDot.classList.toggle("bad", !ok);
}
function setTab(tab) {
  state.tab = tab;
  els.tabs.forEach((btn) => {
    const on = btn.dataset.tab === tab;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-selected", String(on));
  });
  els.sendPanel.classList.toggle("hidden", tab !== "send");
  els.receivePanel.classList.toggle("hidden", tab !== "receive");
  const url = new URL(location.href);
  url.searchParams.set("tab", tab);
  url.searchParams.set("room", state.room);
  history.replaceState({}, "", url);
}
function setRoom(room) {
  state.room = slug(room);
  els.roomInput.value = state.room;
  els.roomLabel.textContent = "room · " + state.room;
  const url = new URL(location.href);
  url.searchParams.set("room", state.room);
  url.searchParams.set("tab", state.tab);
  history.replaceState({}, "", url);
  connect();
}
function getPlayer(id) {
  if (!players[id]) {
    players[id] = new Audio((window.VOICES && window.VOICES[id]) || "");
    players[id].preload = "auto";
  }
  return players[id];
}
async function unlockAudio() {
  try {
    const sample = getPlayer("safe");
    sample.volume = 0.01;
    await sample.play();
    sample.pause();
    sample.currentTime = 0;
    sample.volume = 1;
    els.unlockBtn.textContent = "Sound is on";
    els.unlockBtn.classList.add("ready");
  } catch {
    els.unlockBtn.textContent = "Tap again to enable sound";
  }
}
function speakFallback(id) {
  if (!window.speechSynthesis) return;
  const utter = new SpeechSynthesisUtterance(BUZZ[id].voice);
  utter.rate = id === "alert" ? 1.08 : 0.96;
  utter.pitch = id === "safe" ? 1.08 : id === "alert" ? 0.82 : 1;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}
async function playVoice(id) {
  const clip = getPlayer(id);
  try {
    clip.pause();
    clip.currentTime = 0;
    clip.volume = 1;
    await clip.play();
  } catch {
    speakFallback(id);
  }
}
function flashSend(id) {
  const btn = document.querySelector('.buzzer[data-buzz="' + id + '"]');
  if (!btn) return;
  btn.classList.remove("fired");
  void btn.offsetWidth;
  btn.classList.add("fired");
}
function showReceive(id, when) {
  document.querySelectorAll(".status-card").forEach((card) => {
    const on = card.dataset.status === id;
    card.classList.toggle("on", on);
    const strong = card.querySelector("strong");
    const small = card.querySelector("small");
    if (on) {
      strong.textContent = "Active";
      small.textContent = new Date(when).toLocaleTimeString();
    } else {
      strong.textContent = "Waiting";
    }
  });
  els.lastEvent.textContent = BUZZ[id].title + " received at " + new Date(when).toLocaleTimeString();
}
function handleMessage(raw) {
  let data = raw;
  if (typeof raw === "string") {
    try { data = JSON.parse(raw); } catch { return; }
  }
  if (!data || !BUZZ[data.id]) return;
  const key = data.uid || data.id + "-" + data.t;
  if (state.seen.has(key)) return;
  state.seen.add(key);
  if (data.from === state.clientId) return;
  if (state.tab === "receive") {
    showReceive(data.id, data.t || Date.now());
    playVoice(data.id);
    if (navigator.vibrate) navigator.vibrate(data.id === "alert" ? [90, 40, 90] : 45);
  }
}
function payload(id) {
  return { id: id, t: Date.now(), uid: Math.random().toString(36).slice(2, 10), from: state.clientId };
}
async function sendBuzz(id) {
  flashSend(id);
  const body = payload(id);
  const text = JSON.stringify(body);
  state.seen.add(body.uid);
  if (channel) { try { channel.postMessage(body); } catch (e) {} }
  if (mqttClient && mqttClient.connected) { try { mqttClient.publish(topic(), text); } catch (e) {} }
  try {
    const res = await fetch("https://ntfy.sh/" + topic(), {
      method: "POST",
      headers: { Title: BUZZ[id].title, "Content-Type": "text/plain" },
      body: text,
    });
    liveFlags.ntfy = res.ok;
  } catch (e) {
    liveFlags.ntfy = false;
  }
  markLive();
}
function connectMqtt() {
  if (!window.mqtt) return;
  if (mqttClient) { try { mqttClient.end(true); } catch (e) {} mqttClient = null; }
  liveFlags.mqtt = false;
  mqttClient = window.mqtt.connect("wss://broker.hivemq.com:8884/mqtt", {
    clientId: "buzzer-" + state.clientId,
    clean: true,
    reconnectPeriod: 2000,
  });
  mqttClient.on("connect", function () {
    liveFlags.mqtt = true;
    markLive();
    mqttClient.subscribe(topic());
  });
  mqttClient.on("close", function () { liveFlags.mqtt = false; markLive(); });
  mqttClient.on("message", function (_t, message) { handleMessage(message.toString()); });
}
function connectNtfy() {
  if (ntfySource) { ntfySource.close(); ntfySource = null; }
  ntfySource = new EventSource("https://ntfy.sh/" + topic() + "/sse");
  ntfySource.addEventListener("open", function () { liveFlags.ntfy = true; markLive(); });
  ntfySource.addEventListener("error", function () { liveFlags.ntfy = false; markLive(); });
  ntfySource.addEventListener("message", function (event) {
    try {
      const packet = JSON.parse(event.data);
      if (packet.event !== "message") return;
      handleMessage(packet.message);
    } catch (e) {}
  });
}
function connectLocal() {
  if (channel) { try { channel.close(); } catch (e) {} }
  channel = new BroadcastChannel(topic());
  channel.onmessage = function (event) { handleMessage(event.data); };
}
function connect() {
  connectLocal();
  connectMqtt();
  connectNtfy();
}

els.tabs.forEach(function (btn) { btn.addEventListener("click", function () { setTab(btn.dataset.tab); }); });
document.querySelectorAll(".buzzer").forEach(function (btn) {
  btn.addEventListener("click", function () { sendBuzz(btn.dataset.buzz); });
});
els.unlockBtn.addEventListener("click", unlockAudio);
els.roomInput.addEventListener("change", function () { setRoom(els.roomInput.value); });
els.shareBtn.addEventListener("click", async function () {
  const url = new URL(location.href);
  url.searchParams.set("room", state.room);
  url.searchParams.set("tab", "receive");
  try {
    await navigator.clipboard.writeText(url.toString());
    els.shareBtn.textContent = "Copied";
    setTimeout(function () { els.shareBtn.textContent = "Copy receive link"; }, 1200);
  } catch (e) {
    prompt("Copy this receive link", url.toString());
  }
});

setRoom(state.room);
setTab(state.tab);
