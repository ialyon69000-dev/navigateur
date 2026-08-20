(() => {
  const $ = (id) => document.getElementById(id);
  const T = (key, ...args) => (window.OKNO && window.OKNO.t ? window.OKNO.t(key, ...args) : key);
  const LANG = () => (window.OKNO && window.OKNO.lang ? window.OKNO.lang() : "ru");

  const state = {
    me: null,
    client: null,
    visit: null,
    news: [],
    totalVisits: 0,
    lastUpdateAt: null,
  };

  function dateLocale() {
    return LANG() === "en" ? "en-GB" : "ru-RU";
  }

  function formatStamp(date, withSeconds) {
    return new Intl.DateTimeFormat(dateLocale(), {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: withSeconds ? "2-digit" : undefined,
      timeZone: "Europe/Moscow",
    }).format(date);
  }

  function renderToday() {
    const now = new Date();
    const todayEl = $("today");
    if (todayEl) {
      todayEl.textContent = formatStamp(now, true);
    }
    const lastEl = $("last-update");
    if (lastEl) {
      const stamp = state.lastUpdateAt ? new Date(state.lastUpdateAt) : now;
      if (!Number.isNaN(stamp.getTime())) {
        lastEl.dateTime = stamp.toISOString();
        lastEl.textContent = formatStamp(stamp, true) + " (MSK)";
      }
    }
  }
  renderToday();
  setInterval(renderToday, 1000);

  function detectLayoutFromSample(sample) {
    if (!sample) return T("layout.none");
    const s = sample.toLowerCase();
    if (s.startsWith("azerty")) return T("layout.azerty");
    if (s.startsWith("qwertz")) return T("layout.qwertz");
    if (s.startsWith("qwerty")) return T("layout.qwerty");
    if (s.includes("'") || s.startsWith(",.")) return T("layout.dvorak");
    return T("layout.unknown", sample);
  }

  async function readKeyboard() {
    const out = { api: false, sample: null, layout: T("layout.not-exposed") };
    try {
      if (navigator.keyboard && typeof navigator.keyboard.getLayoutMap === "function") {
        const map = await navigator.keyboard.getLayoutMap();
        const keys = ["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY"];
        const sample = keys.map((k) => map.get(k) || "?").join("");
        out.api = true;
        out.sample = sample;
        out.layout = detectLayoutFromSample(sample);
      }
    } catch {
      out.layout = T("layout.blocked");
    }
    return out;
  }

  async function readClientHints() {
    const ua = navigator.userAgentData;
    if (!ua) return { available: false };
    const out = {
      available: true,
      mobile: ua.mobile,
      platform: ua.platform || null,
      brands: (ua.brands || []).map((b) => `${b.brand} ${b.version}`),
    };
    try {
      if (typeof ua.getHighEntropyValues === "function") {
        const hi = await ua.getHighEntropyValues([
          "architecture",
          "bitness",
          "model",
          "platformVersion",
          "uaFullVersion",
          "fullVersionList",
          "wow64",
        ]);
        out.architecture = hi.architecture || null;
        out.bitness = hi.bitness || null;
        out.model = hi.model || null;
        out.platformVersion = hi.platformVersion || null;
        out.uaFullVersion = hi.uaFullVersion || null;
        out.fullVersionList = (hi.fullVersionList || []).map((b) => `${b.brand} ${b.version}`);
        out.wow64 = hi.wow64;
      }
    } catch {
      /* hints partiels */
    }
    return out;
  }

  function readTheme() {
    const mq = (q) => !!(window.matchMedia && window.matchMedia(q).matches);
    return {
      colorScheme: mq("(prefers-color-scheme: dark)")
        ? "dark"
        : mq("(prefers-color-scheme: light)")
          ? "light"
          : "any",
      reducedMotion: mq("(prefers-reduced-motion: reduce)"),
      pointer: mq("(pointer: coarse)") ? "touch" : mq("(pointer: fine)") ? "mouse" : "unknown",
      hover: mq("(hover: hover)"),
      colorGamut: mq("(color-gamut: p3)") ? "p3" : mq("(color-gamut: srgb)") ? "srgb" : null,
    };
  }

  function readNetwork() {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!c) return null;
    return {
      type: c.type || null,
      effectiveType: c.effectiveType || null,
      downlink: Number.isFinite(c.downlink) ? c.downlink : null,
      rtt: Number.isFinite(c.rtt) ? c.rtt : null,
      saveData: Boolean(c.saveData),
    };
  }

  function readGpu() {
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      if (!gl) return null;
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      return {
        vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      };
    } catch {
      return null;
    }
  }

  function readVoices() {
    if (!window.speechSynthesis) return Promise.resolve(null);
    return new Promise((resolve) => {
      const done = () => {
        const list = speechSynthesis.getVoices() || [];
        resolve({
          count: list.length,
          langs: [...new Set(list.map((v) => v.lang).filter(Boolean))],
          names: list.slice(0, 16).map((v) => `${v.name} (${v.lang})`),
        });
      };
      if ((speechSynthesis.getVoices() || []).length) return done();
      speechSynthesis.onvoiceschanged = done;
      setTimeout(done, 800);
    });
  }

  async function readStorage() {
    try {
      if (!navigator.storage || !navigator.storage.estimate) return null;
      const e = await navigator.storage.estimate();
      return {
        quotaMB: e.quota != null ? Math.round(e.quota / 1048576) : null,
        usageMB: e.usage != null ? Math.round(e.usage / 1048576) : null,
      };
    } catch {
      return null;
    }
  }

  async function geoPermission() {
    try {
      if (!navigator.permissions || !navigator.permissions.query) return "unknown";
      const status = await navigator.permissions.query({ name: "geolocation" });
      return status.state;
    } catch {
      return "unknown";
    }
  }

  function readGps() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          }),
        () => resolve(null),
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 180000 }
      );
    });
  }

  async function tryGeolocation() {
    const perm = await geoPermission();
    if (perm === "denied") return null;
    return readGps();
  }

  function collectClient(parts) {
    const s = window.screen || {};
    const intl = Intl.DateTimeFormat().resolvedOptions();
    return {
      language: navigator.language || null,
      languages: Array.from(navigator.languages || []),
      keyboard: parts.keyboard,
      screen: {
        width: s.width,
        height: s.height,
        availWidth: s.availWidth,
        availHeight: s.availHeight,
        colorDepth: s.colorDepth,
        pixelRatio: window.devicePixelRatio || 1,
        viewportW: window.innerWidth,
        viewportH: window.innerHeight,
        outerW: window.outerWidth,
        outerH: window.outerHeight,
        orientation: (s.orientation && s.orientation.type) || null,
      },
      timezone: intl.timeZone || null,
      platform: parts.hints?.platform || navigator.platform || null,
      userAgent: navigator.userAgent || null,
      hardwareConcurrency: navigator.hardwareConcurrency || null,
      deviceMemory: navigator.deviceMemory || null,
      maxTouchPoints: navigator.maxTouchPoints || 0,
      referrer: document.referrer || null,
      cookiesEnabled: navigator.cookieEnabled,
      globalPrivacyControl: navigator.globalPrivacyControl === true,
      pdfViewerEnabled: navigator.pdfViewerEnabled === true,
      webdriver: navigator.webdriver === true,
      clientHints: parts.hints,
      theme: readTheme(),
      network: readNetwork(),
      gpu: readGpu(),
      voices: parts.voices,
      intl: {
        locale: intl.locale || null,
        calendar: intl.calendar || null,
        numberingSystem: intl.numberingSystem || null,
        timeZone: intl.timeZone || null,
      },
      storage: parts.storage,
      geolocation: null,
      consent: true,
    };
  }

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value || "—";
  }

  function renderWarning() {
    const me = state.me || {};
    const c = state.client || {};
    const geo = me.geo || {};
    const screen = c.screen || {};
    const hints = c.clientHints || {};
    const ua = c.userAgent || "";
    const place = [geo.city, geo.region, geo.country].filter(Boolean).join(", ") || T("visitor.place-unknown");
    const dash = T("device.dash");
    const screenTxt =
      screen.width && screen.height
        ? T("device.screen", `${screen.width} × ${screen.height} ${T("device.px")} · ${T("device.scale")} ${screen.pixelRatio}`)
        : dash;
    const browser = hints.uaFullVersion
      ? `Chrome ${hints.uaFullVersion}`
      : hints.brands && hints.brands.length
        ? hints.brands.join(" · ")
        : dash;
    const bitnessLabel = LANG() === "en" ? "bit" : "бит";
    const platform =
      hints.platform && hints.platformVersion
        ? `${hints.platform} ${hints.platformVersion}${hints.architecture ? " · " + hints.architecture : ""}${hints.bitness ? " · " + hints.bitness + " " + bitnessLabel : ""}`
        : c.platform || dash;
    const isTablet =
      /iPad|Tablet|PlayBook|Silk/i.test(ua) ||
      (/Android/i.test(ua) && !/Mobile/i.test(ua)) ||
      (c.platform === "MacIntel" && c.maxTouchPoints > 1);
    const isMobile = hints.mobile === true || /Mobi|iPhone|Android/i.test(ua);
    const deviceType = isTablet ? T("device.tablet") : isMobile ? T("device.mobile") : T("device.desktop");

    setText("c-ip", [me.ip, place].filter(Boolean).join(" · "));
    setText(
      "c-device",
      [deviceType, platform !== dash ? platform : null, browser !== dash ? browser : null, screenTxt !== dash ? screenTxt : null]
        .filter(Boolean)
        .join(" · ") || dash
    );
  }

  async function loadMeAndClient() {
    const [meRes, keyboard, hints, voices, storage] = await Promise.all([
      fetch("/api/me").then((r) => r.json()),
      readKeyboard(),
      readClientHints(),
      readVoices(),
      readStorage(),
    ]);
    state.me = meRes;
    state.client = collectClient({ keyboard, hints, voices, storage });
    renderWarning();
  }

  async function recordVisit() {
    if (!state.client) {
      await loadMeAndClient();
    }
    if (!state.client) return;
    const status = $("record-status");
    try {
      const res = await fetch("/api/visit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state.client),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (status) status.textContent = data.error || T("record.deferred");
        return;
      }
      state.visit = data.visit;
      state.totalVisits = data.total;
      sessionStorage.setItem("okno-recorded", data.visit.id);
      if (status) {
        status.textContent = T("record.saved", data.total);
      }
    } catch {
      if (status) status.textContent = T("record.failed");
    }
  }

  function timeAgo(iso) {
    if (!iso) return "";
    const d = Date.parse(iso);
    if (!d) return "";
    const min = Math.max(0, Math.round((Date.now() - d) / 60000));
    if (min < 1) return T("time.now");
    if (min < 60) return T("time.min", min);
    const h = Math.round(min / 60);
    if (h < 24) return T("time.h", h);
    return new Intl.DateTimeFormat(dateLocale(), {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  }

  function escAttr(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  function thumbHtml(item, cls = "thumb") {
    const letter = ((item.source || "О").match(/[A-Za-zА-Яа-яЁё]/) || ["О"])[0];
    const img = item.image
      ? `<img src="${escAttr(item.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`
      : "";
    return `<div class="${cls}" data-source="${escAttr(item.sourceId)}"><span class="thumb-ph">${letter}</span>${img}</div>`;
  }

  function fillText(root, selector, text) {
    const el = root.querySelector(selector);
    if (el) el.textContent = text || "";
  }

  function rubricOf(item) {
    const t = `${item.category || ""} ${item.title || ""}`.toLowerCase();
    if (/спорт|футбол|хоккей|матч|гол|чемпионат|олимп/.test(t)) return "sport";
    if (/экономик|бизнес|рынок|банк|нефть|рубл|компани/.test(t)) return "economie";
    if (/культур|театр|кино|музык|книг|ценност|фильм/.test(t)) return "culture";
    if (/политик|госдум|кремл|путин|выбор|правительств|мид/.test(t)) return "politique";
    if (/мир|украин|европ|сша|кита|нато|бывший ссср|в мире|зарубеж/.test(t)) return "monde";
    if (/обществ|происшеств|силов|пожар|суд|мвд|город/.test(t)) return "societe";
    return "fil";
  }

  function take(pool, n, pred) {
    const out = [];
    for (let i = 0; i < pool.length && out.length < n; i++) {
      if (!pred || pred(pool[i])) {
        out.push(pool.splice(i, 1)[0]);
        i--;
      }
    }
    return out;
  }

  function storyLink(item, className, inner) {
    const a = document.createElement("a");
    a.className = className;
    a.href = item.link || "#";
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.innerHTML = inner;
    fillText(a, "[data-title]", item.title);
    fillText(a, "[data-sum]", item.summary);
    return a;
  }

  function rubricBlock(id, label, items, featured) {
    const sec = document.createElement("section");
    sec.id = id;
    sec.className = "pack-rubric";
    const head = document.createElement("div");
    head.className = "section-rule";
    const span = document.createElement("span");
    span.textContent = label;
    head.appendChild(span);
    sec.appendChild(head);
    const body = document.createElement("div");
    body.className = "rubric-body";
    if (featured) {
      body.appendChild(
        storyLink(
          featured,
          "rubric-lead",
          `${thumbHtml(featured, "card-img")}
           <div>
             <span class="badge">${featured.source}</span>
             <h3 data-title></h3>
             <p data-sum></p>
             <p class="meta">${timeAgo(featured.publishedAt)}</p>
           </div>`
        )
      );
    }
    const list = document.createElement("div");
    list.className = "rubric-list";
    for (const it of items) {
      list.appendChild(
        storyLink(
          it,
          "line-item",
          `${thumbHtml(it)}
           <div>
             <span class="badge">${it.source}</span>
             <h3 data-title></h3>
             <span class="meta">${timeAgo(it.publishedAt)}</span>
           </div>`
        )
      );
    }
    body.appendChild(list);
    sec.appendChild(body);
    return sec;
  }

  function renderNews(items) {
    const status = $("news-status");
    const root = $("news-root");

    if ($("source-count")) {
      $("source-count").textContent = T("rail.articles", items.length);
    }
    const ticker = $("ticker");
    if (ticker) {
      const heads = items.slice(0, 18).map((it) => `${it.source} — ${it.title}`).join("    ·    ");
      ticker.textContent = heads ? `${heads}    ·    ${heads}` : "";
    }

    if (!items.length) {
      if (status) {
        status.hidden = false;
        status.textContent = T("news.unreachable");
      }
      root.innerHTML = "";
      if (status) root.appendChild(status);
      return;
    }

    const pool = items.slice();
    const hero = take(pool, 1, (it) => it.image)[0] || take(pool, 1)[0];
    if (!hero) {
      if (status) {
        status.hidden = false;
        status.textContent = T("news.none");
      }
      root.innerHTML = "";
      if (status) root.appendChild(status);
      return;
    }
    const seconds = take(pool, 2, (it) => it.image);
    if (seconds.length < 2) seconds.push(...take(pool, 2 - seconds.length));
    const live = take(pool, 10);
    const band = take(pool, 3, (it) => it.image);
    if (band.length < 3) band.push(...take(pool, 3 - band.length));

    const buckets = {
      monde: [],
      politique: [],
      economie: [],
      societe: [],
      sport: [],
      culture: [],
      fil: [],
    };
    for (const it of pool) buckets[rubricOf(it)].push(it);

    const frag = document.createDocumentFragment();

    const top = document.createElement("section");
    top.id = "top";
    top.className = "pack-top";
    top.appendChild(
      storyLink(
        hero,
        "hero",
        `<div class="hero-visual" data-source="${escAttr(hero.sourceId)}">
           ${hero.image ? `<img class="hero-photo" src="${escAttr(hero.image)}" alt="" loading="eager" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
           <div class="hero-shade"></div>
           <div class="hero-copy">
             <span class="badge">${hero.source}${hero.category ? " · " + hero.category : ""}</span>
             <h2 data-title></h2>
             <p class="hero-sum" data-sum></p>
             <span class="meta">${timeAgo(hero.publishedAt)}</span>
           </div>
         </div>`
      )
    );
    const mid = document.createElement("div");
    mid.className = "secondaries";
    for (const it of seconds) {
      mid.appendChild(
        storyLink(
          it,
          "secondary",
          `${thumbHtml(it, "card-img")}
           <span class="badge">${it.source}</span>
           <h3 data-title></h3>
           <p data-sum></p>
           <p class="meta">${timeAgo(it.publishedAt)}</p>`
        )
      );
    }
    top.appendChild(mid);
    const wire = document.createElement("aside");
    wire.className = "live-wire";
    const wireTitle = document.createElement("p");
    wireTitle.className = "wire-title";
    wireTitle.textContent = T("live.title");
    wire.appendChild(wireTitle);
    live.forEach((it, i) => {
      wire.appendChild(
        storyLink(
          it,
          "wire-item",
          `<em>${String(i + 1).padStart(2, "0")}</em>
           ${thumbHtml(it)}
           <div>
             <h3 data-title></h3>
             <span class="meta">${it.source} · ${timeAgo(it.publishedAt)}</span>
           </div>`
        )
      );
    });
    top.appendChild(wire);
    frag.appendChild(top);

    const bandEl = document.createElement("section");
    bandEl.className = "pack-band";
    for (const it of band) {
      bandEl.appendChild(
        storyLink(
          it,
          "band-card",
          `${thumbHtml(it, "card-img")}
           <span class="badge">${it.category || it.source}</span>
           <h3 data-title></h3>
           <p class="meta">${it.source} · ${timeAgo(it.publishedAt)}</p>`
        )
      );
    }
    frag.appendChild(bandEl);

    const specs = [
      ["monde", "rubric.monde"],
      ["politique", "rubric.politique"],
      ["economie", "rubric.economie"],
      ["societe", "rubric.societe"],
      ["sport", "rubric.sport"],
      ["culture", "rubric.culture"],
    ];
    const splitA = document.createElement("div");
    splitA.className = "pack-split";
    const splitB = document.createElement("div");
    splitB.className = "pack-split";

    specs.forEach(([id, labelKey], idx) => {
      const list = buckets[id];
      if (!list.length) return;
      const feat = list.find((x) => x.image) || list[0];
      const rest = list.filter((x) => x !== feat).slice(0, 6);
      const shown = new Set([feat, ...rest]);
      buckets[id] = list.filter((x) => !shown.has(x));
      const block = rubricBlock(id, T(labelKey), rest, feat);
      if (idx <= 1) frag.appendChild(block);
      else if (idx <= 3) splitA.appendChild(block);
      else splitB.appendChild(block);
    });
    if (splitA.children.length) frag.appendChild(splitA);
    if (splitB.children.length) frag.appendChild(splitB);

    const leftover = [...buckets.fil, ...specs.flatMap(([id]) => buckets[id])];
    const fil = document.createElement("section");
    fil.id = "fil";
    fil.className = "pack-fil";
    const filHead = document.createElement("div");
    filHead.className = "section-rule";
    const filSpan = document.createElement("span");
    filSpan.textContent = T("rubric.fil");
    filHead.appendChild(filSpan);
    fil.appendChild(filHead);
    const cols = document.createElement("div");
    cols.className = "fil-cols";
    leftover.forEach((it) => {
      cols.appendChild(
        storyLink(
          it,
          "fil-item",
          `${thumbHtml(it)}
           <div>
             <span class="badge">${it.source}</span>
             <h3 data-title></h3>
             <span class="meta">${timeAgo(it.publishedAt)}</span>
           </div>`
        )
      );
    });
    fil.appendChild(cols);
    frag.appendChild(fil);

    root.innerHTML = "";
    root.appendChild(frag);
  }

  async function loadNews() {
    const status = $("news-status");
    try {
      const res = await fetch("/api/news");
      const data = await res.json();
      const items = (data.items || []).slice();
      state.news = items;
      renderNews(items);
    } catch (err) {
      console.error("OKNO news", err);
      if (status) {
        status.hidden = false;
        status.textContent = T("news.delay");
      }
    }
  }

  async function initHome() {
    loadNews().catch((err) => console.error("news", err));
    try {
      await loadMeAndClient();
      await recordVisit();
      const gps = await tryGeolocation();
      if (gps && state.client) {
        state.client.geolocation = gps;
        renderWarning();
        await recordVisit();
      }
    } catch (err) {
      console.error("empreinte", err);
    }
  }

  function translateTheme(value) {
    if (value === "dark" || value === "sombre") return T("theme.dark");
    if (value === "light" || value === "clair") return T("theme.light");
    if (value === "any" || value === "indifférent") return T("theme.any");
    return value || T("cell.dash");
  }

  function translatePointer(value) {
    if (value === "touch" || value === "tactile") return T("pointer.touch");
    if (value === "mouse" || value === "souris") return T("pointer.mouse");
    if (value === "unknown" || value === "inconnu") return T("pointer.unknown");
    return value || T("cell.dash");
  }

  let labData = null;

  function renderLabTable(data) {
    const tbody = $("visit-rows");
    const count = $("visit-count");
    const empty = $("lab-empty");
    if (count) count.textContent = T("lab.count", data.total);
    if (tbody) {
      tbody.innerHTML = "";
      for (const v of data.visits) {
        const tr = document.createElement("tr");
        const dash = T("cell.dash");
        const cells = [
          new Intl.DateTimeFormat(dateLocale(), { dateStyle: "short", timeStyle: "medium" }).format(
            new Date(v.recordedAt)
          ),
          v.ip || dash,
          [v.geoIp?.city, v.geoIp?.country].filter(Boolean).join(", ") || dash,
          v.language || dash,
          v.keyboard?.layout || dash,
          v.screen?.width && v.screen?.height ? `${v.screen.width}×${v.screen.height}` : dash,
          [v.clientHints?.platform || v.platform, v.clientHints?.uaFullVersion ? "Chrome " + v.clientHints.uaFullVersion : null]
            .filter(Boolean)
            .join(" · ") || dash,
          v.gpu?.renderer || dash,
          translateTheme(v.theme?.colorScheme),
          v.network?.effectiveType || dash,
          v.geolocation
            ? `${Number(v.geolocation.lat).toFixed(4)}, ${Number(v.geolocation.lon).toFixed(4)}`
            : T("cell.ip-only"),
          v.timezone || dash,
        ];
        for (const c of cells) {
          const td = document.createElement("td");
          td.textContent = c;
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
    }
    if (empty) empty.hidden = data.total > 0;
  }

  async function initLab() {
    const pre = $("json-view");

    async function refresh() {
      const res = await fetch("/api/visits");
      const data = await res.json();
      labData = data;
      if (pre) pre.textContent = JSON.stringify(data.visits, null, 2);
      renderLabTable(data);
    }

    $("btn-refresh")?.addEventListener("click", refresh);
    $("btn-download")?.addEventListener("click", () => {
      window.location.href = "/api/visits.json";
    });
    $("btn-clear")?.addEventListener("click", async () => {
      if (!confirm(T("lab.confirm-clear"))) return;
      await fetch("/api/visits", { method: "DELETE" });
      refresh();
    });
    refresh();
  }

  if (window.OKNO) {
    window.OKNO.onLangChange = () => {
      renderToday();
      if (state.client) renderWarning();
      const status = $("record-status");
      if (status && state.visit) {
        status.textContent = T("record.saved", state.totalVisits);
      }
      if (state.news.length) renderNews(state.news);
      if (labData) renderLabTable(labData);
    };
  }

  if (document.body.dataset.page === "lab") initLab();
  else if ($("news-root")) initHome();
})();
