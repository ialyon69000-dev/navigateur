(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const T = (key, ...args) => (window.OKNO && window.OKNO.t ? window.OKNO.t(key, ...args) : key);

  const ME_URL = "/api/auth/me";
  const DISPATCHES_URL = "/api/dispatches";
  const LOGOUT_URL = "/api/auth/logout";

  const RUS_DATE_FMT = "ru-RU";
  const EN_DATE_FMT = "en-GB";
  const DATE_FMT = "dd MMMM yyyy, HH:mm";
  const MSK_OFFSET = 3; // UTC+3

  function fmtDate(iso, enLang) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (!d || Number.isNaN(d.getTime())) return "—";
    const msk = new Date(d.getTime() + MSK_OFFSET * 3600000);
    try {
      return new Intl.DateTimeFormat(enLang ? EN_DATE_FMT : RUS_DATE_FMT, {
        day: "2-digit",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Moscow",
      }).format(msk);
    } catch {
      return msk.toLocaleString();
    }
  }

  function fmtTimeAgo(iso) {
    if (!iso) return "—";
    const d = Date.parse(iso);
    if (!d || Number.isNaN(d)) return "—";
    const diff = Date.now() - d;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return T("time.now");
    if (mins < 60) return T("time.min", mins);
    const hours = Math.floor(mins / 60);
    if (hours < 24) return T("time.h", hours);
    return fmtDate(iso, false);
  }

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value || "—";
  }

  function showError(msg) {
    const el = $("disp-empty");
    if (!el) return;
    el.textContent = msg || T("dash.no-dispatches");
    el.style.display = "block";
  }

  function hideError() {
    const el = $("disp-empty");
    if (!el) return;
    el.style.display = "none";
    el.textContent = "";
  }

  async function loadMe() {
    try {
      const res = await fetch(ME_URL);
      const data = await res.json().catch(() => ({}));
      if (!data || !data.ok || !data.user) {
        window.location.href = "/auth/login.html";
        return;
      }
      setText("dash-login", data.user.login || "—");
      setText("dash-id", data.user.id || "—");
      setText("stat-role", data.user.role === "editor" ? "Редактор" : "Читатель");
    } catch (e) {
      console.error("OKNO me", e);
      window.location.href = "/auth/login.html";
    }
  }

  async function loadDispatches() {
    try {
      const res = await fetch(DISPATCHES_URL);
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data || !Array.isArray(data.items)) {
        setText("disp-updated", "—");
        setText("disp-count", "0");
        hideError();
        $("disp-body").innerHTML = "";
        return;
      }

      const items = data.items || [];
      setText("disp-updated", fmtDate(data.updatedAt || new Date().toISOString(), false));
      setText("disp-count", String(items.length));
      setText("stat-dispatches", String(items.length));

      const tbody = $("disp-body");
      if (!tbody) return;

      if (!items.length) {
        hideError();
        tbody.innerHTML = "";
        showError("Нет депешей в архиве.");
        return;
      }

      hideError();

      const rows = items.map((item) => {
        const cat = item.category || T("cell.dash") || "";
        const src = item.source || T("cell.dash");
        const title = item.title || T("cell.dash");
        const time = fmtTimeAgo(item.publishedAt);
        // simple XSS-safe-ish escaping (content is static, created by us)
        const esc = (s) => String(s || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
        return `<tr>
          <td class="cat">${esc(cat)}</td>
          <td class="source">${esc(src)}</td>
          <td>${esc(title)}</td>
          <td style="white-space:nowrap;color:var(--mute)">${time}</td>
        </tr>`;
      }).join("");

      tbody.innerHTML = rows;
    } catch (e) {
      console.error("OKNO dispatches", e);
      showError("Не удалось загрузить депеши.");
    }
  }

  async function doLogout() {
    try {
      await fetch(LOGOUT_URL, { method: "POST" });
    } catch {}
    window.location.href = "/auth/login.html";
  }

  function initLogout() {
    const btn = $("dash-logout");
    if (!btn) return;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      doLogout();
    });
  }

  async function boot() {
    await loadMe();
    initLogout();
    await loadDispatches();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
