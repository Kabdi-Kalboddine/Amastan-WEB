(() => {
  const CONTACT_EMAIL = "kabdi.kalboddine@gmail.com";
  // Live classify mailbox (Durable Object Worker) — not demo Pages Functions.
  const API_BASE = "https://amastan-mailbox.kabdi-kalboddine.workers.dev";
  const api = (path) => `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  let strings = {};
  let lang = localStorage.getItem("amastan_lang") || "en";
  let theme = localStorage.getItem("amastan_theme") || "dark";

  function applyTheme(next) {
    theme = next === "light" ? "light" : "dark";
    localStorage.setItem("amastan_theme", theme);
    document.documentElement.setAttribute("data-theme", theme);
    const btn = document.getElementById("theme-toggle");
    if (btn) {
      const label = theme === "dark" ? "Dark" : "Light";
      btn.textContent = label;
      btn.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
      btn.title = label;
    }
  }

  async function loadStrings() {
    const res = await fetch(`i18n/strings.json?v=${Date.now()}`, { cache: "no-store" });
    strings = await res.json();
    applyLang(lang);
  }

  function t(key) {
    return (strings[lang] || strings.en || {})[key] ?? "";
  }

  function applyLang(next) {
    lang = next;
    localStorage.setItem("amastan_lang", lang);
    document.documentElement.lang = lang;
    document.body.classList.toggle("rtl", lang === "ar");
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      const val = t(key);
      if (val) el.textContent = val;
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const key = el.getAttribute("data-i18n-placeholder");
      const val = t(key);
      if (val) el.setAttribute("placeholder", val);
    });
    document.querySelectorAll(".lang-dropdown button[data-lang]").forEach((b) => {
      b.classList.toggle("active", b.dataset.lang === lang);
    });
    const langToggle = document.getElementById("lang-toggle");
    if (langToggle) langToggle.textContent = (lang || "en").toUpperCase();
    syncNavToggleLabel();
    syncFilmCaptions();
    if (typeof paintLabBadge === "function") paintLabBadge();
  }

  function syncFilmCaptions() {
    document.querySelectorAll("video.film-player").forEach((video) => {
      const apply = () => {
        [...video.textTracks].forEach((tr) => {
          tr.mode = tr.language === "fr" ? "showing" : "hidden";
        });
      };
      if (video.textTracks && video.textTracks.length) apply();
      else video.addEventListener("loadedmetadata", apply, { once: true });
    });
  }

  function syncNavToggleLabel() {
    const btn = document.getElementById("nav-toggle");
    if (!btn) return;
    const open = document.body.classList.contains("nav-open");
    const label = t(open ? "nav_menu_close" : "nav_menu_open") || (open ? "Close menu" : "Open menu");
    btn.setAttribute("aria-label", label);
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function setNavOpen(open) {
    document.body.classList.toggle("nav-open", open);
    const backdrop = document.getElementById("nav-backdrop");
    if (backdrop) {
      if (open) backdrop.removeAttribute("hidden");
      else backdrop.setAttribute("hidden", "");
    }
    syncNavToggleLabel();
  }

  function sendMailto(payload) {
    const subject = encodeURIComponent(
      payload.interest === "pilot"
        ? `Amastan pilot request — ${payload.company || payload.name}`
        : `[Amastan] ${payload.interest} — ${payload.company || payload.name}`,
    );
    const body = encodeURIComponent(
      `Name: ${payload.name}\nEmail: ${payload.email}\nCompany: ${payload.company || "-"}\nCountry: ${payload.country || "-"}\nInterest: ${payload.interest || "pilot"}\nLanguage: ${lang}\n\n${payload.message || "Request from the Amastan website."}\n`,
    );
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;
  }

  async function sendContactApi(payload) {
    const res = await fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ...payload, language: lang, website: payload.website || "" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      const err = new Error(data.error || "send_failed");
      err.code = data.error || "send_failed";
      throw err;
    }
    return data;
  }

  async function onSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const msg = document.getElementById("form-msg");
    const submit = form.querySelector('button[type="submit"]');
    const data = Object.fromEntries(new FormData(form).entries());
    const payload = {
      name: String(data.name || "").trim(),
      email: String(data.email || "").trim(),
      company: String(data.company || "").trim(),
      country: String(data.country || "").trim(),
      interest: String(data.interest || "pilot").trim() || "pilot",
      message: String(data.message || "").trim(),
      website: String(data.website || "").trim(),
    };
    if (!payload.name || !payload.email) {
      if (msg) {
        msg.className = "form-msg err";
        msg.textContent = t("f_err_required") || "Please fill name and email.";
      }
      return;
    }
    if (submit) {
      submit.disabled = true;
      submit.textContent = t("f_sending") || "Sending…";
    }
    if (msg) {
      msg.className = "form-msg";
      msg.textContent = "";
    }
    try {
      await sendContactApi(payload);
      if (msg) {
        msg.className = "form-msg ok";
        msg.textContent = t("f_ok") || "Message sent. We will reply by email.";
      }
      form.reset();
    } catch (err) {
      const code = err && err.code;
      if (code === "not_configured") {
        if (msg) {
          msg.className = "form-msg";
          msg.textContent = t("f_ok_mailto") || "Opening your email client…";
        }
        sendMailto(payload);
      } else if (msg) {
        msg.className = "form-msg err";
        msg.textContent =
          code === "invalid_email"
            ? t("f_err_email") || "Please enter a valid work email."
            : t("f_err") || "Could not send. Try again or email us directly.";
      }
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.textContent = t("f_submit") || "Request a pilot";
      }
    }
  }

  applyTheme(theme);

  function setLangOpen(open) {
    const menu = document.getElementById("lang-menu");
    const toggle = document.getElementById("lang-toggle");
    const dropdown = document.getElementById("lang-dropdown");
    if (!menu || !toggle || !dropdown) return;
    menu.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) dropdown.removeAttribute("hidden");
    else dropdown.setAttribute("hidden", "");
  }

  const langToggle = document.getElementById("lang-toggle");
  if (langToggle) {
    langToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = langToggle.getAttribute("aria-expanded") === "true";
      setLangOpen(!open);
    });
  }
  document.querySelectorAll(".lang-dropdown button[data-lang]").forEach((b) => {
    b.addEventListener("click", () => {
      applyLang(b.dataset.lang);
      setLangOpen(false);
    });
  });
  document.addEventListener("click", (e) => {
    const menu = document.getElementById("lang-menu");
    if (menu && !menu.contains(e.target)) setLangOpen(false);
  });

  const themeBtn = document.getElementById("theme-toggle");
  if (themeBtn) {
    themeBtn.addEventListener("click", () => {
      applyTheme(theme === "dark" ? "light" : "dark");
    });
  }

  const navToggle = document.getElementById("nav-toggle");
  if (navToggle) {
    navToggle.addEventListener("click", () => {
      setNavOpen(!document.body.classList.contains("nav-open"));
    });
  }
  const navBackdrop = document.getElementById("nav-backdrop");
  if (navBackdrop) {
    navBackdrop.addEventListener("click", () => setNavOpen(false));
  }
  document.querySelectorAll("#primary-nav a").forEach((a) => {
    a.addEventListener("click", () => setNavOpen(false));
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      setNavOpen(false);
      setLangOpen(false);
    }
  });
  window.addEventListener("resize", () => {
    if (window.matchMedia("(min-width: 1101px)").matches) setNavOpen(false);
  });

  const form = document.getElementById("contact-form");
  if (form) form.addEventListener("submit", onSubmit);

  const vm = document.getElementById("vm-request");
  if (vm) {
    vm.addEventListener("click", () => {
      /* resources.html: mailto / contact CTA. Interest=vm is on the contact form. */
    });
  }

  let labOnline = false;
  let pollGeneration = 0;
  const LIVE_POLL_MS = 1000;
  const LIVE_WAIT_MS = 120000;

  function paintLabBadge() {
    const badge = document.getElementById("lab-badge");
    if (!badge) return;
    badge.className = labOnline ? "lab-badge lab-badge-live" : "lab-badge lab-badge-demo";
    badge.textContent = t(labOnline ? "check_badge_live" : "check_badge_demo") || (labOnline ? "Live lab" : "Demo policy");
  }

  async function refreshLabHealth() {
    if (!document.getElementById("lab-badge")) return;
    try {
      const res = await fetch(api("/api/check-url/health"), { headers: { Accept: "application/json" } });
      const data = await res.json().catch(() => ({}));
      labOnline = Boolean(data.lab_online);
    } catch {
      labOnline = false;
    }
    paintLabBadge();
  }

  function setWaitOverlay(visible) {
    const el = document.getElementById("check-wait-overlay");
    if (!el) return;
    if (visible) el.removeAttribute("hidden");
    else el.setAttribute("hidden", "");
  }

  function goToVerdictPage(jobId) {
    const q = new URLSearchParams({ job: jobId });
    window.location.href = `verdict.html?${q.toString()}`;
  }

  function publicCheckPayload(data) {
    return {
      ok: data.ok,
      job_id: data.job_id,
      status: data.status,
      mode: data.mode,
      url: data.url,
      host: data.host,
      verdict: data.verdict,
      category: data.category,
      reason: data.reason,
      confidence: data.confidence,
      source: data.source,
      latency_ms: data.latency_ms,
      lab_pending: data.lab_pending,
      new_url: data.new_url,
      new_verdict: data.new_verdict,
      client: data.client && typeof data.client === "object" ? data.client : {},
      destination:
        data.destination && typeof data.destination === "object" ? data.destination : {},
    };
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function pollLiveJob(jobId, generation) {
    const deadline = Date.now() + LIVE_WAIT_MS;
    while (Date.now() < deadline) {
      if (generation !== pollGeneration) return { cancelled: true };
      const res = await fetch(api(`/api/check-url/jobs/${encodeURIComponent(jobId)}`), {
        headers: { Accept: "application/json" },
      });
      if (res.status === 404) return null;
      const data = await res.json().catch(() => ({}));
      if (data.new_verdict === true || (data.mode === "live" && data.status === "done")) {
        return data;
      }
      if (data.status === "timeout" || data.status === "error" || data.status === "demo_only") {
        return null;
      }
      await sleep(LIVE_POLL_MS);
    }
    return null;
  }

  function setCheckMsg(kind, keyOrText, asKey = true) {
    const msg = document.getElementById("check-msg");
    if (!msg) return;
    msg.hidden = false;
    msg.className = `form-msg ${kind}`;
    msg.textContent = asKey ? t(keyOrText) || keyOrText : keyOrText;
  }

  function renderCheckResult(data) {
    const panel = document.getElementById("check-result");
    const verdictEl = document.getElementById("check-verdict");
    const modeEl = document.getElementById("check-mode");
    if (!panel || !verdictEl || !modeEl) return;

    const verdict = String(data.verdict || "unknown").toLowerCase();
    verdictEl.textContent = verdict.toUpperCase();
    verdictEl.className = `check-verdict verdict-${verdict}`;

    const modeKey =
      data.mode === "live"
        ? "check_mode_live"
        : data.mode === "demo"
          ? "check_mode_demo"
          : "check_mode_pending";
    modeEl.textContent =
      t(modeKey) ||
      (data.mode === "live" ? "Live appliance" : data.mode === "demo" ? "Demo policy" : "");

    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value || "—";
    };
    const dest = data.destination || {};
    const client = data.client || {};

    set("check-meta-url", data.url);
    set("check-meta-host", data.host);
    set("check-meta-category", data.category);
    set("check-meta-reason", data.reason);
    set(
      "check-meta-confidence",
      typeof data.confidence === "number"
        ? `${Math.round(data.confidence * 1000) / 10}%`
        : data.confidence != null
          ? String(data.confidence)
          : "—",
    );
    set("check-meta-source", data.source);
    set(
      "check-meta-latency",
      typeof data.latency_ms === "number" ? `${data.latency_ms} ms` : "—",
    );
    set("check-meta-scheme", dest.scheme);
    set("check-meta-path", dest.path);
    set("check-meta-registered", dest.registered_domain);
    set(
      "check-meta-tls",
      dest.is_https === true
        ? t("check_meta_tls_yes") || "HTTPS"
        : dest.is_https === false
          ? t("check_meta_tls_no") || "HTTP"
          : "—",
    );
    set("check-meta-client-ip", client.ip);
    set("check-meta-client-country", client.country);
    set("check-meta-client-asn", client.asn);
    set("check-meta-client-colo", client.colo);

    const jsonEl = document.getElementById("check-json");
    if (jsonEl) {
      jsonEl.textContent = JSON.stringify(data, null, 2);
      jsonEl.hidden = true;
    }
    const toggle = document.getElementById("check-toggle-json");
    if (toggle) toggle.textContent = t("check_toggle_json") || "Show raw response";

    panel.hidden = false;
  }

  const checkForm = document.getElementById("check-url-form");
  if (checkForm) {
    checkForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = document.getElementById("check-url-input");
      const submit = document.getElementById("check-submit");
      const msg = document.getElementById("check-msg");
      if (!input) return;
      const url = String(input.value || "").trim();
      if (!url) {
        setCheckMsg("err", "check_err_empty");
        return;
      }
      if (msg) msg.hidden = true;
      setWaitOverlay(true);
      if (submit) {
        submit.disabled = true;
        submit.textContent = t("check_loading") || "Checking…";
      }
      try {
        const res = await fetch(api("/api/check-url"), {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ url }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 429) {
          setWaitOverlay(false);
          const key = data.error === "live_busy" ? "check_err_busy" : "check_err_rate";
          setCheckMsg("err", key);
          return;
        }
        if (res.status === 503 || data.error === "lab_offline" || data.error === "agent_unconfigured") {
          setWaitOverlay(false);
          setCheckMsg("err", data.error === "agent_unconfigured" ? "check_err_lab_offline" : "check_err_lab_offline");
          return;
        }
        if (!res.ok || !data.ok || !data.job_id) {
          setWaitOverlay(false);
          const key =
            data.error === "invalid_url"
              ? "check_err_invalid"
              : data.error === "kv_missing"
                ? "check_err_lab_offline"
                : "check_err_generic";
          setCheckMsg("err", key);
          return;
        }
        try {
          sessionStorage.setItem("amastan_check", JSON.stringify(publicCheckPayload(data)));
        } catch {
          /* ignore quota */
        }
        await sleep(700);
        goToVerdictPage(data.job_id);
        return;
      } catch {
        setWaitOverlay(false);
        setCheckMsg("err", "check_err_generic");
      } finally {
        if (submit && document.getElementById("check-wait-overlay")?.hasAttribute("hidden")) {
          submit.disabled = false;
          submit.textContent = t("check_submit") || "Get verdict";
        }
      }
    });

    document.querySelectorAll(".check-chip[data-sample]").forEach((chip) => {
      chip.addEventListener("click", () => {
        const input = document.getElementById("check-url-input");
        if (!input) return;
        input.value = chip.getAttribute("data-sample") || "";
        input.focus();
      });
    });
  }

  const toggleJson = document.getElementById("check-toggle-json");
  if (toggleJson) {
    toggleJson.addEventListener("click", () => {
      const jsonEl = document.getElementById("check-json");
      if (!jsonEl) return;
      const open = jsonEl.hidden;
      jsonEl.hidden = !open;
      toggleJson.textContent = open
        ? t("check_hide_json") || "Hide raw response"
        : t("check_toggle_json") || "Show raw response";
    });
  }

  async function runVerdictPage() {
    const waitEl = document.getElementById("verdict-wait");
    if (!waitEl) return;
    const params = new URLSearchParams(window.location.search);
    const jobId = params.get("job") || "";
    if (!jobId) {
      window.location.replace("check-url.html");
      return;
    }

    const hideWait = () => {
      waitEl.hidden = true;
    };

    const showLive = (data) => {
      hideWait();
      renderCheckResult(publicCheckPayload(data));
      fetch(api(`/api/check-url/jobs/${encodeURIComponent(jobId)}/seen`), {
        method: "POST",
        headers: { Accept: "application/json" },
      }).catch(() => {});
    };

    const showFailed = () => {
      hideWait();
      setCheckMsg("err", "check_live_timeout");
    };

    try {
      const cached = JSON.parse(sessionStorage.getItem("amastan_check") || "null");
      if (
        cached &&
        cached.job_id === jobId &&
        cached.status === "done" &&
        cached.verdict
      ) {
        showLive(cached);
        return;
      }
    } catch {
      /* ignore */
    }

    const generation = ++pollGeneration;
    const live = await pollLiveJob(jobId, generation);
    if (generation !== pollGeneration || (live && live.cancelled)) return;
    if (live) {
      showLive(live);
      return;
    }
    showFailed();
  }

  async function runCheckedHistoryPage() {
    const tbody = document.getElementById("checked-tbody");
    if (!tbody) return;

    const emptyEl = document.getElementById("checked-empty");
    const wrapEl = document.getElementById("checked-table-wrap");
    const countEl = document.getElementById("checked-count");
    const msgEl = document.getElementById("checked-msg");
    const refreshBtn = document.getElementById("checked-refresh");

    const setMsg = (kind, key) => {
      if (!msgEl) return;
      msgEl.hidden = false;
      msgEl.className = `form-msg ${kind}`;
      msgEl.textContent = t(key) || key;
    };

    const formatWhen = (ts) => {
      const n = Number(ts);
      if (!n) return "—";
      try {
        return new Date(n * 1000).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        });
      } catch {
        return "—";
      }
    };

    const render = async () => {
      if (msgEl) msgEl.hidden = true;
      if (refreshBtn) refreshBtn.disabled = true;
      try {
        const res = await fetch(api("/api/check-url/history?limit=50"), {
          headers: { Accept: "application/json" },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          setMsg("err", "checked_err");
          return;
        }
        const items = Array.isArray(data.items) ? data.items : [];
        tbody.replaceChildren();
        if (!items.length) {
          if (emptyEl) emptyEl.hidden = false;
          if (wrapEl) wrapEl.hidden = true;
          if (countEl) countEl.hidden = true;
          return;
        }
        if (emptyEl) emptyEl.hidden = true;
        if (wrapEl) wrapEl.hidden = false;
        if (countEl) {
          const tpl = t("checked_count") || "{n} hosts";
          countEl.textContent = tpl.replace("{n}", String(items.length));
          countEl.hidden = false;
        }
        const frag = document.createDocumentFragment();
        for (const item of items) {
          const tr = document.createElement("tr");
          const verdict = String(item.verdict || "unknown").toLowerCase();
          const hostTd = document.createElement("td");
          const hostSpan = document.createElement("span");
          hostSpan.className = "checked-host";
          hostSpan.textContent = item.host || "—";
          hostTd.appendChild(hostSpan);
          if (item.url) {
            const urlSpan = document.createElement("span");
            urlSpan.className = "checked-url";
            urlSpan.textContent = item.url;
            hostTd.appendChild(urlSpan);
          }
          const verdictTd = document.createElement("td");
          const badge = document.createElement("span");
          badge.className = `check-verdict verdict-${verdict}`;
          badge.textContent = verdict.toUpperCase();
          verdictTd.appendChild(badge);
          const catTd = document.createElement("td");
          catTd.textContent = item.category || "—";
          const whenTd = document.createElement("td");
          whenTd.className = "checked-when";
          whenTd.textContent = formatWhen(item.checked_at);
          const modeTd = document.createElement("td");
          modeTd.className = "checked-mode";
          modeTd.textContent = item.mode || "—";
          tr.append(hostTd, verdictTd, catTd, whenTd, modeTd);
          frag.appendChild(tr);
        }
        tbody.appendChild(frag);
      } catch {
        setMsg("err", "checked_err");
      } finally {
        if (refreshBtn) refreshBtn.disabled = false;
      }
    };

    if (refreshBtn) refreshBtn.addEventListener("click", () => render());
    await render();
  }

  const lightbox = document.getElementById("shot-lightbox");
  const lightboxImg = document.getElementById("shot-lightbox-img");
  const lightboxCaption = document.getElementById("shot-lightbox-caption");

  function closeLightbox() {
    if (!lightbox) return;
    lightbox.hidden = true;
    document.body.classList.remove("lightbox-open");
    if (lightboxImg) {
      lightboxImg.removeAttribute("src");
      lightboxImg.alt = "";
    }
    if (lightboxCaption) lightboxCaption.textContent = "";
  }

  function openLightbox(src, caption, alt) {
    if (!lightbox || !lightboxImg) return;
    lightboxImg.src = src;
    lightboxImg.alt = alt || caption || "";
    if (lightboxCaption) lightboxCaption.textContent = caption || "";
    lightbox.hidden = false;
    document.body.classList.add("lightbox-open");
  }

  document.querySelectorAll(".shot-open").forEach((btn) => {
    btn.addEventListener("click", () => {
      const src = btn.getAttribute("data-full") || "";
      const key = btn.getAttribute("data-caption-key") || "";
      const img = btn.querySelector("img");
      const caption = (key && t(key)) || (img && img.alt) || "";
      openLightbox(src, caption, (img && img.alt) || caption);
    });
  });
  const lightboxClose = document.getElementById("shot-lightbox-close");
  const lightboxBackdrop = document.getElementById("shot-lightbox-backdrop");
  if (lightboxClose) lightboxClose.addEventListener("click", closeLightbox);
  if (lightboxBackdrop) lightboxBackdrop.addEventListener("click", closeLightbox);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && lightbox && !lightbox.hidden) closeLightbox();
  });

  loadStrings().then(() => {
    refreshLabHealth();
    if (document.getElementById("lab-badge")) {
      setInterval(refreshLabHealth, 15000);
    }
    runVerdictPage();
    runCheckedHistoryPage();
  });
})();
