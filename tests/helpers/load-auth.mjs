/**
 * Charge public/auth/auth.js (et sa copie infinityfree) dans un contexte
 * minimaliste qui imite un navigateur : juste assez de DOM, de fetch et de
 * crypto pour exercer le code réel — sans dépendance externe.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "..", "..");

export class El {
  constructor(id) {
    this.id = id;
    this.value = "";
    this.textContent = "";
    this.disabled = false;
    this._classes = new Set();
    this._listeners = {};
    const self = this;
    this.classList = {
      toggle(name, on) {
        if (on) self._classes.add(name);
        else self._classes.delete(name);
        return on;
      },
      add(name) {
        self._classes.add(name);
      },
      remove(name) {
        self._classes.delete(name);
      },
      contains(name) {
        return self._classes.has(name);
      },
    };
  }
  addEventListener(type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  }
  listenerCount(type) {
    return (this._listeners[type] || []).length;
  }
  dispatch(type, event) {
    (this._listeners[type] || []).forEach((fn) => fn(event));
    return event;
  }
}

/**
 * @param {object} opts
 * @param {string[]} opts.ids       identifiants d'éléments présents dans le DOM
 * @param {object}   opts.fetch     implémentation de fetch (reçoit url, options)
 * @param {boolean}  opts.subtle    expose crypto.subtle (contexte sécurisé)
 * @param {boolean}  opts.textEncoder expose TextEncoder
 */
export function loadAuth(opts = {}) {
  const source = opts.source || path.join(REPO_ROOT, "public/auth/auth.js");
  const code = fs.readFileSync(source, "utf8");

  const elements = {};
  (opts.ids || ["auth-form", "auth-error", "auth-submit", "login", "password"]).forEach((id) => {
    elements[id] = new El(id);
  });

  const timers = [];
  const windowObj = { location: { href: "" } };
  const sandbox = {
    window: windowObj,
    document: {
      readyState: opts.readyState || "complete",
      getElementById: (id) => elements[id] || null,
      addEventListener: () => {},
    },
    fetch: opts.fetch || (() => {
      throw new Error("fetch non simulé");
    }),
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimeout: () => {},
    console,
    Uint8Array,
    Uint32Array,
    DataView,
    ArrayBuffer,
    Math,
    JSON,
    Date,
    String,
    Number,
    Boolean,
    Object,
    Array,
    Error,
    Promise,
    RegExp,
    isNaN,
    parseInt,
    parseFloat,
    encodeURIComponent,
    decodeURIComponent,
  };
  if (opts.textEncoder !== false) sandbox.TextEncoder = TextEncoder;
  const cryptoObj = {
    getRandomValues(arr) {
      for (let i = 0; i < arr.length; i++) arr[i] = (i * 37 + 11) & 0xff;
      return arr;
    },
  };
  if (opts.subtle) {
    cryptoObj.subtle = {
      async digest(algo, data) {
        const { createHash } = await import("node:crypto");
        const h = createHash(String(algo).toLowerCase().replace("-", ""));
        h.update(Buffer.from(data));
        return new Uint8Array(h.digest()).buffer;
      },
    };
  }
  sandbox.crypto = cryptoObj;
  windowObj.crypto = cryptoObj;
  windowObj.location = sandbox.window.location;

  const context = vm.createContext(sandbox);
  vm.runInContext(code, context, { filename: source });

  return {
    context,
    window: windowObj,
    elements,
    timers,
    auth: windowObj.OKNO_AUTH,
    ready: windowObj.OKNO_AUTH_READY === true,
    form: elements["auth-form"],
    errorText: () => (elements["auth-error"] ? elements["auth-error"].textContent : null),
    submit(event) {
      const ev = Object.assign({ defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }, event || {});
      return elements["auth-form"].dispatch("submit", ev);
    },
  };
}

/** Réponses fetch programmables : renvoie {calls, impl}. */
export function scriptedFetch(routes) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url: String(url), method: (options && options.method) || "GET", body: options && options.body ? options.body : null, options: options || {} });
    const pathname = String(url).split("?")[0];
    const route = routes.find((r) => r.match === pathname);
    if (!route) return { ok: false, status: 404, text: async () => "<html>not found</html>" };
    const payload = typeof route.response === "function" ? route.response(calls[calls.length - 1]) : route.response;
    const status = route.status || 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof payload === "string" ? payload : JSON.stringify(payload)),
    };
  };
  return { calls, impl, bodyOf(n) { return calls[n] ? JSON.parse(calls[n].body) : null; } };
}
