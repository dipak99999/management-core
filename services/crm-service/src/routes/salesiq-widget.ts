import { Router, type Request, type Response } from "express";

// Serves the SalesIQ embeddable widget as a self-contained bundle. A website
// drops this on any page:
//   <script src="http://localhost:4104/siq/widget.js?tenant=demo" defer></script>
//
// The script renders a floating chat bubble bottom-right (or left, per
// widget settings), identifies the visitor, tracks the page view, and
// exposes a chat panel that polls /siq/public/messages.
//
// Kept as one file so the widget has zero build step. Ships CSS + HTML +
// JS as one string, with `${…}` interpolation for the origin so the same
// bundle works whether crm-service is on :4104 (dev) or a real domain
// (prod).

export const salesiqWidgetRouter = Router();

salesiqWidgetRouter.get("/widget.js", (req: Request, res: Response) => {
  const tenantSlug = String(req.query.tenant ?? "");
  const origin = `${req.protocol}://${req.get("host")}`;
  const js = renderWidget({ tenantSlug, origin });
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.send(js);
});

// Simple standalone HTML demo page so you can see the widget without
// dropping it into a real site. Visit
// http://localhost:4104/siq/demo?tenant=demo
salesiqWidgetRouter.get("/demo", (req: Request, res: Response) => {
  const tenantSlug = String(req.query.tenant ?? "demo");
  const origin = `${req.protocol}://${req.get("host")}`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Lumaara SalesIQ demo</title>
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 720px; margin: 60px auto; padding: 20px; line-height: 1.6; color: #1c1917; }
    h1 { background: linear-gradient(135deg, #7C3AED, #F59E0B); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
    code { background: #f5f5f4; padding: 2px 6px; border-radius: 4px; font-family: SF Mono, monospace; font-size: 13px; }
  </style>
</head>
<body>
  <h1>Widget demo — tenant: ${tenantSlug}</h1>
  <p>The chat bubble should appear in the corner. Click it to start a chat.</p>
  <p>Drop this on any site:</p>
  <code>&lt;script src="${origin}/siq/widget.js?tenant=${tenantSlug}" defer&gt;&lt;/script&gt;</code>
  <p>Operators log in at <a href="http://localhost:3100/crm/salesiq/inbox">/crm/salesiq/inbox</a> to reply.</p>
  <script src="${origin}/siq/widget.js?tenant=${tenantSlug}" defer></script>
</body>
</html>`);
});

function renderWidget({ tenantSlug, origin }: { tenantSlug: string; origin: string }): string {
  return `(function() {
  if (window.__lumaaraSiqLoaded) return;
  window.__lumaaraSiqLoaded = true;

  const TENANT = ${JSON.stringify(tenantSlug)};
  const ORIGIN = ${JSON.stringify(origin)};
  const STORAGE_KEY = "lumaara.siq." + TENANT;
  const POLL_MS = 3000;

  // ── State ───────────────────────────────────────────────────────────
  let state = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  if (!state.fingerprint) {
    state.fingerprint = "fp_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    save();
  }
  let open = false;
  let messages = [];
  let lastMsgId = "";
  let pollTimer = null;
  let settings = { brandName: "Support", greeting: "Hi! How can we help?", primaryColor: "#7C3AED" };

  function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

  // ── API helpers ─────────────────────────────────────────────────────
  async function api(path, body, method) {
    const opts = { method: method || (body ? "POST" : "GET"), headers: {} };
    if (body !== undefined) {
      opts.headers["content-type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(ORIGIN + path, opts);
    if (!r.ok) throw new Error("api " + path + " -> " + r.status);
    return r.json();
  }

  // ── Boot: identify + track page + fetch settings ─────────────────────
  async function boot() {
    try {
      const s = await api("/siq/public/settings?tenantSlug=" + encodeURIComponent(TENANT));
      Object.assign(settings, s);
      renderWidget();
    } catch (e) { /* silent */ }
    try {
      await api("/siq/public/identify", {
        tenantSlug: TENANT,
        fingerprint: state.fingerprint,
        userAgent: navigator.userAgent,
        referrer: document.referrer || undefined,
        currentUrl: location.href,
      });
      await api("/siq/public/track-page", {
        tenantSlug: TENANT,
        fingerprint: state.fingerprint,
        url: location.href,
        title: document.title,
      });
    } catch (e) { /* silent */ }
    if (state.sessionId) startPolling();
  }

  // ── DOM ─────────────────────────────────────────────────────────────
  const root = document.createElement("div");
  root.id = "lumaara-siq-root";
  document.body.appendChild(root);

  const style = document.createElement("style");
  style.textContent = \`
    #lumaara-siq-root { position: fixed; z-index: 2147483647; bottom: 20px; right: 20px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1c1917; }
    .lsiq-bubble { width: 56px; height: 56px; border-radius: 50%;
      background: linear-gradient(135deg, var(--lsiq-color, #7C3AED), #A78BFA);
      color: white; display: grid; place-items: center; cursor: pointer;
      box-shadow: 0 12px 32px -8px rgba(124, 58, 237, 0.5);
      transition: transform 0.15s ease; }
    .lsiq-bubble:hover { transform: scale(1.05); }
    .lsiq-bubble svg { width: 26px; height: 26px; }
    .lsiq-panel { width: 360px; height: 500px; max-height: 80vh; background: white;
      border-radius: 16px; box-shadow: 0 24px 64px -16px rgba(0, 0, 0, 0.25);
      display: none; flex-direction: column; overflow: hidden; margin-bottom: 12px; }
    .lsiq-panel.open { display: flex; }
    .lsiq-head { background: linear-gradient(135deg, var(--lsiq-color, #7C3AED), #A78BFA);
      color: white; padding: 16px; display: flex; align-items: center; gap: 10px; }
    .lsiq-head-icon { width: 32px; height: 32px; border-radius: 50%; background: rgba(255,255,255,0.2);
      display: grid; place-items: center; font-weight: 700; }
    .lsiq-head-text { flex: 1; }
    .lsiq-head-name { font-weight: 600; }
    .lsiq-head-status { font-size: 12px; opacity: 0.85; }
    .lsiq-close { background: none; border: 0; color: white; cursor: pointer; padding: 4px;
      opacity: 0.85; }
    .lsiq-close:hover { opacity: 1; }
    .lsiq-body { flex: 1; padding: 14px; overflow-y: auto; background: #fafaf9;
      display: flex; flex-direction: column; gap: 10px; }
    .lsiq-msg { max-width: 78%; padding: 8px 12px; border-radius: 12px; font-size: 14px;
      line-height: 1.4; white-space: pre-wrap; word-wrap: break-word; }
    .lsiq-msg.you { align-self: flex-end; background: var(--lsiq-color, #7C3AED); color: white; border-bottom-right-radius: 4px; }
    .lsiq-msg.them { align-self: flex-start; background: white; color: #1c1917; border: 1px solid #e7e5e4; border-bottom-left-radius: 4px; }
    .lsiq-msg.sys { align-self: center; background: transparent; color: #78716c; font-size: 12px; }
    .lsiq-form { padding: 12px; border-top: 1px solid #e7e5e4; background: white;
      display: flex; gap: 8px; }
    .lsiq-form input, .lsiq-form textarea { flex: 1; padding: 10px 12px; border: 1px solid #d6d3d1;
      border-radius: 10px; font-size: 14px; outline: none; font-family: inherit; }
    .lsiq-form input:focus, .lsiq-form textarea:focus { border-color: var(--lsiq-color, #7C3AED); }
    .lsiq-form button { padding: 10px 14px; border: 0; border-radius: 10px; cursor: pointer;
      background: var(--lsiq-color, #7C3AED); color: white; font-weight: 500; }
    .lsiq-precomm { padding: 20px 18px; background: #fafaf9; }
    .lsiq-precomm-title { font-size: 15px; font-weight: 600; margin-bottom: 8px; }
    .lsiq-precomm-sub { font-size: 13px; color: #78716c; margin-bottom: 16px; }
    .lsiq-precomm input { width: 100%; padding: 10px 12px; border: 1px solid #d6d3d1;
      border-radius: 10px; font-size: 14px; margin-bottom: 10px; outline: none; }
    .lsiq-precomm input:focus { border-color: var(--lsiq-color, #7C3AED); }
    .lsiq-precomm button { width: 100%; padding: 10px; border: 0; border-radius: 10px;
      background: var(--lsiq-color, #7C3AED); color: white; font-weight: 500; cursor: pointer; }
  \`;
  document.head.appendChild(style);

  function renderWidget() {
    root.style.setProperty("--lsiq-color", settings.primaryColor || "#7C3AED");
    root.innerHTML =
      panelHtml() +
      '<div class="lsiq-bubble" id="lsiq-bubble" title="' + settings.brandName + '">' +
        '<svg viewBox="0 0 24 24" fill="none"><path d="M4 4h16v12H8l-4 4V4z" stroke="white" stroke-width="2" stroke-linejoin="round"/></svg>' +
      '</div>';
    document.getElementById("lsiq-bubble").onclick = toggle;
    if (open) attachPanelHandlers();
  }

  function panelHtml() {
    if (!open) return "";
    if (!state.sessionId) {
      return '<div class="lsiq-panel open" id="lsiq-panel">'
        + head()
        + '<div class="lsiq-precomm">'
        + '<div class="lsiq-precomm-title">' + settings.greeting + '</div>'
        + '<div class="lsiq-precomm-sub">Tell us what\\'s on your mind and we\\'ll get right back.</div>'
        + '<input id="lsiq-name" placeholder="Your name (optional)" />'
        + '<input id="lsiq-email" placeholder="Your email (optional)" />'
        + '<textarea id="lsiq-msg" placeholder="How can we help?" rows="4" style="width:100%;padding:10px 12px;border:1px solid #d6d3d1;border-radius:10px;font-size:14px;margin-bottom:10px;font-family:inherit;outline:none;"></textarea>'
        + '<button id="lsiq-send">Start chat</button>'
        + '</div>'
        + '</div>';
    }
    return '<div class="lsiq-panel open" id="lsiq-panel">'
      + head()
      + '<div class="lsiq-body" id="lsiq-body">' + messagesHtml() + '</div>'
      + '<div class="lsiq-form"><input id="lsiq-reply" placeholder="Type a message…" /><button id="lsiq-send-reply">Send</button></div>'
      + '</div>';
  }

  function head() {
    return '<div class="lsiq-head">'
      + '<div class="lsiq-head-icon">' + (settings.brandName || "S")[0].toUpperCase() + '</div>'
      + '<div class="lsiq-head-text"><div class="lsiq-head-name">' + escapeHtml(settings.brandName) + '</div><div class="lsiq-head-status">Typically replies within an hour</div></div>'
      + '<button class="lsiq-close" id="lsiq-close">✕</button>'
      + '</div>';
  }

  function messagesHtml() {
    return messages
      .map((m) => {
        const cls = m.sender === "Visitor" ? "you" : m.sender === "System" ? "sys" : "them";
        return '<div class="lsiq-msg ' + cls + '">' + escapeHtml(m.body) + '</div>';
      })
      .join("");
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function attachPanelHandlers() {
    const close = document.getElementById("lsiq-close");
    if (close) close.onclick = toggle;
    const send = document.getElementById("lsiq-send");
    if (send) send.onclick = startChat;
    const sendReply = document.getElementById("lsiq-send-reply");
    if (sendReply) sendReply.onclick = sendMessage;
    const replyInput = document.getElementById("lsiq-reply");
    if (replyInput) {
      replyInput.onkeydown = function (e) { if (e.key === "Enter") sendMessage(); };
      setTimeout(function () { replyInput.focus(); }, 50);
    }
    scrollBody();
  }

  function scrollBody() {
    const b = document.getElementById("lsiq-body");
    if (b) b.scrollTop = b.scrollHeight;
  }

  function toggle() {
    open = !open;
    renderWidget();
    if (open) {
      attachPanelHandlers();
      if (state.sessionId) refresh();
    }
  }

  async function startChat() {
    const name = (document.getElementById("lsiq-name") || {}).value || "";
    const email = (document.getElementById("lsiq-email") || {}).value || "";
    const msg = (document.getElementById("lsiq-msg") || {}).value || "";
    if (!msg.trim()) return;
    try {
      const res = await api("/siq/public/start-chat", {
        tenantSlug: TENANT,
        fingerprint: state.fingerprint,
        message: msg.trim(),
        name: name.trim() || undefined,
        email: email.trim() || undefined,
      });
      state.sessionId = res.sessionId;
      save();
      messages = res.messages;
      renderWidget();
      attachPanelHandlers();
      startPolling();
    } catch (e) {
      alert("Failed to start chat");
    }
  }

  async function sendMessage() {
    const input = document.getElementById("lsiq-reply");
    if (!input) return;
    const body = (input.value || "").trim();
    if (!body) return;
    input.value = "";
    try {
      const m = await api("/siq/public/messages", { sessionId: state.sessionId, message: body });
      messages.push(m);
      lastMsgId = m.id;
      renderWidget();
      attachPanelHandlers();
    } catch (e) {
      alert("Send failed");
    }
  }

  async function refresh() {
    try {
      const url = "/siq/public/messages?sessionId=" + encodeURIComponent(state.sessionId) + (lastMsgId ? "&after=" + lastMsgId : "");
      const rows = await api(url);
      if (rows.length > 0) {
        for (const r of rows) {
          if (!messages.find((m) => m.id === r.id)) messages.push(r);
        }
        lastMsgId = rows[rows.length - 1].id;
        if (open) {
          renderWidget();
          attachPanelHandlers();
        }
      }
    } catch (e) { /* silent */ }
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(refresh, POLL_MS);
  }

  renderWidget();
  boot();
})();
`;
}
