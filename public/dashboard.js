/**
 * dashboard.js — личный кабинет / dashboard
 *
 * Deux visages, un seul fichier :
 *   • reader  — ne voit QUE les messages publiés par la rédaction. La bande
 *     (dépêches + leurs sources) n'est ni demandée ni affichée : /api/dispatches
 *     n'est appelé que par l'admin, donc aucune source de flux ne transite vers
 *     le navigateur d'un lecteur ;
 *   • editor  — rôle administrateur du projet : il gère la bande ET les
 *     messages que les utilisateurs lisent juste au-dessus.
 *
 * Le libellé de rôle ne vient jamais d'une chaîne codée en dur : il passe par
 * OKNO.roleLabel() (dictionnaire RU/EN de i18n.js), comme tout le reste.
 */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const OK = () => window.OKNO || {};
  const T = (key, ...args) => (OK().t ? OK().t(key, ...args) : key);
  const LANG = () => (OK().lang ? OK().lang() : "ru");
  const isAdminUser = (u) => (OK().isAdmin ? OK().isAdmin(u) : !!u && u.role === "editor");
  const roleLabel = (role) => (OK().roleLabel ? OK().roleLabel(role) : String(role || "—"));
  const loc = (field) => (OK().loc ? OK().loc(field) : (field && (field[LANG()] || field.ru || field.en)) || "");

  const ME_URL = "/api/auth/me";
  const MESSAGES_URL = "/api/messages";
  const DISPATCHES_URL = "/api/dispatches";
  const LOGOUT_URL = "/api/auth/logout";

  const RUS_DATE_FMT = "ru-RU";
  const EN_DATE_FMT = "en-GB";
  const MSK_OFFSET = 3; // UTC+3

  const state = {
    user: null,
    admin: false,
    messages: [],
    dispatches: [],
    fluxUpdatedAt: null,
    messagesError: false,
    editingMsgId: null,
    editingFluxId: null,
  };

  /* ——— utilitaires ——— */

  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function fmtDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (!d || Number.isNaN(d.getTime())) return "—";
    const msk = new Date(d.getTime() + MSK_OFFSET * 3600000);
    try {
      return new Intl.DateTimeFormat(LANG() === "en" ? EN_DATE_FMT : RUS_DATE_FMT, {
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
    const mins = Math.floor((Date.now() - d) / 60000);
    if (mins < 1) return T("time.now");
    if (mins < 60) return T("time.min", mins);
    const hours = Math.floor(mins / 60);
    if (hours < 24) return T("time.h", hours);
    return fmtDate(iso);
  }

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value == null || value === "" ? "—" : String(value);
  }

  function setStatus(id, msg, kind) {
    const el = $(id);
    if (!el) return;
    el.textContent = msg || "";
    el.className = "form-status" + (kind ? " " + kind : "");
    if (msg) {
      setTimeout(() => {
        if (el.textContent === msg) {
          el.textContent = "";
          el.className = "form-status";
        }
      }, 6000);
    }
  }

  /** Une réponse API, même quand le serveur renvoie du HTML (page de login, protection d'hébergeur). */
  async function api(url, opts) {
    const res = await fetch(url, opts);
    const json = await res.json().catch(() => null);
    return { res, json };
  }

  /** Message d'erreur lisible, dans la langue de l'utilisateur. */
  function errorFor(json, status) {
    if (status === 401 || (json && json.code === "auth-required")) return T("dash.auth-required");
    if (status === 403 || (json && json.code === "admin-required")) return T("dash.forbidden");
    return (json && json.error) || T("dash.save-error");
  }

  async function send(url, body, method) {
    const { res, json } = await api(url, {
      method: method || "POST",
      headers: { "Content-Type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(body || {}),
    });
    if (!res.ok || !json || json.ok !== true) {
      throw new Error(errorFor(json, res.status));
    }
    return json;
  }

  /* ——— qui est connecté ? ——— */

  async function loadMe() {
    try {
      const { json } = await api(ME_URL);
      if (!json || !json.ok || !json.user) {
        // Session absente ou expirée : direction la connexion.
        window.location.href = "/auth/login.html";
        return false;
      }
      state.user = json.user;
      state.admin = isAdminUser(json.user);
      renderIdentity();
      renderAdminVisibility();
      return true;
    } catch (e) {
      console.error("OKNO me", e);
      window.location.href = "/auth/login.html";
      return false;
    }
  }

  function renderIdentity() {
    const u = state.user || {};
    setText("dash-login", u.login || "—");
    setText("dash-id", u.id || "—");
    setText("dash-created", u.createdAt ? fmtDate(u.createdAt) : "—");
    // Rôle traduit — l'ancienne version écrivait « Редактор » en dur.
    setText("stat-role", roleLabel(u.role));
    const note = $("stat-role-note");
    if (note) note.textContent = state.admin ? T("dash.rights-editor") : T("dash.rights-reader");
  }

  /** Les blocs .admin-only n'existent que pour la rédaction. */
  function renderAdminVisibility() {
    document.querySelectorAll(".admin-only").forEach((el) => {
      el.classList.toggle("is-admin", state.admin);
      el.toggleAttribute("hidden", !state.admin);
    });
  }

  /* ——— messages de la rédaction (les utilisateurs : publiés seulement) ——— */

  async function loadMessages() {
    try {
      const url = MESSAGES_URL + (state.admin ? "?all=1" : "");
      const { res, json } = await api(url);
      if (!res.ok || !json || !Array.isArray(json.items)) throw new Error("messages: " + res.status);
      state.messages = json.items;
      state.messagesError = false;
    } catch (e) {
      console.error("OKNO messages", e);
      state.messages = [];
      state.messagesError = true; // un serveur muet doit se voir
    }
    renderMessages();
    renderMsgAdminList();
    renderMessageStat();
  }

  function visibleMessages() {
    return state.admin ? state.messages : state.messages.filter((m) => m && m.active !== false);
  }

  function renderMessageStat() {
    setText("stat-messages", String(state.messages.filter((m) => m.active !== false).length));
  }

  function renderMessages() {
    const list = $("msg-list");
    const empty = $("msg-empty");
    const items = visibleMessages();
    if (list) list.innerHTML = items.map(messageHtml).join("");
    if (empty) {
      empty.textContent = state.messagesError ? T("dash.network-error") : T("dash.messages-empty");
      empty.className = "dash-empty" + (state.messagesError ? " is-error" : "");
      empty.style.display = items.length ? "none" : "block";
    }
  }

  function messageHtml(m) {
    const title = loc(m.title) || "(—)";
    const body = loc(m.body);
    const draft = m.active === false;
    const stamp = fmtTimeAgo(m.updatedAt || m.createdAt);
    const by = m.author ? T("dash.msg-by", m.author) : "";
    return `<article class="msg-card${draft ? " is-draft" : ""}">
      <p class="msg-head">
        <span class="msg-badge">${esc(stamp)}</span>
        ${draft ? `<span class="msg-badge">${esc(T("dash.msg-draft"))}</span>` : ""}
        ${m.updatedAt ? `<time datetime="${esc(m.updatedAt)}">${esc(fmtDate(m.updatedAt))}</time>` : ""}
      </p>
      <h4 class="msg-title">${esc(title)}</h4>
      ${body ? `<p class="msg-body">${esc(body)}</p>` : ""}
      ${by ? `<p class="msg-by">${esc(by)}</p>` : ""}
    </article>`;
  }

  /* ——— admin : édition des messages ——— */

  function renderMsgAdminList() {
    const list = $("msg-admin-list");
    if (!list || !state.admin) return;
    if (!state.messages.length) {
      list.innerHTML = `<li><span class="al-title">${esc(T("dash.msg-list-empty"))}</span></li>`;
      return;
    }
    list.innerHTML = state.messages
      .map((m) => {
        const title = loc(m.title) || "—";
        const on = m.active !== false;
        return `<li data-id="${esc(m.id)}">
          <span class="al-title">${esc(title)}</span>
          <span class="al-state${on ? "" : " off"}">${esc(on ? fmtDate(m.updatedAt || m.createdAt) : T("dash.msg-draft"))}</span>
          <button type="button" class="btn-mini" data-act="edit">${esc(T("dash.msg-edit"))}</button>
          <button type="button" class="btn-mini" data-act="toggle">${esc(on ? T("dash.msg-unpublish") : T("dash.msg-publish"))}</button>
          <button type="button" class="btn-mini danger" data-act="delete">${esc(T("dash.msg-delete"))}</button>
        </li>`;
      })
      .join("");
  }

  function renderMsgFormHead() {
    const head = $("msg-form-title");
    if (head) head.textContent = state.editingMsgId ? T("dash.msg-form-edit") : T("dash.msg-form-new");
  }

  function fillMsgForm(m) {
    const set = (id, v) => {
      const el = $(id);
      if (el) el.value = v || "";
    };
    const pick = (field, lang) => (field && typeof field === "object" ? String(field[lang] || "") : "");
    set("msg-title-ru", m ? pick(m.title, "ru") : "");
    set("msg-title-en", m ? pick(m.title, "en") : "");
    set("msg-body-ru", m ? pick(m.body, "ru") : "");
    set("msg-body-en", m ? pick(m.body, "en") : "");
    const active = $("msg-active");
    if (active) active.checked = m ? m.active !== false : true;
    state.editingMsgId = m ? m.id : null;
    renderMsgFormHead();
  }

  async function submitMsgForm(ev) {
    ev.preventDefault();
    const val = (id) => ($(id) ? $(id).value.trim() : "");
    const title = { ru: val("msg-title-ru"), en: val("msg-title-en") };
    if (!title.ru && !title.en) {
      setStatus("msg-status", T("dash.msg-need-title"), "err");
      return;
    }
    const btn = $("msg-submit");
    if (btn) btn.disabled = true;
    setStatus("msg-status", T("dash.saving"));
    try {
      await send(MESSAGES_URL, {
        id: state.editingMsgId || undefined,
        title,
        body: { ru: val("msg-body-ru"), en: val("msg-body-en") },
        active: !!($("msg-active") && $("msg-active").checked),
      });
      setStatus("msg-status", T("dash.msg-saved"), "ok");
      fillMsgForm(null);
      await loadMessages();
    } catch (e) {
      setStatus("msg-status", String(e.message || T("dash.save-error")), "err");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function msgListClick(ev) {
    const li = ev.target.closest("li[data-id]");
    const btn = ev.target.closest("button[data-act]");
    if (!li || !btn) return;
    const id = li.getAttribute("data-id");
    const msg = state.messages.find((m) => m.id === id);
    if (!msg) return;
    const act = btn.getAttribute("data-act");
    try {
      if (act === "edit") {
        fillMsgForm(msg);
        const first = $("msg-title-ru");
        if (first) first.focus();
        return;
      }
      if (act === "toggle") {
        await send(MESSAGES_URL, { id, active: msg.active === false });
        setStatus("msg-status", T("dash.msg-saved"), "ok");
      } else if (act === "delete") {
        if (!window.confirm(T("dash.msg-confirm"))) return;
        await send(MESSAGES_URL + "?id=" + encodeURIComponent(id), {}, "DELETE");
        setStatus("msg-status", T("dash.msg-deleted"), "ok");
        if (state.editingMsgId === id) fillMsgForm(null);
      }
      await loadMessages();
    } catch (e) {
      setStatus("msg-status", String(e.message || T("dash.save-error")), "err");
    }
  }

  /* ——— admin : la bande / les flux (sources visibles pour lui seul) ——— */

  async function loadDispatches() {
    if (!state.admin) return; // un lecteur n'a rien à demander ici
    try {
      const { res, json } = await api(DISPATCHES_URL);
      if (!res.ok || !json || !Array.isArray(json.items)) {
        state.dispatches = [];
        state.fluxUpdatedAt = null;
      } else {
        state.dispatches = json.items;
        state.fluxUpdatedAt = json.updatedAt || null;
      }
    } catch (e) {
      console.error("OKNO dispatches", e);
      state.dispatches = [];
      state.fluxUpdatedAt = null;
    }
    renderDispatches();
  }

  function renderDispatches() {
    const tbody = $("disp-body");
    const empty = $("disp-empty");
    setText("disp-updated", state.fluxUpdatedAt ? fmtDate(state.fluxUpdatedAt) : "—");
    setText("disp-count", String(state.dispatches.length));
    if (state.admin) setText("stat-dispatches", String(state.dispatches.length));
    if (!tbody) return;

    if (!state.dispatches.length) {
      tbody.innerHTML = "";
      if (empty) {
        empty.textContent = T("dash.no-dispatches");
        empty.style.display = "block";
      }
      return;
    }
    if (empty) empty.style.display = "none";

    tbody.innerHTML = state.dispatches
      .map((item) => {
        const act = (name, label) =>
          `<button type="button" class="btn-mini${name === "delete" ? " danger" : ""}" data-act="${name}">${esc(label)}</button>`;
        return `<tr data-id="${esc(item.id)}">
          <td class="cat">${esc(item.category || "—")}</td>
          <td class="source">${esc(item.source || "—")}</td>
          <td>${esc(item.title || "—")}</td>
          <td style="white-space:nowrap;color:var(--mute)">${esc(fmtTimeAgo(item.publishedAt))}</td>
          <td style="white-space:nowrap;text-align:right">${act("edit", T("dash.msg-edit"))} ${act("delete", T("dash.msg-delete"))}</td>
        </tr>`;
      })
      .join("");
  }

  function renderFluxFormHead() {
    const head = $("flux-form-title");
    if (head) head.textContent = state.editingFluxId ? T("dash.flux-form-edit") : T("dash.flux-form-new");
    const btn = $("flux-submit");
    if (btn) {
      const label = btn.querySelector("span");
      if (label) label.textContent = state.editingFluxId ? T("dash.flux-update") : T("dash.flux-add");
    }
  }

  function fillFluxForm(item) {
    const set = (id, v) => {
      const el = $(id);
      if (el) el.value = v == null ? "" : String(v);
    };
    set("flux-cat", item ? item.category : "");
    set("flux-source", item ? item.source : "");
    set("flux-title", item ? item.title : "");
    set("flux-summary", item ? item.summary : "");
    set("flux-link", item ? item.link : "");
    set("flux-image", item ? item.image : "");
    state.editingFluxId = item ? item.id : null;
    renderFluxFormHead();
  }

  async function submitFluxForm(ev) {
    ev.preventDefault();
    const val = (id) => ($(id) ? $(id).value.trim() : "");
    if (!val("flux-title")) {
      setStatus("flux-status", T("dash.flux-need-title"), "err");
      return;
    }
    const btn = $("flux-submit");
    if (btn) btn.disabled = true;
    setStatus("flux-status", T("dash.saving"));
    try {
      await send(DISPATCHES_URL, {
        id: state.editingFluxId || undefined,
        category: val("flux-cat"),
        source: val("flux-source"),
        title: val("flux-title"),
        summary: val("flux-summary"),
        link: val("flux-link"),
        image: val("flux-image"),
      });
      setStatus("flux-status", T("dash.flux-saved"), "ok");
      fillFluxForm(null);
      await loadDispatches();
    } catch (e) {
      setStatus("flux-status", String(e.message || T("dash.save-error")), "err");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function fluxRowClick(ev) {
    const tr = ev.target.closest("tr[data-id]");
    const btn = ev.target.closest("button[data-act]");
    if (!tr || !btn) return;
    const id = tr.getAttribute("data-id");
    const item = state.dispatches.find((d) => d.id === id);
    if (!item) return;
    const act = btn.getAttribute("data-act");
    try {
      if (act === "edit") {
        fillFluxForm(item);
        const first = $("flux-title");
        if (first) first.focus();
        return;
      }
      if (act === "delete") {
        if (!window.confirm(T("dash.flux-confirm"))) return;
        await send(DISPATCHES_URL + "?id=" + encodeURIComponent(id), {}, "DELETE");
        setStatus("flux-status", T("dash.flux-deleted"), "ok");
        if (state.editingFluxId === id) fillFluxForm(null);
        await loadDispatches();
      }
    } catch (e) {
      setStatus("flux-status", String(e.message || T("dash.save-error")), "err");
    }
  }

  /* ——— pied de page, langue ——— */

  async function doLogout() {
    try {
      await fetch(LOGOUT_URL, { method: "POST" });
    } catch {}
    window.location.href = "/auth/login.html";
  }

  function bindStatic() {
    const btn = $("dash-logout");
    if (btn) {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        doLogout();
      });
    }
    const msgForm = $("msg-form");
    if (msgForm) msgForm.addEventListener("submit", submitMsgForm);
    const msgReset = $("msg-reset");
    if (msgReset) msgReset.addEventListener("click", () => fillMsgForm(null));
    const msgList = $("msg-admin-list");
    if (msgList) msgList.addEventListener("click", msgListClick);
    const fluxForm = $("flux-form");
    if (fluxForm) fluxForm.addEventListener("submit", submitFluxForm);
    const fluxReset = $("flux-reset");
    if (fluxReset) fluxReset.addEventListener("click", () => fillFluxForm(null));
    const dispBody = $("disp-body");
    if (dispBody) dispBody.addEventListener("click", fluxRowClick);
  }

  /** Changer de langue doit retraduire le rôle, les messages et les tableaux. */
  function bindLang() {
    OK().onLangChange = () => {
      renderIdentity();
      renderMessages();
      renderMsgAdminList();
      renderMessageStat();
      renderMsgFormHead();
      if (state.admin) {
        renderDispatches();
        renderFluxFormHead();
      }
    };
  }

  async function boot() {
    bindStatic();
    bindLang();
    const ok = await loadMe();
    if (!ok) return;
    await Promise.all([loadMessages(), loadDispatches()]);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
