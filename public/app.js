(() => {
  const $ = (id) => document.getElementById(id);

  const state = {
    me: null,
    client: null,
    visit: null,
    news: [],
  };

  const todayEl = $("today");
  if (todayEl) {
    todayEl.textContent = new Intl.DateTimeFormat("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Europe/Paris",
    }).format(new Date());
  }

  function detectLayoutFromSample(sample) {
    if (!sample) return "Non détecté";
    const s = sample.toLowerCase();
    if (s.startsWith("azerty")) return "AZERTY (France / Belgique)";
    if (s.startsWith("qwertz")) return "QWERTZ (Allemagne / Suisse)";
    if (s.startsWith("qwerty")) return "QWERTY";
    if (s.includes("'") || s.startsWith(",.")) return "Dvorak / variante";
    return `Inconnu (${sample})`;
  }

  async function readKeyboard() {
    const out = { api: false, sample: null, layout: "Non exposé (Firefox / Safari)" };
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
      out.layout = "API clavier bloquée";
    }
    return out;
  }

  function collectClient(keyboard) {
    const s = window.screen || {};
    return {
      language: navigator.language || null,
      languages: Array.from(navigator.languages || []),
      keyboard,
      screen: {
        width: s.width,
        height: s.height,
        availWidth: s.availWidth,
        availHeight: s.availHeight,
        colorDepth: s.colorDepth,
        pixelRatio: window.devicePixelRatio || 1,
        viewportW: window.innerWidth,
        viewportH: window.innerHeight,
      },
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
      platform: navigator.userAgentData?.platform || navigator.platform || null,
      userAgent: navigator.userAgent || null,
      hardwareConcurrency: navigator.hardwareConcurrency || null,
      deviceMemory: navigator.deviceMemory || null,
      referrer: document.referrer || null,
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
    const kb = c.keyboard || {};
    const place = [geo.city, geo.region, geo.country].filter(Boolean).join(", ") || "ville inconnue";
    const screenTxt =
      screen.width && screen.height
        ? `${screen.width} × ${screen.height} px · DPR ${screen.pixelRatio}`
        : "—";

    setText("c-ip", me.ip);
    setText("c-geo", place + (geo.isp ? ` · ${geo.isp}` : ""));
    setText("c-kb", kb.layout + (kb.sample ? `  [${kb.sample}]` : ""));
    setText(
      "c-lang",
      (c.languages && c.languages.length ? c.languages.join(" · ") : c.language) ||
        me.headers?.acceptLanguage ||
        "—"
    );
    setText("c-screen", screenTxt);
    setText("c-tz", c.timezone || geo.timezone || "—");
  }

  async function loadMeAndClient() {
    const [meRes, keyboard] = await Promise.all([
      fetch("/api/me").then((r) => r.json()),
      readKeyboard(),
    ]);
    state.me = meRes;
    state.client = collectClient(keyboard);
    renderWarning();
  }

  async function recordVisit() {
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
        if (status) status.textContent = data.error || "Enregistrement différé.";
        return;
      }
      state.visit = data.visit;
      sessionStorage.setItem("okno-recorded", data.visit.id);
      if (status) {
        status.textContent = `Trace écrite dans data/visits.json — ${data.total} visite(s) au journal.`;
      }
    } catch {
      if (status) status.textContent = "Le journal n’a pas pu être joint.";
    }
  }

  function timeAgo(iso) {
    if (!iso) return "";
    const d = Date.parse(iso);
    if (!d) return "";
    const min = Math.max(0, Math.round((Date.now() - d) / 60000));
    if (min < 1) return "à l’instant";
    if (min < 60) return `il y a ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `il y a ${h} h`;
    return new Intl.DateTimeFormat("fr-FR", {
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

  async function loadNews() {
    const status = $("news-status");
    const root = $("news-root");
    try {
      const res = await fetch("/api/news");
      const data = await res.json();
      const items = (data.items || []).slice();
      state.news = items;

      if ($("source-count")) {
        $("source-count").textContent = `${items.length} articles`;
      }
      const ticker = $("ticker");
      if (ticker) {
        const heads = items.slice(0, 18).map((it) => `${it.source} — ${it.title}`).join("    ·    ");
        ticker.textContent = heads ? `${heads}    ·    ${heads}` : "";
      }

      if (!items.length) {
        if (status) status.textContent = "Les flux sources sont momentanément injoignables.";
        return;
      }

      const pool = items.slice();
      const hero = take(pool, 1, (it) => it.image)[0] || take(pool, 1)[0];
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
      wireTitle.textContent = "En continu";
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
            `<div class="card-img" ${imgStyle(it.image)}></div>
             <span class="badge">${it.category || it.source}</span>
             <h3 data-title></h3>
             <p class="meta">${it.source} · ${timeAgo(it.publishedAt)}</p>`
          )
        );
      }
      frag.appendChild(bandEl);

      const specs = [
        ["monde", "Monde"],
        ["politique", "Politique"],
        ["economie", "Économie"],
        ["societe", "Société"],
        ["sport", "Sport"],
        ["culture", "Culture"],
      ];
      const splitA = document.createElement("div");
      splitA.className = "pack-split";
      const splitB = document.createElement("div");
      splitB.className = "pack-split";

      specs.forEach(([id, label], idx) => {
        const list = buckets[id];
        if (!list.length) return;
        const feat = list.find((x) => x.image) || list[0];
        const rest = list.filter((x) => x !== feat).slice(0, 6);
        const shown = new Set([feat, ...rest]);
        buckets[id] = list.filter((x) => !shown.has(x));
        const block = rubricBlock(id, label, rest, feat);
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
      filSpan.textContent = "Toutes les dépêches";
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

      if (status) status.remove();
      root.innerHTML = "";
      root.appendChild(frag);
    } catch {
      if (status) status.textContent = "Impossible de joindre l’agrégateur.";
    }
  }

  async function initHome() {
    await Promise.all([loadMeAndClient(), loadNews()]);
    if (!sessionStorage.getItem("okno-recorded")) {
      await recordVisit();
    } else if ($("record-status")) {
      $("record-status").textContent =
        "Cette session a déjà été écrite dans visits.json (un enregistrement par onglet).";
    }
  }

  async function initLab() {
    const tbody = $("visit-rows");
    const pre = $("json-view");
    const count = $("visit-count");
    const empty = $("lab-empty");

    async function refresh() {
      const res = await fetch("/api/visits");
      const data = await res.json();
      if (count) count.textContent = `${data.total} visite(s) dans data/visits.json`;
      if (pre) pre.textContent = JSON.stringify(data.visits, null, 2);
      if (tbody) {
        tbody.innerHTML = "";
        for (const v of data.visits) {
          const tr = document.createElement("tr");
          const cells = [
            new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "medium" }).format(
              new Date(v.recordedAt)
            ),
            v.ip,
            [v.geoIp?.city, v.geoIp?.country].filter(Boolean).join(", ") || "—",
            v.language || "—",
            v.keyboard?.layout || "—",
            v.screen?.width && v.screen?.height ? `${v.screen.width}×${v.screen.height}` : "—",
            v.geolocation ? `${v.geolocation.lat}, ${v.geolocation.lon}` : "IP seulement",
            v.timezone || "—",
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

    $("btn-refresh")?.addEventListener("click", refresh);
    $("btn-download")?.addEventListener("click", () => {
      window.location.href = "/api/visits.json";
    });
    $("btn-clear")?.addEventListener("click", async () => {
      if (!confirm("Effacer tout le fichier visits.json ?")) return;
      await fetch("/api/visits", { method: "DELETE" });
      refresh();
    });
    refresh();
  }

  if (document.body.dataset.page === "lab") initLab();
  else if ($("news-root")) initHome();
})();
