/*
 * auth.js — connexion / inscription.
 *
 * Deux règles impératives :
 *  1. Le formulaire n'est JAMAIS soumis par le navigateur (pas de GET natif qui
 *     ferait apparaître le mot de passe dans l'URL, l'historique et les logs).
 *  2. Le mot de passe en clair ne quitte jamais le navigateur : on envoie
 *     sha256(mot_de_passe + sel), le sel étant fourni par /api/auth/challenge.
 *
 * Côté serveur (api/auth/*.php ou server.js) on stocke
 *     sha256( sha256(mot_de_passe + sel) + sel )
 * donc ni le mot de passe ni le hash transmis ne sont stockés tels quels.
 */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const T = (key, ...args) => (window.OKNO && window.OKNO.t ? window.OKNO.t(key, ...args) : key);

  /*
   * L'API d'authentification renvoie ses messages d'erreur en russe
   * (« Неверный логин или пароль. »), quelle que soit la langue affichée sur
   * la page. On les traduit donc côté client pour rester cohérent avec le
   * sélecteur RU/EN. Si un message inconnu arrive (version serveur plus récente
   * ou fautive), on le laisse tel quel plutôt que de casser l'affichage.
   */
  const SERVER_ERROR_KEYS = {
    "неверный логин или пароль.": "authapi.err.invalid",
    "заполните логин и пароль.": "authapi.err.missing-fields",
    "укажите логин и пароль.": "authapi.err.register-missing",
    "неверный формат данных входа. обновите страницу (ctrl+f5).": "authapi.err.bad-format-login",
    "неверный формат данных регистрации. обновите страницу (ctrl+f5).": "authapi.err.bad-format-register",
    "неверный формат соли.": "authapi.err.bad-salt",
    "логин от 3 до 40 знаков.": "authapi.err.login-length",
    "этот логин уже занят.": "authapi.err.taken",
  };

  function localizeServerError(msg) {
    if (msg == null) return "";
    const text = String(msg).trim();
    if (!text) return text;
    const key = SERVER_ERROR_KEYS[text.toLowerCase()];
    return key ? T(key) : text;
  }

  const FORM_ID = "auth-form";
  const ERROR_ID = "auth-error";
  const SUBMIT_ID = "auth-submit";
  const DASHBOARD_URL = "/dashboard.html";
  const URLS = {
    challenge: "/api/auth/challenge",
    login: "/api/auth/login",
    register: "/api/auth/register",
    me: "/api/auth/me",
    logout: "/api/auth/logout",
  };

  /* ------------------------------------------------------------------ *
   * SHA-256 — Web Crypto (contexte sécurisé) ou repli JS pur (http://).
   * crypto.subtle n'existe PAS en http simple : sur un hébergement gratuit
   * sans certificat SSL il faut donc l'implémentation de repli.
   * ------------------------------------------------------------------ */

  const SHA256_K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  function utf8Bytes(str) {
    const s = String(str);
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s);
    const out = [];
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        const c2 = s.charCodeAt(i + 1);
        if (c2 >= 0xdc00 && c2 <= 0xdfff) {
          const cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
          out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
          i++;
          continue;
        }
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
    }
    return new Uint8Array(out);
  }

  function rotr(x, n) {
    return ((x >>> n) | (x << (32 - n))) >>> 0;
  }

  function sha256HexJs(message) {
    const msg = utf8Bytes(message);
    const len = msg.length;
    const total = ((((len + 8) >> 6) + 1) << 6) >>> 0;
    const buf = new Uint8Array(total);
    buf.set(msg);
    buf[len] = 0x80;
    const view = new DataView(buf.buffer);
    view.setUint32(total - 8, Math.floor(len / 0x20000000));
    view.setUint32(total - 4, (len << 3) >>> 0);

    const H = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    const w = new Uint32Array(64);

    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const a15 = w[i - 15];
        const a2 = w[i - 2];
        const s0 = (rotr(a15, 7) ^ rotr(a15, 18) ^ (a15 >>> 3)) >>> 0;
        const s1 = (rotr(a2, 17) ^ rotr(a2, 19) ^ (a2 >>> 10)) >>> 0;
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (let i = 0; i < 64; i++) {
        const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
        const ch = ((e & f) ^ (~e & g)) >>> 0;
        const t1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
        const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
        const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        const t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e;
        e = (d + t1) >>> 0;
        d = c; c = b; b = a;
        a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }

    let out = "";
    for (let i = 0; i < 8; i++) {
      const hex = H[i].toString(16);
      out += "00000000".slice(hex.length) + hex;
    }
    return out;
  }

  function toHex(buffer) {
    const bytes = new Uint8Array(buffer);
    let out = "";
    for (let i = 0; i < bytes.length; i++) {
      const hex = bytes[i].toString(16);
      out += (hex.length === 1 ? "0" : "") + hex;
    }
    return out;
  }

  // Toujours asynchrone : Web Crypto quand c'est possible, JS pur sinon.
  async function sha256Hex(message) {
    const subtle = typeof crypto !== "undefined" && crypto.subtle && crypto.subtle.digest;
    if (subtle) {
      try {
        const digest = await crypto.subtle.digest("SHA-256", utf8Bytes(message));
        return toHex(digest);
      } catch (e) {
        /* on retombe sur l'implémentation JS */
      }
    }
    return sha256HexJs(message);
  }

  // Le hash envoyé au serveur : sha256(mot_de_passe + sel), en hexadécimal.
  function hashPassword(password, salt) {
    return sha256Hex(String(password) + String(salt || ""));
  }

  // Sel aléatoire pour l'inscription (crypto.getRandomValues marche aussi en http).
  function randomSalt(bytes) {
    const n = bytes || 8;
    const arr = new Uint8Array(n);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      crypto.getRandomValues(arr);
    } else {
      for (let i = 0; i < n; i++) arr[i] = Math.floor(Math.random() * 256);
    }
    return toHex(arr);
  }

  // Exposé pour les tests automatisés (tests/*.mjs) et le débogage.
  window.OKNO_AUTH = { sha256Hex, sha256HexJs, hashPassword, randomSalt, utf8Bytes };

  /* ------------------------------------------------------------------ *
   * Interface
   * ------------------------------------------------------------------ */

  function errorBox(show, text, kind) {
    const el = $(ERROR_ID);
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("show", !!show);
    el.classList.toggle("ok", !!show && kind === "ok");
  }

  function setSubmitLoading(loading) {
    const btn = $(SUBMIT_ID);
    if (!btn) return;
    btn.disabled = !!loading;
    btn.textContent = loading ? T("auth.loading") : T(isRegisterForm() ? "register.submit" : "auth.submit");
  }

  function isRegisterForm() {
    return !!$("password2");
  }

  /* ------------------------------------------------------------------ *
   * Requêtes réseau — avec diagnostics explicites.
   *
   * InfinityFree (et consort) peut renvoyer une page HTML (challenge
   * anti-bot, page d'erreur 403/500) à la place du JSON : sans test du
   * contenu on aurait un bouton qui ne fait rien, sans message.
   * ------------------------------------------------------------------ */

  // Raison du dernier échec : "network" | "not-json" | "error", et son message.
  let lastFailure = null;
  let lastFailureMessage = "";

  async function request(url, body, opts) {
    const quiet = !!(opts && opts.quiet);
    lastFailure = null;
    lastFailureMessage = "";
    let res;
    try {
      res = await fetch(url, {
        method: body ? "POST" : "GET",
        headers: body ? { "Content-Type": "application/json" } : {},
        credentials: "same-origin",
        body: body ? JSON.stringify(body) : null,
      });
    } catch (err) {
      lastFailure = "network";
      lastFailureMessage = T("auth.network-error");
      if (!quiet) errorBox(true, lastFailureMessage);
      return null;
    }

    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (err) {
      data = null;
    }

    if (!data || typeof data !== "object") {
      lastFailure = "not-json";
      lastFailureMessage = T("auth.not-json") + " (HTTP " + res.status + " — " + url + ")";
      if (!quiet) errorBox(true, lastFailureMessage);
      return null;
    }
    if (!res.ok || data.ok !== true) {
      lastFailure = "error";
      lastFailureMessage = data.error ? localizeServerError(data.error) : T("auth.server-error");
      if (!quiet) errorBox(true, lastFailureMessage);
      return null;
    }
    return data;
  }

  /*
   * /api/auth/login est réécrit vers api/auth/login.php par le .htaccess. Si ce
   * fichier n'a pas été remis à jour sur le serveur, l'URL propre renvoie la
   * page d'erreur 404 en HTML : on réessaie alors directement avec l'extension
   * .php, qui fonctionne toujours. Le choix est mémorisé pour la page.
   */
  let phpSuffix = null;

  // « /api/auth/login?x=1 » → « /api/auth/login.php?x=1 » (extension avant la query).
  function phpUrl(endpoint) {
    const q = endpoint.indexOf("?");
    return q === -1 ? endpoint + ".php" : endpoint.slice(0, q) + ".php" + endpoint.slice(q);
  }

  async function api(endpoint, body) {
    const urls = phpSuffix === true ? [phpUrl(endpoint)] : [endpoint, phpUrl(endpoint)];
    let data = null;
    for (let i = 0; i < urls.length; i++) {
      const isLast = i === urls.length - 1;
      data = await request(urls[i], body, { quiet: !isLast });
      if (data) {
        if (phpSuffix === null) phpSuffix = urls[i] !== endpoint;
        return data;
      }
      if (lastFailure !== "not-json") {
        // Erreur métier (401, 400…) ou réseau : réessayer n'y changerait rien.
        // La tentative était silencieuse, il faut donc afficher le message ici.
        if (!isLast) errorBox(true, lastFailureMessage);
        break;
      }
    }
    return data;
  }

  function getForm() {
    const loginEl = $("login");
    const passEl = $("password");
    const pass2El = $("password2");
    return {
      login: (loginEl && loginEl.value ? loginEl.value : "").trim(),
      password: passEl && passEl.value ? passEl.value : "",
      password2: pass2El && pass2El.value ? pass2El.value : "",
    };
  }

  function fillForm(login, password) {
    const loginEl = $("login");
    const passEl = $("password");
    if (loginEl) loginEl.value = login || "";
    if (passEl) passEl.value = password || "";
  }

  async function doLogin() {
    errorBox(false, "");
    const form = getForm();
    if (!form.login || !form.password) {
      errorBox(true, T("auth.empty-fields"));
      return;
    }
    setSubmitLoading(true);
    try {
      // 1. On récupère le sel du compte (le mot de passe ne bouge pas encore).
      const chal = await api(URLS.challenge + "?login=" + encodeURIComponent(form.login));
      if (!chal) return;
      // 2. On n'envoie que sha256(mot_de_passe + sel).
      const hash = await hashPassword(form.password, chal.salt);
      const data = await api(URLS.login, { login: form.login, hash: hash });
      if (!data) return;
      errorBox(true, T("auth.success"), "ok");
      setTimeout(() => {
        window.location.href = DASHBOARD_URL;
      }, 700);
    } finally {
      setSubmitLoading(false);
    }
  }

  async function doRegister() {
    errorBox(false, "");
    const form = getForm();
    if (!form.login || !form.password || !form.password2) {
      errorBox(true, T("auth.empty-fields"));
      return;
    }
    if (form.password !== form.password2) {
      errorBox(true, T("auth.password-mismatch"));
      return;
    }
    if (form.password.length < 6) {
      errorBox(true, T("auth.password-short"));
      return;
    }
    if (form.login.length < 3) {
      errorBox(true, T("auth.login-short"));
      return;
    }
    setSubmitLoading(true);
    try {
      const salt = randomSalt(8);
      const hash = await hashPassword(form.password, salt);
      const data = await api(URLS.register, { login: form.login, salt: salt, hash: hash });
      if (!data) return;
      if (data.user) {
        fillForm(data.user.login, "");
        errorBox(true, T("register.success"), "ok");
      }
    } finally {
      setSubmitLoading(false);
    }
  }

  function initForm() {
    // NB : $ prend un *id*, sans « # ». Un sélecteur CSS ici renverrait null
    // et aucun gestionnaire ne serait attaché (bug déjà rencontré).
    const form = $(FORM_ID);
    if (!form) return;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (isRegisterForm()) {
        doRegister();
      } else {
        doLogin();
      }
    });
    // Le formulaire HTML refuse de partir tant que ce drapeau n'est pas posé :
    // si le script échoue, rien n'est envoyé (et surtout pas le mot de passe
    // en clair dans l'URL).
    window.OKNO_AUTH_READY = true;
  }

  function boot() {
    initForm();
    if (isRegisterForm()) errorBox(false, "");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
