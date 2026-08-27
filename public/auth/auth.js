(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const T = (key, ...args) => (window.OKNO && window.OKNO.t ? window.OKNO.t(key, ...args) : key);

  const FORM_ID = "auth-form";
  const ERROR_ID = "auth-error";
  const SUBMIT_ID = "auth-submit";
  const URLS = {
    login: "/api/auth/login",
    register: "/api/auth/register",
    me: "/api/auth/me",
    logout: "/api/auth/logout",
  };

  function errorBox(show, text) {
    const el = $("auth-error");
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("show", !!show);
  }

  function setSubmitLoading(loading) {
    const btn = $(SUBMIT_ID);
    if (!btn) return;
    btn.disabled = !!loading;
    btn.textContent = loading ? T("auth.loading") : T("auth.submit");
  }

  async function request(url, body) {
    const opts = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : null,
    };
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data && data.error ? data.error : T("auth.server-error");
      errorBox(true, msg);
      return null;
    }
    return data;
  }

  function fillForm(login, password) {
    const loginEl = $("login");
    const passEl = $("password");
    if (loginEl) loginEl.value = login || "";
    if (passEl) passEl.value = password || "";
  }

  function getForm() {
    const login = $("login")?.value || "";
    const password = $("password")?.value || "";
    const password2 = $("password2")?.value || "";
    return { login: login.trim(), password, password2: password2.trim() };
  }

  async function doLogin() {
    errorBox(false, "");
    const form = getForm();
    if (!form.login || !form.password) {
      errorBox(true, T("auth.empty-fields"));
      return;
    }
    setSubmitLoading(true);
    const data = await request(URLS.login, form);
    setSubmitLoading(false);
    if (!data || !data.ok) return;
    errorBox(true, T("auth.success"));
    setTimeout(() => {
      window.location.href = "/dashboard.html";
    }, 800);
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
    const data = await request(URLS.register, { login: form.login, password: form.password });
    setSubmitLoading(false);
    if (!data || !data.ok) return;
    if (data.user) {
      fillForm(data.user.login, "");
      setTimeout(() => {
        errorBox(true, T("register.success"));
      }, 400);
    }
  }

  function initForm() {
    const form = $("FORM_ID");
    if (!form) return;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const isRegister = form.id === "auth-form" && $("password2");
      if (isRegister) {
        doRegister();
      } else {
        doLogin();
      }
    });
  }

  function boot() {
    const isRegister = $("password2");
    initForm();
    if (isRegister && !$("login").value) {
      errorBox(false, "");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
