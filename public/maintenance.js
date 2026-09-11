(() => {
  const buttons = [...document.querySelectorAll('[data-language]')];
  const translated = [...document.querySelectorAll('[data-ru][data-en]')];
  const date = document.querySelector('#today');

  function setLanguage(language) {
    const lang = language === 'en' ? 'en' : 'ru';
    document.documentElement.lang = lang;
    document.title = lang === 'ru' ? 'ОКНО — Технические работы' : 'OKNO — Site maintenance';

    translated.forEach((element) => {
      element.textContent = element.dataset[lang];
    });
    if (date) {
      date.textContent = new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : 'en-GB', {
        day: 'numeric', month: 'long', year: 'numeric'
      }).format(new Date());
      date.dateTime = new Date().toISOString().slice(0, 10);
    }
    buttons.forEach((button) => {
      const active = button.dataset.language === lang;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    try { localStorage.setItem('okno-language', lang); } catch (_) { /* Storage may be unavailable. */ }
  }

  buttons.forEach((button) => button.addEventListener('click', () => setLanguage(button.dataset.language)));
  let saved = 'ru';
  try { saved = localStorage.getItem('okno-language') || 'ru'; } catch (_) { /* Use Russian by default. */ }
  setLanguage(saved);
})();
