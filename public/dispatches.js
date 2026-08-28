(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const T = (key, ...args) => (window.OKNO && window.OKNO.t ? window.OKNO.t(key, ...args) : key);

  const DISPATCHES_URL = "/api/dispatches";
  const ME_URL = "/api/auth/me";
  const LOGIN_URL = "/auth/login.html";

  const RUS_DATE_FMT = "ru-RU";
  const MSK_OFFSET = 3;

  function fmtTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (!d || Number.isNaN(d.getTime())) return "—";
    const msk = new Date(d.getTime() + MSK_OFFSET * 3600000);
    try {
      return new Intl.DateTimeFormat(RUS_DATE_FMT, {
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

  function fmtTimeShort(iso) {
    if (!iso) return "—";
    const d = Date.parse(iso);
    if (!d || Number.isNaN(d)) return fmtTime(iso);
    const diff = Date.now() - d;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return T("time.now");
    if (mins < 60) return T("time.min", mins);
    const hours = Math.floor(mins / 60);
    if (hours < 24) return T("time.h", hours);
    return fmtTime(iso);
  }

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value || "—";
  }

  function showError(msg) {
    const el = $("disp-empty");
    if (!el) return;
    el.style.display = "block";
    el.textContent = msg || T("disp.no-dispatches");
  }

  function hideError() {
    const el = $("disp-empty");
    if (!el) return;
    el.style.display = "none";
    el.textContent = "";
  }

  // letter from source name (Cyrillic-friendly)
  function letterOf(source) {
    const s = source || "";
    const m = s.match(/[А-Яа-яЁёA-Za-z]/);
    return m ? m[0].toUpperCase() : "О";
  }

  function itemHtml(item) {
    const esc = (s) => String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
    const src = item.source || "";
    const title = item.title || "";
    const cat = item.category || "";
    const time = fmtTimeShort(item.publishedAt);
    const letter = letterOf(src);

    const img = item.image
      ? `<img src="${esc(item.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`
      : "";

    return `<li class="disp-item">
      <div class="thumb" data-source="${esc(src.toLowerCase())}">
        <span class="thumb-ph">${letter}</span>${img}
      </div>
      <div class="body">
        <p class="meta"><span class="source">${esc(src)}</span>${cat ? " · " + esc(cat) : ""}</p>
        <h3>${esc(title)}</h3>
        <p class="time">${time}</p>
      </div>
    </li>`;
  }

  // L'utilisateur de la session, pour que le changement de langue puisse
  // redessiner la pastille sans nouvelle requête réseau.
  let me = null;

  async function loadMe() {
    try {
      const res = await fetch(ME_URL);
      const data = await res.json().catch(() => ({}));
      me = data && data.ok && data.user ? data.user : null;
      renderUserLabel();
    } catch (e) {
      console.error("OKNO me", e);
    }
  }

  // Le rôle passe par le dictionnaire : « reader »/« editor » ne s'affichent
  // jamais en russe figé ni en anglais figé, mais selon la langue choisie.
  function renderUserLabel() {
    const label = $("disp-user-label");
    if (!label) return;
    if (!me) {
      label.textContent = T("disp.guest");
      return;
    }
    const role = (window.OKNO && window.OKNO.roleLabel ? window.OKNO.roleLabel(me.role) : String(me.role || ""));
    label.innerHTML =
      `<span>${escStrict(T("disp.visitor-label"))}</span> <strong style="color:var(--ink)">${escStrict(me.login)}</strong>` +
      ` · <span style="color:var(--gold-soft)">${escStrict(role)}</span>`;
  }

  function escStrict(s) {
    return String(s || "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
  }

  async function loadDispatches() {
    try {
      const res = await fetch(DISPATCHES_URL);
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data || !Array.isArray(data.items)) {
        setText("disp-updated", "—");
        showError(T("disp.no-dispatches"));
        $("disp-list").innerHTML = "";
        return;
      }

      const items = data.items || [];
      setText("disp-updated", fmtTime(data.updatedAt || new Date().toISOString()));

      const list = $("disp-list");
      if (!list) return;

      if (!items.length) {
        hideError();
        showError(T("disp.no-dispatches"));
        return;
      }

      hideError();
      list.innerHTML = items.map(itemHtml).join("");
    } catch (e) {
      console.error("OKNO dispatches", e);
      showError(T("disp.error"));
    }
  }

  function boot() {
    if (window.OKNO) {
      window.OKNO.onLangChange = () => {
        renderUserLabel();
        loadDispatches();
      };
    }
    loadMe();
    loadDispatches();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
