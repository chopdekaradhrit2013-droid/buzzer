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
  soundOn: false,
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

let mqttClient = null;
let ntfySource = null;
let channel = null;
let liveFlags = { mqtt: false, ntfy: false };
let audioCtx = null;
let keepAlive = null;
let wakeLock = null;
let alarmTimer = null;

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
  if (tab === "receive") holdAwake();
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

function ensureAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function startKeepAlive() {
  const ctx = ensureAudio();
  if (!ctx || keepAlive) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 20;
  gain.gain.value = 0.0004;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  keepAlive = { osc, gain };
}

async function holdAwake() {
  try {
    if (navigator.wakeLock && state.tab === "receive") {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", function () {
        if (state.tab === "receive" && document.visibilityState === "visible") holdAwake();
      });
    }
  } catch (e) {}
}

async function unlockAudio() {
  try {
    const ctx = ensureAudio();
    if (ctx) await ctx.resume();
    startKeepAlive();
    state.soundOn = true;
    els.unlockBtn.textContent = "Sound + background on";
    els.unlockBtn.classList.add("ready");
    if ("Notification" in window && Notification.permission === "default") {
      await Notification.requestPermission();
    }
    await holdAwake();
    pingTone();
  } catch {
    els.unlockBtn.textContent = "Tap again to enable sound";
  }
}

function pingTone() {
  const ctx = ensureAudio();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = 660;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.18);
}

function beep(freq, start, dur, type, vol) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type || "square";
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(vol || 0.22, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

function playSafeTone() {
  const ctx = ensureAudio();
  if (!ctx) return speakFallback("safe");
  const t = ctx.currentTime;
  beep(523, t, 0.16, "sine", 0.16);
  beep(659, t + 0.14, 0.18, "sine", 0.16);
  beep(784, t + 0.3, 0.28, "sine", 0.18);
}

function playCarefulTone() {
  const ctx = ensureAudio();
  if (!ctx) return speakFallback("careful");
  const t = ctx.currentTime;
  beep(440, t, 0.2, "triangle", 0.18);
  beep(392, t + 0.24, 0.28, "triangle", 0.18);
}

function playAlarmBuzzer() {
  const ctx = ensureAudio();
  if (!ctx) {
    speakFallback("alert");
    return;
  }
  if (alarmTimer) {
    clearInterval(alarmTimer);
    alarmTimer = null;
  }
  const burst = function () {
    const t = ctx.currentTime;
    for (let i = 0; i < 8; i++) {
      const start = t + i * 0.16;
      const hi = i % 2 === 0;
      beep(hi ? 980 : 620, start, 0.12, "square", 0.32);
    }
  };
  burst();
  let n = 0;
  alarmTimer = setInterval(function () {
    n += 1;
    burst();
    if (n >= 3) {
      clearInterval(alarmTimer);
      alarmTimer = null;
    }
  }, 1400);
}

function speakFallback(id) {
  if (!window.speechSynthesis) return;
  const utter = new SpeechSynthesisUtterance(BUZZ[id].voice);
  utter.rate = id === "alert" ? 1.12 : 0.96;
  utter.pitch = id === "alert" ? 0.7 : id === "safe" ? 1.08 : 1;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

async function playVoice(id) {
  ensureAudio();
  if (id === "alert") playAlarmBuzzer();
  else if (id === "safe") playSafeTone();
  else playCarefulTone();
  speakFallback(id);
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

function notify(id) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const title = BUZZ[id].title;
  const body = id === "alert" ? "Alarm buzzer" : BUZZ[id].voice;
  const opts = { body: body, tag: "hangout-buzzer", renotify: true, silent: false };
  if (navigator.serviceWorker && navigator.serviceWorker.ready) {
    navigator.serviceWorker.ready.then(function (reg) {
      try { reg.showNotification(title, opts); } catch (e) {
        try { new Notification(title, opts); } catch (err) {}
      }
    });
  } else {
    try { new Notification(title, opts); } catch (e) {}
  }
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
    notify(data.id);
    if (navigator.vibrate) navigator.vibrate(data.id === "alert" ? [120, 50, 120, 50, 220] : 45);
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
    reconnectPeriod: 1500,
    keepalive: 20,
  });
  mqttClient.on("connect", function () {
    liveFlags.mqtt = true;
    markLive();
    mqttClient.subscribe(topic());
  });
  mqttClient.on("close", function () { liveFlags.mqtt = false; markLive(); });
  mqttClient.on("offline", function () { liveFlags.mqtt = false; markLive(); });
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

document.addEventListener("visibilitychange", function () {
  if (document.visibilityState === "visible") {
    ensureAudio();
    holdAwake();
    if (!liveFlags.mqtt || !liveFlags.ntfy) connect();
  }
});
window.addEventListener("focus", function () {
  ensureAudio();
  if (!liveFlags.mqtt) connectMqtt();
});
setInterval(function () {
  if (state.tab !== "receive") return;
  if (!liveFlags.mqtt) connectMqtt();
  if (!liveFlags.ntfy) connectNtfy();
  if (audioCtx && audioCtx.state === "suspended" && state.soundOn) audioCtx.resume();
}, 8000);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(function () {});
}

setRoom(state.room);
setTab(state.tab);
