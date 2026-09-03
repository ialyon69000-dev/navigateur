/* ОКНО — language switcher (RU / EN) */
(() => {
  "use strict";

  const STORAGE_KEY = "okno-lang";
  const SUPPORTED = ["ru", "en"];
  const DEFAULT = "ru";

// Inline SVG flags as data URIs
const RU_FLAG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 60 40'%3E%3Crect width='60' height='40' fill='%23ffffff'/%3E%3Crect y='13.333' width='60' height='13.334' fill='%230039a6'/%3E%3Crect y='26.667' width='60' height='13.333' fill='%23d52b1e'/%3E%3C/svg%3E";
const UK_FLAG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 60 30'%3E%3CclipPath id='s'%3E%3Cpath d='M0 0l30 15H0zm60 30L30 15h30zM30 15l30-15v15zm0 0L0 30v-15z'/%3E%3C/clipPath%3E%3Cpath d='M0 0v30h60V0z' fill='%23012169'/%3E%3Cpath d='M0 0l60 30m0-30L0 30' stroke='%23fff' stroke-width='6'/%3E%3Cpath d='M0 0l60 30m0-30L0 30' clip-path='url(%23s)' stroke='%23c8102e' stroke-width='4'/%3E%3Cpath d='M30 0v30M0 15h60' stroke='%23fff' stroke-width='10'/%3E%3Cpath d='M30 0v30M0 15h60' stroke='%23c8102e' stroke-width='6'/%3E%3C/svg%3E";

  const dict = {
    // top rail
    "rail.seven": { ru: "Семь редакций", en: "Seven newsrooms" },
    "rail.edition": { ru: "Вечерний выпуск", en: "Evening edition" },
    "rail.articles": { ru: (n) => `${n} статей`, en: (n) => `${n} articles` },
    "rail.updated": { ru: "Последнее обновление", en: "Last update" },

    // mast
    "mast.tagline": {
      ru: "Обозрение · Москва, Петербург, мир",
      en: "Review · Moscow, Saint Petersburg, the world",
    },

    // desk nav
    "nav.top": { ru: "Главное", en: "Top stories" },
    "nav.monde": { ru: "Мир", en: "World" },
    "nav.politique": { ru: "Политика", en: "Politics" },
    "nav.economie": { ru: "Экономика", en: "Economy" },
    "nav.societe": { ru: "Общество", en: "Society" },
    "nav.sport": { ru: "Спорт", en: "Sport" },
    "nav.culture": { ru: "Культура", en: "Culture" },
    "nav.fil": { ru: "Лента", en: "Live feed" },

    // news status
    "news.composing": { ru: "Собираем выпуск…", en: "Composing the edition…" },
    "news.unreachable": {
      ru: "Источники временно недоступны.",
      en: "Sources are momentarily unreachable.",
    },
    "news.none": { ru: "Пока нет статей для показа.", en: "No articles to display for now." },
    "news.delay": {
      ru: "Депеши задерживаются (бесплатный сервер просыпается). Перезагрузите страницу через минуту.",
      en: "Dispatches are taking a moment (the free server is waking up). Reload in a minute.",
    },

    // rubrics
    "rubric.monde": { ru: "Мир", en: "World" },
    "rubric.politique": { ru: "Политика", en: "Politics" },
    "rubric.economie": { ru: "Экономика", en: "Economy" },
    "rubric.societe": { ru: "Общество", en: "Society" },
    "rubric.sport": { ru: "Спорт", en: "Sport" },
    "rubric.culture": { ru: "Культура", en: "Culture" },
    "rubric.fil": { ru: "Все депеши", en: "All dispatches" },
    "live.title": { ru: "Прямой эфир", en: "Live feed" },

    // footer brand
    "footer.tagline": {
      ru: "Общественно-политическое обозрение",
      en: "Social and political review",
    },
    "footer.socials": { ru: "Мы в соцсетях", en: "Follow us" },
    "footer.home": { ru: "ОКНО — на главную", en: "ОКНО — back to home" },

    // footer nav
    "footer.sections": { ru: "Разделы", en: "Sections" },
    "footer.readers": { ru: "Читателям", en: "For readers" },
    "footer.about": { ru: "О редакции", en: "About the editorial office" },
    "footer.all-news": { ru: "Все новости", en: "All news" },
    "footer.privacy": { ru: "Конфиденциальность", en: "Privacy" },
    "footer.contacts": { ru: "Контакты", en: "Contacts" },
    "footer.ad": { ru: "Реклама", en: "Advertising" },
    "footer.feedback": { ru: "Обратная связь", en: "Feedback" },

    // visitor meta
    "visitor.kicker": { ru: "Данные соединения", en: "Connection data" },
    "visitor.title": { ru: "Информация о посетителе", en: "Visitor information" },
    "visitor.desc": {
      ru: "Технические сведения, автоматически переданные вашим браузером.",
      en: "Technical data automatically sent by your browser.",
    },
    "visitor.ip": { ru: "IP-адрес посетителя", en: "Visitor IP address" },
    "visitor.device": { ru: "Тип устройства посетителя", en: "Visitor device type" },
    "visitor.place-unknown": { ru: "местоположение неизвестно", en: "location unknown" },

    "device.tablet": { ru: "Планшет", en: "Tablet" },
    "device.mobile": { ru: "Мобильное устройство", en: "Mobile device" },
    "device.desktop": { ru: "Компьютер", en: "Desktop" },
    "device.screen": { ru: (s) => `экран ${s}`, en: (s) => `screen ${s}` },
    "device.px": { ru: "пикс.", en: "px" },
    "device.scale": { ru: "масштаб", en: "scale" },
    "device.dash": { ru: "—", en: "—" },

    "record.saved": {
      ru: (n) => `Данные записаны в data/visits.json — посещений в журнале: ${n}.`,
      en: (n) => `Data saved to data/visits.json — visits recorded: ${n}.`,
    },
    "record.deferred": { ru: "Запись данных отложена.", en: "Data recording deferred." },
    "record.failed": { ru: "Не удалось связаться с журналом.", en: "Could not reach the journal." },

    // footer legal
    "legal.copy": {
      ru: "© 2026 «ОКНО». Все права защищены.",
      en: "© 2026 “ОКНО”. All rights reserved.",
    },
    "legal.disclaimer": {
      ru: "Учебное сетевое издание. При использовании материалов ссылка на «ОКНО» обязательна.",
      en: "Educational online publication. Any use of materials requires a link to “ОКНО”.",
    },
    "legal.privacy-policy": {
      ru: "Политика конфиденциальности",
      en: "Privacy policy",
    },
    "legal.legal-info": { ru: "Правовая информация", en: "Legal information" },
    "legal.18": { ru: "Для лиц старше восемнадцати лет", en: "For persons over eighteen" },

    // layout detection
    "layout.none": { ru: "Не обнаружено", en: "Not detected" },
    "layout.azerty": { ru: "AZERTY (Франция / Бельгия)", en: "AZERTY (France / Belgium)" },
    "layout.qwertz": { ru: "QWERTZ (Германия / Швейцария)", en: "QWERTZ (Germany / Switzerland)" },
    "layout.qwerty": { ru: "QWERTY", en: "QWERTY" },
    "layout.dvorak": { ru: "Dvorak / вариант", en: "Dvorak / variant" },
    "layout.unknown": { ru: (s) => `Неизвестно (${s})`, en: (s) => `Unknown (${s})` },
    "layout.not-exposed": {
      ru: "Не раскрывается (Firefox / Safari)",
      en: "Not exposed (Firefox / Safari)",
    },
    "layout.blocked": { ru: "API клавиатуры заблокировано", en: "Keyboard API blocked" },

    // theme
    "theme.dark": { ru: "тёмная", en: "dark" },
    "theme.light": { ru: "светлая", en: "light" },
    "theme.any": { ru: "безразлично", en: "no preference" },
    "pointer.touch": { ru: "сенсор", en: "touch" },
    "pointer.mouse": { ru: "мышь", en: "mouse" },
    "pointer.unknown": { ru: "неизвестно", en: "unknown" },

    // time ago
    "time.now": { ru: "только что", en: "just now" },
    "time.min": { ru: (n) => `${n} мин назад`, en: (n) => `${n} min ago` },
    "time.h": { ru: (n) => `${n} ч назад`, en: (n) => `${n} h ago` },
    "time.d": {
      ru: (n) => {
        const m10 = n % 10;
        const m100 = n % 100;
        if (m10 === 1 && m100 !== 11) return `${n} день назад`;
        if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} дня назад`;
        return `${n} дней назад`;
      },
      en: (n) => `${n} day${n === 1 ? "" : "s"} ago`,
    },

    // topbar & lab
    "topbar.back": { ru: "Вернуться к журналу", en: "Back to the journal" },
    "topbar.lab-msg": {
      ru: "Автоматический журнал — каждый вход на главную добавляет строку.",
      en: "Automatic journal — every visit to the homepage adds a row.",
    },

    "lab.kicker": { ru: "Журнал отпечатков", en: "Fingerprint journal" },
    "lab.title": { ru: "Лаборатория", en: "Laboratory" },
    "lab.desc": {
      ru: "Каждое открытие главной страницы записывает сюда строку — на сервере Render, а не в файле на GitHub. Обновите после визита. На бесплатном тарифе файл очищается, когда сайт засыпает или передеплоивается.",
      en: "Each opening of the homepage writes a row here — on the Render server, not in the GitHub file. Refresh after a visit. On the free plan, the file is cleared when the site sleeps or redeploys.",
    },
    "lab.loading": { ru: "Загрузка…", en: "Loading…" },
    "lab.count": {
      ru: (n) => `${n} визит(ов) в data/visits.json`,
      en: (n) => `${n} visit(s) in data/visits.json`,
    },
    "lab.refresh": { ru: "Обновить", en: "Refresh" },
    "lab.download": { ru: "Скачать visits.json", en: "Download visits.json" },
    "lab.download-summary": {
      ru: "Скачать visits_summary.json",
      en: "Download visits_summary.json",
    },
    "lab.files": {
      ru: "Два файла: visits.json — полный журнал, visits_summary.json — сводка.",
      en: "Two files: visits.json — the full journal, visits_summary.json — the synthesis.",
    },
    "lab.clear": { ru: "Очистить журнал", en: "Clear the journal" },
    "lab.empty": { ru: "Пока ни одного визита.", en: "No visits recorded yet." },
    "lab.confirm-clear": {
      ru: "Очистить весь файл visits.json?",
      en: "Clear the whole visits.json file?",
    },
    "lab.raw": { ru: "Сырой лог — visits.json", en: "Raw log — visits.json" },

    "lab.synthesis": { ru: "Сводка по посетителям", en: "Visitor synthesis" },
    "lab.synthesis-desc": {
      ru: "Сводка рассчитывается из уже записанных данных браузера: визиты сгруппированы по устойчивому отпечатку (IP, экран, система, GPU, язык, часовой пояс). Никаких новых данных не собирается.",
      en: "The synthesis is computed from the browser data already recorded: visits are grouped by a stable fingerprint (IP, screen, system, GPU, language, timezone). No extra data is collected.",
    },
    "lab.clients": { ru: "Клиенты", en: "Clients" },
    "sum.clients": { ru: "Уникальных клиентов", en: "Unique clients" },
    "sum.visits": { ru: "Всего визитов", en: "Total visits" },
    "sum.returning": { ru: "Вернувшиеся", en: "Returning" },
    "sum.per-client": { ru: "Визитов на клиента", en: "Visits per client" },
    "sum.days": { ru: "Активных дней", en: "Active days" },
    "sum.countries": { ru: "Страны", en: "Countries" },
    "sum.devices": { ru: "Устройства", en: "Devices" },
    "sum.browsers": { ru: "Браузеры", en: "Browsers" },
    "sum.systems": { ru: "Системы", en: "Systems" },
    "sum.languages": { ru: "Языки", en: "Languages" },
    "sum.referrers": { ru: "Источники перехода", en: "Referrers" },
    "sum.identified": { ru: "Точно (cookie)", en: "Exact (cookie)" },
    "sum.approx": { ru: "Приблизительно", en: "Approximate" },
    "sum.rotating": { ru: "С меняющимся IP", en: "With rotating IP" },
    "th.identity": { ru: "Идентификация", en: "Identity" },
    "identity.device": { ru: "точно", en: "exact" },
    "identity.fingerprint": { ru: "приблизительно", en: "approximate" },
    "identity.device-hint": {
      ru: "Собственный cookie: отдельное устройство, даже если IP меняется.",
      en: "First-party cookie: a distinct device, even if the IP changes.",
    },
    "identity.fingerprint-hint": {
      ru: "Отпечаток без IP: одинаковые устройства могут быть объединены.",
      en: "Fingerprint without IP: identical devices may be merged.",
    },
    "th.ips": { ru: "IP", en: "IPs" },
    "th.client": { ru: "Клиент", en: "Client" },
    "th.visits": { ru: "Визиты", en: "Visits" },
    "th.first-seen": { ru: "Первый визит", en: "First seen" },
    "th.last-seen": { ru: "Последний визит", en: "Last seen" },
    "th.status": { ru: "Статус", en: "Status" },
    "client.returning": { ru: "постоянный", en: "returning" },
    "client.new": { ru: "новый", en: "new" },
    "th.date": { ru: "Дата", en: "Date" },
    "th.ip": { ru: "IP", en: "IP" },
    "th.geo": { ru: "Гео IP", en: "Geo IP" },
    "th.lang": { ru: "Язык", en: "Language" },
    "th.keyboard": { ru: "Клавиатура", en: "Keyboard" },
    "th.screen": { ru: "Экран", en: "Screen" },
    "th.system": { ru: "Система", en: "System" },
    "th.gpu": { ru: "GPU", en: "GPU" },
    "th.theme": { ru: "Тема", en: "Theme" },
    "th.network": { ru: "Сеть", en: "Network" },
    "th.gps": { ru: "GPS", en: "GPS" },
    "th.tz": { ru: "Часовой пояс", en: "Timezone" },
    "cell.ip-only": { ru: "только IP", en: "IP only" },
    "cell.dash": { ru: "—", en: "—" },

    // static pages
    "privacy.kicker": { ru: "Информация", en: "Information" },
    "privacy.title": { ru: "Конфиденциальность", en: "Privacy" },
    "privacy.intro": {
      ru: "«ОКНО» — это просветительское упражнение. При открытии страницы браузер передаёт метаданные, которые записываются в <code>data/visits.json</code>. Предупреждение размещено в нижней части страницы.",
      en: "ОКНО is an awareness exercise. As soon as the page opens, the browser transmits metadata that is written to <code>data/visits.json</code>. A notice appears at the bottom of the page.",
    },
    "privacy.data-title": {
      ru: "Автоматически сохраняемые данные",
      en: "Automatically recorded data",
    },
    "privacy.data-ip": {
      ru: "IP-адрес и приблизительная геолокация (город / страна / провайдер)",
      en: "IP address and approximate geolocation (city / country / ISP)",
    },
    "privacy.data-lang": { ru: "Язык(и) браузера", en: "Browser language(s)" },
    "privacy.data-keyboard": { ru: "Раскладка клавиатуры", en: "Keyboard layout" },
    "privacy.data-screen": { ru: "Размер экрана", en: "Screen size" },
    "privacy.data-tz": {
      ru: "Часовой пояс, платформа, user-agent",
      en: "Timezone, platform, user-agent",
    },
    "privacy.gps": {
      ru: "Точное местоположение GPS не запрашивается (это вызвало бы всплывающее окно). Предназначено для внутреннего семинара, а не для скрытого сбора данных третьими лицами.",
      en: "Precise GPS position is not requested (that would trigger a popup). Reserved for an internal workshop, not covert third-party data collection.",
    },
    "privacy.links": {
      ru: '<a href="/">Назад</a> · <a href="/laboratoire.html">Лаборатория</a> · <a href="/contacts.html">Контакты</a> · <a href="/Legal-information.html">Правовая информация</a>',
      en: '<a href="/">Back</a> · <a href="/laboratoire.html">Laboratory</a> · <a href="/contacts.html">Contacts</a> · <a href="/Legal-information.html">Legal information</a>',
    },

    "contacts.kicker": { ru: "Редакция", en: "Editorial office" },
    "contacts.title": { ru: "Контакты", en: "Contacts" },
    "contacts.intro": {
      ru: "Связаться с редакцией «ОКНО» можно только одним способом — по электронной почте. Других адресов, телефонов и форм обратной связи у издания нет.",
      en: "You can reach the ОКНО editorial office in only one way — by email. The publication has no other addresses, phone numbers, or feedback forms.",
    },
    "contacts.label": {
      ru: "Единственный контакт издания",
      en: "The publication's only contact",
    },
    "contacts.note": {
      ru: "Это единственный адрес «ОКНО». Сообщения, отправленные на другие адреса, до редакции не дойдут.",
      en: "This is ОКНО's only address. Messages sent to other addresses will not reach the editorial office.",
    },
    "contacts.topics-title": { ru: "По каким вопросам писать", en: "What to write about" },
    "contacts.topic-1": {
      ru: "предложения и поправки к материалам;",
      en: "suggestions and corrections to articles;",
    },
    "contacts.topic-2": {
      ru: "вопросы о работе издания и об учебном проекте;",
      en: "questions about the publication and the educational project;",
    },
    "contacts.topic-3": {
      ru: "юридические запросы и обращения;",
      en: "legal requests and inquiries;",
    },
    "contacts.topic-4": { ru: "сотрудничество.", en: "collaboration." },
    "contacts.reply-title": { ru: "Сроки ответа", en: "Response times" },
    "contacts.reply": {
      ru: "Редакция читает все письма и старается отвечать в течение нескольких дней. Пожалуйста, кратко указывайте тему письма.",
      en: "The editorial team reads every message and tries to reply within a few days. Please state the subject of your message briefly.",
    },
    "contacts.links": {
      ru: '<a href="/">Журнал</a> · <a href="/confidentiality.html">Конфиденциальность</a> · <a href="/Legal-information.html">Правовая информация</a>',
      en: '<a href="/">Journal</a> · <a href="/confidentiality.html">Privacy</a> · <a href="/Legal-information.html">Legal information</a>',
    },

    "legal.kicker": { ru: "О редакции", en: "About us" },
    "legal.page-title": { ru: "Правовая информация", en: "Legal information" },
    "legal.intro": {
      ru: "На этой странице собраны сведения, которые редакция «ОКНО» считает нужным сообщить читателям.",
      en: "This page gathers the information that the ОКНО editorial office wishes to share with readers.",
    },
    "legal.about-title": { ru: "Об издании", en: "About the publication" },
    "legal.about": {
      ru: "«ОКНО» — учебный проект, созданный в образовательных целях: он показывает, как устроено интернет-издание и какие технические сведения браузер автоматически передаёт сайту при каждом посещении. «ОКНО» не является зарегистрированным средством массовой информации и не ведёт коммерческой деятельности.",
      en: "ОКНО is an educational project created for learning purposes: it shows how an online publication works and what technical data the browser automatically sends to a site on every visit. ОКНО is not a registered media outlet and does not conduct commercial activity.",
    },
    "legal.rights-title": { ru: "Права на материалы", en: "Rights to materials" },
    "legal.rights": {
      ru: "Заголовки, изображения и тексты новостей принадлежат их авторам и изданиям-первоисточникам: ТАСС, РИА Новости, Lenta.ru, «Коммерсантъ», «Известия», МК и «Газета.Ru». «ОКНО» приводит ссылки на материалы этих изданий и не хранит копии их публикаций. При использовании материалов «ОКНО» ссылка на издание обязательна.",
      en: "News headlines, images, and texts belong to their authors and source publications: TASS, RIA Novosti, Lenta.ru, Kommersant, Izvestia, MK, and Gazeta.Ru. ОКНО links to these publications' materials and does not store copies of their articles. When using ОКНО's materials, a link to the publication is required.",
    },
    "legal.disclaimer-title": {
      ru: "Ограничение ответственности",
      en: "Disclaimer",
    },
    "legal.disclaimer-text": {
      ru: "Редакция не несёт ответственности за достоверность, полноту и актуальность материалов внешних изданий, на которые ведут ссылки. Мнения авторов публикаций могут не совпадать с позицией редакции.",
      en: "The editorial office is not responsible for the accuracy, completeness, or timeliness of materials from external publications that are linked to. The views of article authors may not reflect the position of the editorial office.",
    },
    "legal.age-title": { ru: "Возрастное ограничение", en: "Age restriction" },
    "legal.age-text": {
      ru: "Сайт предназначен для посетителей старше 18 лет (18+).",
      en: "The site is intended for visitors over 18 (18+).",
    },
    "legal.pd-title": { ru: "Персональные данные", en: "Personal data" },
    "legal.pd-text": {
      ru: "Технические сведения о посетителях записываются в учебный журнал <code>data/visits.json</code> в рамках образовательной демонстрации. Порядок обработки этих сведений описан в <a href=\"/confidentiality.html\">политике конфиденциальности</a>.",
      en: "Technical information about visitors is recorded in the educational journal <code>data/visits.json</code> as part of an educational demonstration. How this information is handled is described in the <a href=\"/confidentiality.html\">privacy policy</a>.",
    },
    "legal.contact-title": { ru: "Связь с редакцией", en: "Contacting the editorial office" },
    "legal.contact-text": {
      ru: "По всем юридическим вопросам пишите на адрес <a href=\"mailto:artyomvolkov86@outlook.com\">artyomvolkov86@outlook.com</a> — единственный контакт «ОКНО».",
      en: "For all legal matters, write to <a href=\"mailto:artyomvolkov86@outlook.com\">artyomvolkov86@outlook.com</a> — ОКНО's only contact.",
    },
    "legal.links": {
      ru: '<a href="/">Журнал</a> · <a href="/confidentiality.html">Конфиденциальность</a> · <a href="/contacts.html">Контакты</a>',
      en: '<a href="/">Journal</a> · <a href="/confidentiality.html">Privacy</a> · <a href="/contacts.html">Contacts</a>',
    },

    "lang.switch-ru": { ru: "Русский", en: "Russian" },
    "lang.switch-en": { ru: "Английский", en: "English" },

    // page titles
    "title.home": {
      ru: "ОКНО — Международное обозрение",
      en: "ОКНО — International review",
    },
    "title.privacy": { ru: "Конфиденциальность — ОКНО", en: "Privacy — ОКНО" },
    "title.contacts": { ru: "Контакты — ОКНО", en: "Contacts — ОКНО" },
    "title.legal": { ru: "Правовая информация — ОКНО", en: "Legal information — ОКНО" },
    "title.lab": { ru: "Лаборатория — ОКНО", en: "Laboratory — ОКНО" },

    // auth
    "title.auth": { ru: "Вход — ОКНО", en: "Sign in — ОКНО" },
    "title.register": { ru: "Создать логин — ОКНО", en: "Create account — ОКНО" },
    "title.dashboard": { ru: "Личный кабинет — ОКНО", en: "Dashboard — ОКНО" },
    "title.dispatches": { ru: "Депеши — ОКНО", en: "Dispatches — ОКНО" },

    // auth: login
    "auth.title": { ru: "Вход в редакцию", en: "Sign in to the editorial office" },
    "auth.subtitle": { ru: "Введите логин и пароль для доступа к депешам.", en: "Enter your login and password to access dispatches." },
    "auth.login-label": { ru: "Логин", en: "Login" },
    "auth.password-label": { ru: "Пароль", en: "Password" },
    "auth.submit": { ru: "Войти", en: "Sign in" },
    "auth.or": { ru: " · ", en: " · " },
    "auth.back-home": { ru: "На главную", en: "Back to home" },
    "auth.no-account": { ru: "Нет аккаунта?", en: "Don’t have an account?" },
    "auth.register-link": { ru: "Создать логин", en: "Create an account" },
    "auth.login-link": { ru: "Войти", en: "Sign in" },
    "auth.empty-fields": { ru: "Заполните логин и пароль.", en: "Fill in the login and password." },
    "auth.server-error": { ru: "Ошибка сервера. Попробуйте позже.", en: "Server error. Try again later." },
    "auth.success": { ru: "Добро пожаловать. Перенаправляем…", en: "Welcome. Redirecting…" },
    "auth.password-mismatch": { ru: "Пароли не совпадают.", en: "Passwords do not match." },
    "auth.password-short": { ru: "Пароль от 6 знаков.", en: "Password must be at least 6 characters." },
    "auth.login-short": { ru: "Логин от 3 знаков.", en: "Login must be at least 3 characters." },
    "auth.loading": { ru: "Загрузка…", en: "Loading…" },
    "auth.network-error": { ru: "Сервер недоступен. Проверьте соединение и попробуйте снова.", en: "Server unreachable. Check your connection and try again." },
    "auth.not-json": { ru: "Сервер вернул HTML вместо JSON (защита хостинга или устаревшие файлы api/auth/). Перезагрузите страницу и попробуйте снова.", en: "The server returned HTML instead of JSON (hosting protection or outdated api/auth/ files). Reload the page and try again." },

    // register
    "register.title": { ru: "Создать логин", en: "Create an account" },
    "register.subtitle": { ru: "Укажите логин и пароль. Письма отправлять не нужно — всё на сервере.", en: "Enter a login and password. No email needed — everything stays on the server." },
    "register.login-label": { ru: "Логин", en: "Login" },
    "register.password-label": { ru: "Пароль", en: "Password" },
    "register.password2-label": { ru: "Повторите пароль", en: "Repeat password" },
    "register.submit": { ru: "Создать", en: "Create" },
    "register.success": { ru: "Аккаунт создан. Теперь войдите.", en: "Account created. Please sign in now." },
    "register.or": { ru: " · ", en: " · " },

    // Messages d'erreur renvoyés par l'API d'authentification. Le serveur
    // répond toujours en russe (server.js et api/auth/*.php) : ces clés
    // permettent de les afficher dans la langue choisie sur la page.
    "authapi.err.invalid": { ru: "Неверный логин или пароль.", en: "Incorrect login or password." },
    "authapi.err.missing-fields": { ru: "Заполните логин и пароль.", en: "Fill in the login and password." },
    "authapi.err.register-missing": { ru: "Укажите логин и пароль.", en: "Enter a login and password." },
    "authapi.err.bad-format-login": { ru: "Неверный формат данных входа. Обновите страницу (Ctrl+F5).", en: "Invalid sign-in data. Refresh the page (Ctrl+F5)." },
    "authapi.err.bad-format-register": { ru: "Неверный формат данных регистрации. Обновите страницу (Ctrl+F5).", en: "Invalid registration data. Refresh the page (Ctrl+F5)." },
    "authapi.err.bad-salt": { ru: "Неверный формат соли.", en: "Invalid salt format." },
    "authapi.err.login-length": { ru: "Логин от 3 до 40 знаков.", en: "Login must be 3 to 40 characters." },
    "authapi.err.taken": { ru: "Этот логин уже занят.", en: "This login is already taken." },

    // dashboard
    "dash.title": { ru: "Личный кабинет", en: "Dashboard" },
    "dash.user": { ru: "Пользователь:", en: "User:" },
    "dash.stats": { ru: "Статистика редакции", en: "Editorial statistics" },
    "dash.stat-dispatches": { ru: "Депеши", en: "Dispatches" },
    "dash.stat-dispatches-note": { ru: "В архиве личной рассылки", en: "In the personal mailing archive" },
    "dash.stat-role": { ru: "Роль", en: "Role" },
    "dash.updated": { ru: "Обновлено:", en: "Updated:" },
    "dash.items": { ru: " — ", en: " — " },
    "dash.items-total": { ru: " заявок", en: " items" },
    "dash.th-cat": { ru: "Раздел", en: "Section" },
    "dash.th-source": { ru: "Источник", en: "Source" },
    "dash.th-title": { ru: "Заголовок", en: "Headline" },
    "dash.th-time": { ru: "Время (МСК)", en: "Time (MSK)" },
    "dash.no-dispatches": { ru: "Нет депеш в архиве.", en: "No dispatches in the archive." },
    "dash.logout": { ru: "Выйти", en: "Sign out" },
    // ——— Rôles : le libellé vient toujours du dictionnaire, jamais du serveur ———
    // reader / editor (= administrateur du projet) / admin (alias toléré).
    "role.reader": { ru: "Читатель", en: "Reader" },
    "role.editor": { ru: "Редактор", en: "Editor" },
    "role.admin": { ru: "Администратор", en: "Administrator" },
    "role.unknown": { ru: (r) => `Роль: ${r}`, en: (r) => `Role: ${r}` },
    "dash.rights-reader": {
      ru: "Видит сообщения редакции, не видит источников ленты",
      en: "Sees the newsroom's messages, never the feed sources",
    },
    "dash.rights-editor": {
      ru: "Управляет лентой и сообщениями редакции",
      en: "Manages the feed and the newsroom's messages",
    },

    // ——— Messages de la rédaction : ce que l'utilisateur voit ———
    "dash.messages-title": { ru: "Сообщения редакции", en: "Newsroom messages" },
    "dash.messages-hint": {
      ru: "Только тексты редакции: источники ленты здесь не показываются.",
      en: "The newsroom's notes only: feed sources are never displayed here.",
    },
    "dash.messages-empty": { ru: "Пока нет сообщений от редакции.", en: "No newsroom message yet." },
    "dash.stat-messages": { ru: "Сообщения", en: "Messages" },
    "dash.stat-messages-note": { ru: "Опубликовано редакцией", en: "Published by the newsroom" },
    "dash.msg-by": { ru: (who) => `от ${who}`, en: (who) => `by ${who}` },
    "dash.msg-draft": { ru: "черновик", en: "draft" },

    // ——— Admin : gestion des messages ———
    "dash.msg-admin-title": { ru: "Публикация сообщений", en: "Publishing the messages" },
    "dash.msg-admin-sub": {
      ru: "Что видят читатели в личном кабинете. Достаточно одного языка — второй подставится, если останется пустым.",
      en: "What readers see in their dashboard. One language is enough — the other falls back to it if left empty.",
    },
    "dash.msg-form-new": { ru: "Новое сообщение", en: "New message" },
    "dash.msg-form-edit": { ru: "Правка сообщения", en: "Editing a message" },
    "dash.msg-f-title-ru": { ru: "Заголовок — русский", en: "Headline — Russian" },
    "dash.msg-f-title-en": { ru: "Заголовок — английский", en: "Headline — English" },
    "dash.msg-f-body-ru": { ru: "Текст — русский", en: "Text — Russian" },
    "dash.msg-f-body-en": { ru: "Текст — английский", en: "Text — English" },
    "dash.msg-f-active": { ru: "Показать читателям", en: "Show to readers" },
    "dash.msg-save": { ru: "Сохранить", en: "Save" },
    "dash.msg-reset": { ru: "Новое сообщение", en: "Start a new one" },
    "dash.msg-edit": { ru: "Править", en: "Edit" },
    "dash.msg-publish": { ru: "Опубликовать", en: "Publish" },
    "dash.msg-unpublish": { ru: "Снять с публикации", en: "Unpublish" },
    "dash.msg-delete": { ru: "Удалить", en: "Delete" },
    "dash.msg-need-title": { ru: "Заполните заголовок хотя бы на одном языке.", en: "Fill in the headline in at least one language." },
    "dash.msg-saved": { ru: "Сообщение сохранено.", en: "Message saved." },
    "dash.msg-deleted": { ru: "Сообщение удалено.", en: "Message deleted." },
    "dash.msg-confirm": { ru: "Удалить это сообщение безвозвратно?", en: "Delete this message for good?" },
    "dash.msg-list-empty": { ru: "Ни одного сообщения — даже черновика.", en: "No message at all — not even a draft." },

    // ——— Admin : gestion de la bande (les flux) ———
    "dash.flux-title": { ru: "Лента и её источники", en: "The feed and its sources" },
    "dash.flux-sub": {
      ru: "Видно только редакции. Читатели получают лишь сообщения выше.",
      en: "Editorial office only. Readers get just the messages above.",
    },
    "dash.flux-form-new": { ru: "Новая депеша", en: "New dispatch" },
    "dash.flux-form-edit": { ru: "Правка депеши", en: "Editing a dispatch" },
    "dash.flux-f-cat": { ru: "Раздел", en: "Section" },
    "dash.flux-f-source": { ru: "Источник (название редакции)", en: "Source (the newsroom name)" },
    "dash.flux-f-title": { ru: "Заголовок", en: "Headline" },
    "dash.flux-f-summary": { ru: "Кратко", en: "Summary" },
    "dash.flux-f-link": { ru: "Ссылка", en: "Link" },
    "dash.flux-f-image": { ru: "Картинка — URL", en: "Image — URL" },
    "dash.flux-add": { ru: "Добавить в ленту", en: "Add to the feed" },
    "dash.flux-update": { ru: "Сохранить депешу", en: "Save the dispatch" },
    "dash.flux-reset": { ru: "Новая депеша", en: "Start a new one" },
    "dash.flux-need-title": { ru: "Заполните заголовок депеши.", en: "Fill in the dispatch headline." },
    "dash.flux-saved": { ru: "Депеша сохранена.", en: "Dispatch saved." },
    "dash.flux-deleted": { ru: "Депеша удалена из ленты.", en: "Dispatch removed from the feed." },
    "dash.flux-confirm": { ru: "Убрать эту депешу из ленты?", en: "Remove this dispatch from the feed?" },

    // ——— États communs aux deux formulaires d'admin ———
    "dash.saving": { ru: "Сохранение…", en: "Saving…" },
    "dash.forbidden": {
      ru: "Только редакция может менять ленту и сообщения.",
      en: "Only the editorial office can change the feed and the messages.",
    },
    "dash.auth-required": { ru: "Сессия истекла — войдите снова.", en: "Session expired — please sign in again." },
    "dash.save-error": {
      ru: "Сервер не сохранил изменения. Проверьте права на папку data/ и перезагрузите страницу.",
      en: "The server did not save. Check the rights on the data/ folder and reload the page.",
    },
    "dash.network-error": { ru: "Сервер недоступен. Перезагрузите страницу.", en: "Server unreachable. Reload the page." },
    "dash.created": { ru: "Создан:", en: "Created:" },
    "disp.no-dispatches": { ru: "Депешей пока нет.", en: "No dispatches yet." },
    "disp.error": { ru: "Не удалось загрузить депеши.", en: "Could not load dispatches." },
    "disp.login": { ru: "Войти", en: "Sign in" },
    "disp.guest": { ru: "Гость", en: "Guest" },
    "disp.visitor-label": { ru: "Пользователь:", en: "User:" },
    "disp.title": { ru: "Депеши", en: "Dispatches" },
    "disp.no-dispatches-alt": { ru: "Депешей пока нет.", en: "No dispatches yet." },

    // zone de connexion sur la page d'accueil
    "authzone.login": { ru: "Войти", en: "Sign in" },
    "authzone.register": { ru: "Создать логин", en: "Create an account" },
    "authzone.dashboard": { ru: "Личный кабинет", en: "Dashboard" },
    "authzone.logout": { ru: "Выйти", en: "Sign out" },
    "authzone.user": { ru: (login) => `Пользователь: ${login}`, en: (login) => `User: ${login}` },
  };

  let current = DEFAULT;

  function detect() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && SUPPORTED.includes(saved)) return saved;
    } catch {}
    const nav = (navigator.language || "ru").toLowerCase();
    if (nav.startsWith("ru")) return "ru";
    if (nav.startsWith("en")) return "en";
    return DEFAULT;
  }

  function t(key, ...args) {
    const entry = dict[key];
    if (!entry) return key;
    const val = entry[current];
    if (typeof val === "function") return val(...args);
    return val != null ? val : key;
  }

  function applyNode(el) {
    const key = el.dataset && el.dataset.i18n;
    if (!key) return;
    const val = t(key);
    if (val == null) return;
    if (el.dataset.i18nHtml === "1" || /[<]/.test(val)) {
      el.innerHTML = val;
    } else {
      el.textContent = val;
    }
    const attr = el.dataset.i18nAttr;
    if (attr) {
      const attrKey = el.dataset.i18nAttrKey;
      if (attrKey) el.setAttribute(attr, t(attrKey));
    }
  }

  function applyAll(root = document) {
    root.querySelectorAll("[data-i18n]").forEach(applyNode);
    const titleKey = document.body && document.body.dataset.i18nTitle;
    if (titleKey) document.title = t(titleKey);
    document.documentElement.lang = current;
    if (window.OKNO && typeof window.OKNO.onLangChange === "function") {
      try {
        window.OKNO.onLangChange(current);
      } catch (e) {
        console.error(e);
      }
    }
  }

  function setLanguage(lang, { persist = true } = {}) {
    if (!SUPPORTED.includes(lang)) lang = DEFAULT;
    if (persist) {
      try {
        localStorage.setItem(STORAGE_KEY, lang);
      } catch {}
    }
    current = lang;
    document.querySelectorAll("[data-lang-btn]").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.langBtn === lang);
      b.setAttribute("aria-pressed", b.dataset.langBtn === lang ? "true" : "false");
    });
    applyAll();
  }

function bindExistingSwitcher(wrap) {
  wrap.querySelectorAll("[data-lang-btn]").forEach((b) => {
    const lang = b.dataset.langBtn;
    if (!SUPPORTED.includes(lang)) return;
    b.addEventListener("click", () => setLanguage(lang));
    const labelKey = lang === "ru" ? "lang.switch-ru" : "lang.switch-en";
    b.setAttribute("aria-label", t(labelKey));
    b.setAttribute("title", t(labelKey));
    const img = b.querySelector("img");
    if (img) img.alt = t(labelKey);
  });
}

function buildSwitcher() {
  const existing = document.querySelector(".lang-switch");
  if (existing) {
    bindExistingSwitcher(existing);
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "lang-switch";
  wrap.style.setProperty("position", "fixed", "important");
  wrap.style.setProperty("top", "0.7rem", "important");
  wrap.style.setProperty("right", "0.9rem", "important");
  wrap.style.setProperty("left", "auto", "important");
  wrap.style.setProperty("bottom", "auto", "important");
  wrap.style.setProperty("z-index", "10000", "important");
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", "Language / Язык");

  const mk = (lang, flag, labelKey) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "lang-btn";
    b.dataset.langBtn = lang;
    b.setAttribute("aria-label", t(labelKey));
    b.setAttribute("title", t(labelKey));
    b.addEventListener("click", () => setLanguage(lang));
    const img = document.createElement("img");
    img.src = flag;
    img.alt = t(labelKey);
    b.appendChild(img);
    return b;
  };
  wrap.appendChild(mk("ru", RU_FLAG, "lang.switch-ru"));
  wrap.appendChild(mk("en", UK_FLAG, "lang.switch-en"));
  document.body.appendChild(wrap);
}

  // ——— Rôles : un seul endroit transforme un rôle en mot visible ———
  // « editor » est le rôle administrateur du projet ; « admin » est toléré pour
  // les comptes édités à la main dans data/users.json.
  const ROLE_LABEL_KEYS = { reader: "role.reader", editor: "role.editor", admin: "role.admin" };
  const ADMIN_ROLES = ["editor", "admin"];

  function roleLabel(role) {
    const key = ROLE_LABEL_KEYS[String(role || "reader").toLowerCase()];
    return key ? t(key) : t("role.unknown", role || "?");
  }

  function isAdminRole(role) {
    return ADMIN_ROLES.includes(String(role || "").toLowerCase());
  }

  function isAdmin(user) {
    return !!user && isAdminRole(user.role);
  }

  // Un champ bilingue { ru, en } se lit dans la langue courante, avec repli.
  function loc(field) {
    if (field == null) return "";
    if (typeof field === "string") return field;
    return String(field[current] || field.ru || field.en || "");
  }

  // Expose to app.js for dynamic content
  window.OKNO = window.OKNO || {};
  window.OKNO.lang = () => current;
  window.OKNO.t = t;
  window.OKNO.setLang = setLanguage;
  window.OKNO.roleLabel = roleLabel;
  window.OKNO.isAdminRole = isAdminRole;
  window.OKNO.isAdmin = isAdmin;
  window.OKNO.loc = loc;
  window.OKNO.onLangChange = null;

  current = detect();

  function boot() {
    buildSwitcher();
    setLanguage(current, { persist: false });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
