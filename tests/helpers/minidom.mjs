/**
 * minidom.mjs — un DOM de quelques centaines de lignes, juste assez pour exécuter
 * les scripts de page réels (i18n.js + dashboard.js / dispatches.js) dans un
 * contexte Node. Objectif : vérifier le rendu conditionnel au rôle et la
 * traduction des libellés, sans dépendance externe (même esprit que
 * helpers/load-auth.mjs).
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { REPO_ROOT } from "./load-auth.mjs";

export { REPO_ROOT };

export class El {
  constructor(id, classes) {
    this.id = id;
    this.tagName = "DIV";
    this.dataset = {};
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.textContent = "";
    this.innerHTML = "";
    this.alt = "";
    this._classes = new Set(classes || []);
    this._listeners = {};
    this._attrs = {};
    this._kids = {};
    this._children = [];
    const self = this;
    this.style = { setProperty() {} };
    this.classList = {
      toggle(name, on) {
        const want = on === undefined ? !self._classes.has(name) : !!on;
        if (want) self._classes.add(name);
        else self._classes.delete(name);
        return want;
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

  setAttribute(k, v) {
    this._attrs[k] = String(v);
  }
  getAttribute(k) {
    return k in this._attrs ? this._attrs[k] : null;
  }
  hasAttribute(k) {
    return k in this._attrs;
  }
  toggleAttribute(name, force) {
    const want = force === undefined ? !(name in this._attrs) : !!force;
    if (want) this._attrs[name] = "";
    else delete this._attrs[name];
    return want;
  }
  addEventListener(type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  }
  listenerCount(type) {
    return (this._listeners[type] || []).length;
  }
  dispatch(type, event) {
    const ev = Object.assign(
      { target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } },
      event || {}
    );
    (this._listeners[type] || []).forEach((fn) => fn(ev));
    return ev;
  }
  querySelector(sel) {
    if (!this._kids[sel]) {
      const kid = new El(`${this.id} > ${sel}`);
      kid.parentNode = this;
      this._kids[sel] = kid;
    }
    return this._kids[sel];
  }
  querySelectorAll(sel) {
    return this._children.concat(Object.values(this._kids)).filter((c) => c._matchesSel(sel));
  }
  // ".admin-only" → classe, "[data-i18n]" → dataset/attribut, "span" → balise
  _matchesSel(sel) {
    const key = sel.replace(/[[\]"]/g, "").replace(/^\./, "");
    if (sel.startsWith(".")) return this._classes.has(key);
    if (sel.startsWith("[")) {
      const attr = key.replace(/^data-/, "").replace(/-([a-z])/g, (m, c) => c.toUpperCase());
      return this.dataset[attr] !== undefined || key in this._attrs;
    }
    return this.tagName === sel.toUpperCase();
  }
  closest() {
    return null;
  }
  appendChild(node) {
    this._children.push(node);
    node.parentNode = this;
    return node;
  }
  focus() {}
  remove() {}
}

function nodes(roots) {
  const out = [];
  const seen = new Set();
  const walk = (e) => {
    if (!e || seen.has(e)) return;
    seen.add(e);
    out.push(e);
    Object.values(e._kids || {}).forEach(walk);
    (e._children || []).forEach(walk);
  };
  roots.forEach(walk);
  return out;
}

/**
 * @param {object} opts
 * @param {string} opts.i18n          chemin du dictionnaire (relatif à la racine)
 * @param {string[]} opts.scripts      chemins des scripts de page, dans l'ordre
 * @param {Record<string,string[]>} opts.classes  id → classes statiques
 * @param {string} opts.lang          langue initiale ("ru" | "en")
 * @param {object} opts.routes        pathname → réponse (ou fn(options) → réponse)
 * @param {object} opts.confirmValue  valeur de window.confirm
 */
export function loadPage(opts = {}) {
  const byId = new Map();
  const el = (id, classes) => {
    if (!byId.has(id)) byId.set(id, new El(id, classes));
    return byId.get(id);
  };
  (Object.entries(opts.classes || {})).forEach(([id, cls]) => el(id, cls));

  const body = new El("__body");
  const langSwitch = new El("lang-switch", ["lang-switch"]);
  body.appendChild(langSwitch);
  for (const lang of ["ru", "en"]) {
    const b = new El(`lang-btn-${lang}`, ["lang-btn"]);
    b.dataset.langBtn = lang;
    langSwitch.appendChild(b);
  }

  const document = {
    readyState: "complete",
    title: "",
    body,
    documentElement: new El("html"),
    getElementById: (id) => byId.get(id) || null,
    addEventListener() {},
    createElement: (tag) => new El(`created-${tag}`),
    querySelectorAll: (sel) => nodes([body, ...byId.values()]).filter((e) => e._matchesSel(sel)),
    querySelector(sel) {
      return nodes([body, ...byId.values()]).find((e) => e._matchesSel(sel)) || null;
    },
  };
  // Les ids du HTML testé sont accessibles sans avoir à les déclarer.
  document.getElementById = (id) => el(id, (opts.classes || {})[id]);

  const calls = [];
  const routes = opts.routes || {};
  const fetchImpl = async (url, options = {}) => {
    const pathname = String(url).split("?")[0];
    calls.push({ url: String(url), pathname, method: (options.method || "GET").toUpperCase(), body: options.body || null, headers: options.headers || null });
    const route = routes[pathname];
    if (route === undefined) return { ok: false, status: 404, headers: new Map(), json: async () => null, text: async () => "<html>not found</html>" };
    const payload = typeof route === "function" ? await route(calls[calls.length - 1]) : route;
    const status = (payload && payload.__status) || 200;
    const json = typeof payload === "object" && payload !== null && !("__status" in payload) ? payload : (payload && payload.__body) || null;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => json,
      text: async () => JSON.stringify(json),
    };
  };

  const store = new Map();
  const deferred = [];
  const windowObj = {
    location: { href: "" },
    confirm: () => opts.confirmValue !== false,
    addEventListener() {},
  };
  const sandbox = {
    window: windowObj,
    document,
    navigator: { language: opts.lang === "en" ? "en-GB" : "ru-RU" },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    },
    fetch: fetchImpl,
    // les temporisateurs courts sont réels ; les longs (toasts qui s'effacent
    // au bout de quelques secondes) sont juste enregistrés, pour ne pas traîner
    // dans les tests
    setTimeout: (fn, ms) => ((ms || 0) > 100 ? deferred.push(fn) : setTimeout(fn, 0)),
    clearTimeout: () => {},
    console: { error() {}, log() {}, warn() {} },
    Intl,
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
  const context = vm.createContext(sandbox);

  const scripts = [opts.i18n || "public/i18n.js", ...(opts.scripts || [])];
  for (const rel of scripts) {
    const file = path.join(REPO_ROOT, rel);
    vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: rel });
  }

  return {
    document,
    window: windowObj,
    context,
    calls,
    // comme dans un vrai navigateur, un getElementById sur un élément présent
    // dans la page crée la référence : les tests peuvent donc lire/écrire tout id.
    el: (id) => el(id, (opts.classes || {})[id]),
    okno: windowObj.OKNO,
    deferredTimers: deferred,
    urlOf(n) {
      return calls[n] ? calls[n].url : null;
    },
    pathnames() {
      return calls.map((c) => c.url);
    },
    bodyOf(n) {
      const c = calls[n];
      return c && c.body ? JSON.parse(c.body) : null;
    },
    async settle(ticks = 6) {
      for (let i = 0; i < ticks; i++) await new Promise((r) => setTimeout(r, 0));
    },
    setLang(lang) {
      windowObj.OKNO.setLang(lang);
    },
  };
}
