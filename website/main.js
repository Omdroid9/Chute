import "./styles.css";
import { injectLogos } from "./logos.js";

injectLogos();

const prefersReduced =
  window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- Back to top ---------- */
const backToTop = document.querySelector("[data-back-to-top]");
if (backToTop) {
  const toggleTop = () =>
    backToTop.classList.toggle("is-visible", window.scrollY > window.innerHeight);
  toggleTop();
  window.addEventListener("scroll", toggleTop, { passive: true });
  backToTop.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: prefersReduced ? "auto" : "smooth" });
  });
}

/* ---------- Nav background on scroll ---------- */
const nav = document.querySelector(".site-nav");
window.addEventListener(
  "scroll",
  () => {
    if (!nav) return;
    if (window.scrollY > 24) {
      nav.classList.add("is-scrolled");
    } else {
      nav.classList.remove("is-scrolled");
    }
  },
  { passive: true },
);

/* ---------- Scroll reveal ---------- */
const revealElements = document.querySelectorAll("[data-reveal]");
const revealObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      }
    }
  },
  { threshold: 0.15, rootMargin: "0px 0px -5% 0px" },
);
revealElements.forEach((el) => revealObserver.observe(el));

/* ---------- Staggered child reveals ---------- */
const staggerContainers = document.querySelectorAll("[data-stagger]");
const staggerObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const children = entry.target.children;
        Array.from(children).forEach((child, i) => {
          child.style.animationDelay = `${i * 90}ms`;
          child.classList.add("stagger-in");
        });
        staggerObserver.unobserve(entry.target);
      }
    }
  },
  { threshold: 0.2 },
);
staggerContainers.forEach((el) => staggerObserver.observe(el));

/* ---------- Hero word stagger on load ---------- */
window.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".hero-title .word").forEach((word, i) => {
    word.style.animationDelay = `${i * 120 + 100}ms`;
    word.classList.add("word-in");
  });
});

/* ---------- Typewriter in hero capture mockup ---------- */
// Each phrase carries the time pill that should appear with it.
// `time: null` hides the pill cleanly.
const TYPE_PHRASES = [
  { text: "Call design team tomorrow at 3pm about launch assets", time: "Tomorrow · 3:00 PM" },
  { text: "Ship beta build to testers Friday 5pm",                time: "Friday · 5:00 PM" },
  { text: "Idea: keyboard shortcut for quick tag swap",            time: null },
  { text: "Standup notes: orb polish, onboarding fix",            time: "Tomorrow · 9:30 AM" },
  { text: "Email Sarah about Q3 roadmap next Monday 10am",         time: "Mon · 10:00 AM" },
];

function runTypewriter() {
  const root = document.querySelector("[data-typewriter] .typewriter-text");
  const timeEl = document.querySelector(".mock-capture-hero .mock-time");

  const setTime = (label) => {
    if (!timeEl) return;
    if (!label) {
      timeEl.classList.add("is-changing");
      setTimeout(() => {
        timeEl.classList.add("is-hidden");
        timeEl.textContent = "";
        timeEl.classList.remove("is-changing");
      }, 200);
      return;
    }
    timeEl.classList.add("is-changing");
    setTimeout(() => {
      timeEl.classList.remove("is-hidden");
      timeEl.textContent = label;
      timeEl.classList.remove("is-changing");
    }, 200);
  };

  if (!root || prefersReduced) {
    if (root) root.textContent = TYPE_PHRASES[0].text;
    if (timeEl) timeEl.textContent = TYPE_PHRASES[0].time || "";
    if (timeEl && !TYPE_PHRASES[0].time) timeEl.classList.add("is-hidden");
    return;
  }

  let phraseIndex = 0;
  let charIndex = 0;
  let deleting = false;
  setTime(TYPE_PHRASES[0].time);

  const tick = () => {
    const phrase = TYPE_PHRASES[phraseIndex];
    if (!deleting) {
      charIndex++;
      root.textContent = phrase.text.slice(0, charIndex);
      if (charIndex >= phrase.text.length) {
        deleting = true;
        setTimeout(tick, 1800);
        return;
      }
      setTimeout(tick, 40 + Math.random() * 50);
    } else {
      charIndex--;
      root.textContent = phrase.text.slice(0, charIndex);
      // halfway through deletion, swap the time pill so it lands with the next phrase
      if (charIndex === Math.floor(phrase.text.length / 2)) {
        const nextIdx = (phraseIndex + 1) % TYPE_PHRASES.length;
        setTime(TYPE_PHRASES[nextIdx].time);
      }
      if (charIndex <= 0) {
        deleting = false;
        phraseIndex = (phraseIndex + 1) % TYPE_PHRASES.length;
        setTimeout(tick, 300);
        return;
      }
      setTimeout(tick, 18);
    }
  };

  setTimeout(tick, 900);
}
runTypewriter();

/* ---------- Magnetic buttons ---------- */
if (!prefersReduced) {
  document.querySelectorAll(".magnetic").forEach((btn) => {
    const strength = 12;
    btn.addEventListener("mousemove", (e) => {
      const rect = btn.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width - 0.5) * strength;
      const y = ((e.clientY - rect.top) / rect.height - 0.5) * strength;
      btn.style.transform = `translate(${x}px, ${y}px)`;
      const inner = btn.querySelector("span");
      if (inner) inner.style.transform = `translate(${x * 0.4}px, ${y * 0.4}px)`;
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.transform = "";
      const inner = btn.querySelector("span");
      if (inner) inner.style.transform = "";
    });
  });
}

/* ---------- Mouse tilt on product mockups ---------- */
if (!prefersReduced) {
  document.querySelectorAll(".tilt").forEach((card) => {
    const max = 8;
    card.addEventListener("mousemove", (e) => {
      const rect = card.getBoundingClientRect();
      const rx = ((e.clientY - rect.top) / rect.height - 0.5) * -max;
      const ry = ((e.clientX - rect.left) / rect.width - 0.5) * max;
      card.style.transform = `perspective(1200px) rotateX(${rx}deg) rotateY(${ry}deg)`;
    });
    card.addEventListener("mouseleave", () => {
      card.style.transform = "";
    });
  });
}

/* ---------- Animated counter ---------- */
const counters = document.querySelectorAll("[data-counter]");
const counterObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const el = entry.target;
      const target = parseInt(el.dataset.counter || "0", 10);
      const duration = 1200;
      const start = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        el.textContent = Math.round(target * eased);
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
      counterObserver.unobserve(el);
    }
  },
  { threshold: 0.5 },
);
counters.forEach((el) => counterObserver.observe(el));

/* ---------- Hotkey press + ripple chip animation ---------- */
const hotkeyKeys = document.getElementById("hotkey-keys");
const hotkeyObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const kbds = entry.target.querySelectorAll("kbd");
      kbds.forEach((k, i) => {
        setTimeout(() => {
          k.classList.add("is-pressed");
          setTimeout(() => k.classList.remove("is-pressed"), 260);
        }, i * 220);
      });
      // loop the animation while in view
      const loop = setInterval(() => {
        kbds.forEach((k, i) => {
          setTimeout(() => {
            k.classList.add("is-pressed");
            setTimeout(() => k.classList.remove("is-pressed"), 260);
          }, i * 220);
        });
      }, 3200);
      entry.target.dataset.loop = String(loop);
    }
  },
  { threshold: 0.4 },
);
if (hotkeyKeys) hotkeyObserver.observe(hotkeyKeys);

/* ---------- Chip ripple (sequential glow) on capture mockup ---------- */
const rippleContainers = document.querySelectorAll("[data-ripple-chips]");
const rippleObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const chips = entry.target.querySelectorAll(".mock-chip-on");
      const run = () => {
        chips.forEach((chip, i) => {
          setTimeout(() => {
            chip.classList.add("is-pulse");
            setTimeout(() => chip.classList.remove("is-pulse"), 700);
          }, i * 220);
        });
      };
      run();
      setInterval(run, 3800);
    }
  },
  { threshold: 0.4 },
);
rippleContainers.forEach((el) => rippleObserver.observe(el));

/* ---------- Hero "Sent to ___" toast cycle ---------- */
const heroToast = document.querySelector("[data-hero-toast]");
if (heroToast) {
  const targets = [
    { name: "Slack", color: "#36C5F0" },
    { name: "Notion", color: "#ffffff" },
    { name: "Google Calendar", color: "#4285F4" },
    { name: "Discord", color: "#5865F2" },
  ];
  let i = 0;
  const text = heroToast.querySelector(".hero-toast-text");
  const cycle = () => {
    if (prefersReduced) return;
    heroToast.classList.remove("is-in");
    setTimeout(() => {
      const t = targets[i % targets.length];
      if (text) text.innerHTML = `Sent to <strong>${t.name}</strong>`;
      heroToast.style.setProperty("--toast-accent", t.color);
      heroToast.classList.add("is-in");
      i++;
    }, 300);
  };
  setTimeout(cycle, 1800);
  setInterval(cycle, 4200);
}

/* ---------- Smart-routing "Accept" button micro-interaction ---------- */
const smartSuggest = document.querySelector("[data-smart-suggest]");
if (smartSuggest) {
  const btn = smartSuggest.querySelector(".smart-suggest-btn");
  let cycleTimer = null;
  const acceptAnim = () => {
    if (!btn || prefersReduced) return;
    btn.classList.add("is-accepting");
    setTimeout(() => btn.classList.remove("is-accepting"), 1400);
  };
  const observe = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          acceptAnim();
          cycleTimer = setInterval(acceptAnim, 4000);
        } else if (cycleTimer) {
          clearInterval(cycleTimer);
          cycleTimer = null;
        }
      }
    },
    { threshold: 0.4 },
  );
  observe.observe(smartSuggest);
}

/* ---------- History search type-and-filter ---------- */
const historySearch = document.querySelector("[data-history-search]");
if (historySearch) {
  const input = historySearch.querySelector("[data-search-input]");
  const count = historySearch.querySelector("[data-search-count]");
  const rows = historySearch.parentElement.querySelectorAll("[data-row]");
  const QUERY = "friday";

  const run = () => {
    if (prefersReduced) {
      if (input) input.textContent = QUERY;
      rows.forEach((row) => {
        const match = row.textContent.toLowerCase().includes(QUERY);
        row.classList.toggle("is-dimmed", !match);
        row.classList.toggle("is-match", match);
      });
      if (count) count.textContent = "1 result";
      return;
    }

    // Type the query
    if (input) input.textContent = "";
    rows.forEach((r) => r.classList.remove("is-dimmed", "is-match"));
    if (count) count.textContent = `${rows.length} results`;

    let ci = 0;
    const typeStep = () => {
      if (!input) return;
      ci++;
      input.textContent = QUERY.slice(0, ci);
      if (ci < QUERY.length) {
        setTimeout(typeStep, 110);
      } else {
        // After typing, filter
        setTimeout(() => {
          let matches = 0;
          rows.forEach((row) => {
            const match = row.textContent.toLowerCase().includes(QUERY);
            row.classList.toggle("is-dimmed", !match);
            row.classList.toggle("is-match", match);
            if (match) matches++;
          });
          if (count) count.textContent = `${matches} result${matches === 1 ? "" : "s"}`;
        }, 300);
      }
    };
    setTimeout(typeStep, 400);
  };

  const obs = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          run();
          obs.unobserve(entry.target);
          // re-loop every 7s
          setInterval(() => {
            rows.forEach((r) => r.classList.remove("is-dimmed", "is-match"));
            if (input) input.textContent = "";
            if (count) count.textContent = `${rows.length} results`;
            setTimeout(run, 800);
          }, 7000);
        }
      }
    },
    { threshold: 0.4 },
  );
  obs.observe(historySearch);
}

/* ---------- Page-load cinematic curtain ---------- */
window.addEventListener("load", () => {
  const curtain = document.querySelector(".page-curtain");
  if (!curtain) return;
  setTimeout(() => curtain.classList.add("is-out"), 600);
  setTimeout(() => curtain.remove(), 1500);
});

/* ---------- Cursor spotlight ---------- */
const spotlight = document.querySelector(".cursor-spotlight");
const hasFinePointer =
  typeof matchMedia === "function" && matchMedia("(pointer: fine)").matches;
if (spotlight && !prefersReduced && hasFinePointer) {
  spotlight.classList.add("is-ready");
  let rafSpot = null;
  let mx = window.innerWidth / 2;
  let my = window.innerHeight / 2;
  window.addEventListener(
    "mousemove",
    (e) => {
      mx = e.clientX;
      my = e.clientY;
      if (rafSpot) return;
      rafSpot = requestAnimationFrame(() => {
        spotlight.style.setProperty("--mx", `${mx}px`);
        spotlight.style.setProperty("--my", `${my}px`);
        rafSpot = null;
      });
    },
    { passive: true },
  );
}

/* ---------- Scroll-spy active nav ---------- */
const navLinks = document.querySelectorAll(".site-nav nav a");
const spyTargets = [];
navLinks.forEach((link) => {
  const id = (link.getAttribute("href") || "").replace("#", "");
  const section = id ? document.getElementById(id) : null;
  if (section) spyTargets.push({ link, section });
});

if (spyTargets.length) {
  const spyObs = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const item = spyTargets.find((t) => t.section === entry.target);
        if (!item) return;
        if (entry.isIntersecting) {
          navLinks.forEach((l) => l.classList.remove("is-active"));
          item.link.classList.add("is-active");
        }
      });
    },
    { rootMargin: "-35% 0px -55% 0px", threshold: 0 },
  );
  spyTargets.forEach((t) => spyObs.observe(t.section));
}

/* ---------- Click ripples on buttons ---------- */
document.addEventListener("click", (e) => {
  if (prefersReduced) return;
  const target = e.target.closest(
    ".btn, .nav-cta, .smart-suggest-btn",
  );
  if (!target) return;
  const rect = target.getBoundingClientRect();
  const ripple = document.createElement("span");
  ripple.className = "ripple";
  ripple.style.left = `${e.clientX - rect.left}px`;
  ripple.style.top = `${e.clientY - rect.top}px`;
  target.appendChild(ripple);
  setTimeout(() => ripple.remove(), 650);
});

/* ---------- Flying chip on smart-suggest accept ---------- */
const smartFly = (() => {
  const smart = document.querySelector(".section-smart .mock-capture-smart");
  if (!smart) return () => {};
  return () => {
    if (prefersReduced) return;
    const timeMark = smart.querySelector(".time-mark");
    const gcalLogo = smart.querySelector(".smart-suggest .brand-logo");
    if (!timeMark || !gcalLogo) return;

    const a = timeMark.getBoundingClientRect();
    const b = gcalLogo.getBoundingClientRect();

    const fly = document.createElement("div");
    fly.className = "fly-chip";
    fly.textContent = timeMark.textContent.trim();
    fly.style.left = `${a.left + a.width / 2}px`;
    fly.style.top = `${a.top + a.height / 2}px`;
    document.body.appendChild(fly);

    requestAnimationFrame(() => {
      fly.classList.add("is-flying");
      fly.style.left = `${b.left + b.width / 2}px`;
      fly.style.top = `${b.top + b.height / 2}px`;
    });
    setTimeout(() => fly.remove(), 950);
  };
})();

// hook into the existing smart-suggest cycle by patching the observer above
const smartBtnExisting = document.querySelector(".smart-suggest-btn");
if (smartBtnExisting) {
  const _add = smartBtnExisting.classList.add.bind(smartBtnExisting.classList);
  smartBtnExisting.classList.add = (...args) => {
    if (args.includes("is-accepting")) smartFly();
    return _add(...args);
  };
}

/* ---------- Privacy: "the boundary" ---------- */
// Captures land in "Your Mac" and stay there. Only a capture routed to a connected app
// leaves: one packet, through the panel's one door, to that one app. The other apps
// aren't connected, so they get no line and nothing ever goes to them.
const vault = document.querySelector("[data-vault]");
if (vault) {
  const list = vault.querySelector("[data-vault-list]");
  const counter = vault.querySelector("[data-vault-count]");
  const mac = vault.querySelector(".vault-mac");
  const door = vault.querySelector(".vault-door");
  const links = vault.querySelector("[data-vault-links]");
  const apps = new Map([...vault.querySelectorAll("[data-app]")].map((el) => [el.dataset.app, el]));
  const FEED = [
    { text: "call mom tomorrow at 5pm", to: "Reminders", logo: "reminders" },
    { text: "rough day. write more tomorrow", to: "Saved locally", logo: "local" },
    { text: "standup recap for the team", to: "Slack", logo: "slack", send: "slack" },
    { text: "pricing idea: charge per seat?", to: "Notes", logo: "notes" },
    { text: "renew passport before March", to: "Reminders", logo: "reminders" },
    { text: "Q4 planning outline", to: "Notion", logo: "notion", send: "notion" },
    { text: "three things that went well", to: "Saved locally", logo: "local" },
  ];
  const MAX_ROWS = 4;
  const EVERY = 2800;
  const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
  let next = 0;
  let stored = 124;
  let timer = null;

  const makeRow = (item, sent) => {
    const li = document.createElement("li");
    li.className = "vault-row";
    li.innerHTML =
      '<span class="vault-row-text"></span>' +
      `<span class="vault-tag${sent ? " is-sent" : ""}"><span class="brand-logo" data-logo="${item.logo}"></span><span class="vault-tag-label"></span></span>`;
    li.querySelector(".vault-row-text").textContent = item.text;
    li.querySelector(".vault-tag-label").textContent = item.send
      ? `${sent ? "Sent to" : "To"} ${item.to}`
      : item.to;
    injectLogos(li);
    return li;
  };

  // Geometry, in the vault's own coordinates
  const point = (el, fx, fy) => {
    const v = vault.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: r.left - v.left + r.width * fx, y: r.top - v.top + r.height * fy };
  };
  const curve = (a, b) => {
    const my = (a.y + b.y) / 2;
    return `C ${a.x} ${my}, ${b.x} ${my}, ${b.x} ${b.y}`;
  };
  // Faint lines from the door to the connected apps only
  const layout = () => {
    door.style.top = `${mac.offsetHeight}px`;
    const v = vault.getBoundingClientRect();
    links.setAttribute("viewBox", `0 0 ${v.width} ${v.height}`);
    links.replaceChildren();
    const d = point(mac, 0.5, 1);
    for (const [name, el] of apps) {
      if (!el.classList.contains("is-on")) continue;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M ${d.x} ${d.y} ${curve(d, point(el, 0.5, 0))}`);
      path.dataset.app = name;
      links.append(path);
    }
  };

  // The one way out: from the capture's tag, down to the door, along the line to the app
  const send = (li, item) => {
    const tile = apps.get(item.send);
    const from = point(li.querySelector(".vault-tag"), 0.5, 0.5);
    const d = point(mac, 0.5, 1);
    const to = point(tile, 0.5, 0);
    const packet = document.createElement("span");
    packet.className = "vault-packet";
    packet.style.offsetPath = `path("M ${from.x} ${from.y} L ${d.x} ${d.y} ${curve(d, to)}")`;
    vault.append(packet);
    const line = links.querySelector(`[data-app="${item.send}"]`);
    line?.classList.add("is-live");
    const flight = packet.animate(
      [
        { offsetDistance: "0%", opacity: 0 },
        { offsetDistance: "6%", opacity: 1, offset: 0.06 },
        { offsetDistance: "100%", opacity: 1 },
      ],
      { duration: 1100, easing: "cubic-bezier(0.45, 0, 0.2, 1)", fill: "forwards" },
    );
    flight.onfinish = () => {
      packet.remove();
      line?.classList.remove("is-live");
      const tag = li.querySelector(".vault-tag");
      tag.classList.add("is-sent");
      tag.querySelector(".vault-tag-label").textContent = `Sent to ${item.to}`;
      const status = tile.querySelector("small");
      tile.classList.add("is-receiving");
      status.textContent = "Sent by you";
      setTimeout(() => {
        tile.classList.remove("is-receiving");
        status.textContent = "Connected";
      }, 1400);
    };
  };

  // A new capture lands at the top; the rest slide down (FLIP) and the oldest drops out of view
  const land = () => {
    const item = FEED[next % FEED.length];
    next += 1;
    const before = new Map([...list.children].map((el) => [el, el.getBoundingClientRect().top]));
    const li = makeRow(item, false);
    list.prepend(li);
    li.animate([{ opacity: 0, transform: "translateY(-10px)" }, { opacity: 1, transform: "none" }],
      { duration: 450, easing: EASE });
    for (const [el, top] of before) {
      const dy = top - el.getBoundingClientRect().top;
      if (dy) el.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 450, easing: EASE });
    }
    setTimeout(() => {
      while (list.children.length > MAX_ROWS) list.lastElementChild.remove();
    }, 500);
    stored += 1;
    counter.textContent = `${stored} on this Mac`;
    if (item.send) setTimeout(() => li.isConnected && send(li, item), 650);
  };

  // Start with a few captures already there (newest first)
  for (const item of FEED.slice(0, 3).reverse()) list.append(makeRow(item, Boolean(item.send)));
  next = 3;
  layout();
  new ResizeObserver(layout).observe(vault);
  document.fonts?.ready.then(layout);

  if (!prefersReduced) {
    new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !timer) {
          timer = setInterval(land, EVERY);
        } else if (!entry.isIntersecting && timer) {
          clearInterval(timer);
          timer = null;
        }
      },
      { threshold: 0.3 },
    ).observe(vault);
  }
}

/* ---------- CTA email form ---------- */
/* ---------- CTA capture window ----------
   The form is styled as the product; the reason strip narrates state the
   same way the app explains routing. States: idle → ready → error → sent. */
const ctaForm = document.getElementById("cta-form");
if (ctaForm) {
  const input = document.getElementById("cta-email");
  const reasonText = ctaForm.querySelector("[data-cta-reason-text]");
  const sendBtn = ctaForm.querySelector(".cta-window-send");
  const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  const setReason = (text, state) => {
    if (reasonText) reasonText.textContent = text;
    ctaForm.classList.toggle("is-sent", state === "sent");
    ctaForm.classList.toggle("is-error", state === "error");
  };

  input.addEventListener("input", () => {
    const value = input.value.trim();
    if (!value) {
      setReason("Looks like an invite request → your inbox", null);
    } else if (EMAIL_OK.test(value)) {
      setReason(`Looks like an email → beta list · Enter sends`, null);
    } else {
      setReason("Keep typing, that's not a full email yet", null);
    }
  });

  ctaForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const email = input.value.trim();
    if (!EMAIL_OK.test(email)) {
      setReason("That doesn't look like an email address yet", "error");
      input.focus();
      return;
    }
    // No backend by design: hand off to the visitor's mail app, prefilled.
    // Warm, self-contained, no fill-in blanks (people just hit send) — we
    // collect OS/use-case in the reply. The typed email is captured in case
    // they send from a different account than they want us to reach.
    try {
      const sub = encodeURIComponent("Chute beta: count me in");
      const body = encodeURIComponent(
        `Hi Omkar,\n\n` +
          `I'd love early access to Chute. You can reach me at ${email}.\n\n` +
          `Sent from usechute.com`,
      );
      window.location.href = `mailto:hello@usechute.com?subject=${sub}&body=${body}`;
      setReason("Your mail app just opened. Hit send there and you're in", "sent");
      if (sendBtn) sendBtn.disabled = true;
      input.disabled = true;
    } catch {
      setReason("Could not open your mail app. Write to hello@usechute.com", "error");
    }
  });
}

/* ---------- Details grid: cycle the active tag pill ---------- */
const dvTags = document.querySelectorAll(".dv-tag");
if (dvTags.length > 0 && !prefersReduced) {
  let onIndex = 0;
  dvTags[0].classList.add("is-on");
  setInterval(() => {
    dvTags[onIndex].classList.remove("is-on");
    onIndex = (onIndex + 1) % dvTags.length;
    dvTags[onIndex].classList.add("is-on");
  }, 1600);
} else if (dvTags.length > 0) {
  dvTags[0].classList.add("is-on");
}

/* ---------- Bento card mouse spotlight ---------- */
if (!prefersReduced) {
  document.querySelectorAll(".bento-card").forEach((card) => {
    card.addEventListener("mousemove", (e) => {
      const rect = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${e.clientX - rect.left}px`);
      card.style.setProperty("--my", `${e.clientY - rect.top}px`);
    });
  });
}

/* ---------- Hero orb parallax ---------- */
const heroOrbBg = document.querySelector(".hero-orb-bg");
if (heroOrbBg && !prefersReduced) {
  window.addEventListener(
    "mousemove",
    (e) => {
      const x = (e.clientX / window.innerWidth - 0.5) * 16;
      const y = (e.clientY / window.innerHeight - 0.5) * 16;
      heroOrbBg.style.transform = `translate(${x}px, ${y}px)`;
    },
    { passive: true },
  );
}

/* ---------- Live routing demo ----------
   A vanilla-JS port of the app's intent classifier (src/lib/intent.ts) plus
   the routing precedence from captureRouting.ts: time signals, then intent,
   then the Apple Notes fallback. Keep the two in sync when signals change. */

const DEMO_IMPERATIVES = new Set([
  "apply", "ask", "backup", "book", "bring", "buy", "call", "cancel",
  "charge", "check", "clean", "collect", "complete", "deposit", "drop",
  "email", "feed", "fill", "finish", "fix", "get", "grab", "install",
  "invite", "mail", "message", "order", "pay", "pick", "practice", "print",
  "read", "refill", "register", "renew", "reply", "return", "review",
  "schedule", "sell", "send", "ship", "sign", "submit", "take", "tell",
  "text", "transfer", "update", "upgrade", "walk", "wash", "water",
]);

const DEMO_TIME_REGEX =
  /\b(tomorrow|tonight|today|at \d{1,2}(:\d{2})?\s*(am|pm)\b|\d{1,2}(:\d{2})?\s*(am|pm)\b|next (week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|every (day|week|morning|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i;
const DEMO_TASK_PHRASE =
  /\b(don'?t forget|need to|have to|has to|remember to|make sure (?:to|i|we)|to-?do)\b/i;
const DEMO_URL = /\bhttps?:\/\/|\bwww\./i;
const DEMO_NOTE_OPENER =
  /^(idea|ideas|note|notes|thought|thoughts|journal|draft|brainstorm|observation|quote)\b/i;
const DEMO_QUESTION_OPENER =
  /^(what|why|how|when|where|which|who|should|could|would|can|is|are|do|does|did)\b/i;

function demoFirstWord(text) {
  return (text.trim().split(/\s+/)[0] || "").toLowerCase().replace(/[^a-z'-]/g, "");
}

function demoLineIsAction(line) {
  const body = line.replace(/^\s*(?:- \[[ xX]?\]\s*|[-*]\s+|\d+\.\s+)/, "").trim();
  if (!body) return false;
  return (
    DEMO_TIME_REGEX.test(body) ||
    DEMO_TASK_PHRASE.test(body) ||
    DEMO_IMPERATIVES.has(demoFirstWord(body))
  );
}

function demoRoute(rawText) {
  const text = rawText.trim();
  if (!text) return null;

  const lines = text.split("\n").filter((l) => l.trim().length > 0);

  // Mixed multi-line capture → split on send
  if (lines.length >= 2) {
    const actions = lines.filter(demoLineIsAction);
    const prose = lines.length - actions.length;
    if (actions.length > 0 && prose > 0) {
      return {
        chips: ["reminders", "notes"],
        reason: `Mixed capture → <strong>${actions.length} action${actions.length === 1 ? "" : "s"} to Reminders</strong> · ${prose} line${prose === 1 ? "" : "s"} to <strong>Apple Notes</strong>`,
      };
    }
  }

  const time = text.match(DEMO_TIME_REGEX);
  if (time) {
    return {
      chips: ["reminders", "calendar"],
      reason: `Has a time (“${time[0]}”) → <strong>Reminders</strong> + <strong>Google Calendar</strong>`,
    };
  }

  const phrase = text.match(DEMO_TASK_PHRASE);
  if (phrase) {
    return {
      chips: ["reminders"],
      reason: `Looks like a to-do (says “${phrase[0].toLowerCase()}”) → <strong>Reminders</strong>`,
    };
  }

  const opener = demoFirstWord(text);
  if (
    DEMO_IMPERATIVES.has(opener) &&
    text.split(/\s+/).length >= 2 &&
    lines.length === 1 &&
    !DEMO_URL.test(text)
  ) {
    return {
      chips: ["reminders"],
      reason: `Looks like a to-do (starts with “${opener}”) → <strong>Reminders</strong>`,
    };
  }

  if (DEMO_URL.test(text)) {
    return { chips: ["notes"], reason: `Contains a link → <strong>Apple Notes</strong>` };
  }
  if (DEMO_NOTE_OPENER.test(text)) {
    return {
      chips: ["notes"],
      reason: `Looks like a note (starts with “${demoFirstWord(text)}”) → <strong>Apple Notes</strong>`,
    };
  }
  if (DEMO_QUESTION_OPENER.test(text) && text.endsWith("?")) {
    return { chips: ["notes"], reason: `Is a question → <strong>Apple Notes</strong>` };
  }
  if (lines.length >= 3 || text.length > 200) {
    return { chips: ["notes"], reason: `Long-form text → <strong>Apple Notes</strong>` };
  }

  return {
    chips: ["notes"],
    reason: `No task signal → <strong>Apple Notes</strong> (safe default)`,
  };
}

const demoInput = document.getElementById("routing-demo-input");
if (demoInput) {
  const reasonWrap = document.querySelector("[data-demo-reason]");
  const reasonText = document.querySelector("[data-demo-reason-text]");
  const chips = document.querySelectorAll("[data-demo-chip]");
  const tryBtn = document.querySelector("[data-demo-try]");
  const timePill = document.querySelector("[data-demo-time]");
  const toast = document.querySelector("[data-demo-toast]");
  const toastDest = document.querySelector("[data-demo-toast-dest]");

  const DEST_LABELS = {
    reminders: "Reminders",
    notes: "Apple Notes",
    calendar: "Calendar",
    slack: "Slack",
  };

  let toastTimer = null;

  // "Send" a finished example: pop the toast with the routed destination and
  // light up that destination in the row under the window.
  function finishExample(text) {
    const route = demoRoute(text);
    if (!route || !toast) return;
    const dest = DEST_LABELS[route.chips[0]] || "Reminders";

    toastDest.textContent = dest;
    toast.hidden = false;
    requestAnimationFrame(() => toast.classList.add("is-in"));
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-in"), 1700);
  }

  const DEMO_EXAMPLES = [
    "call the dentist tomorrow at 9am",
    "ideas for dad's 60th birthday",
    "don't forget to renew the car insurance",
    "Monday standup\n- send Sarah the final deck\n- book flights for the offsite\nfeels like pricing is the real blocker",
    "should we charge per seat or flat?",
    "buy milk on the way home at 6pm",
  ];

  let userOwnsInput = false;
  let exampleIndex = 0;
  let typeTimer = null;

  function renderRoute() {
    // No auto-grow here: the hero textarea is a fixed height (see CSS) so
    // the page below never shifts while the demo types. Longer content
    // scrolls inside the box instead of pushing the window taller.
    const route = demoRoute(demoInput.value);
    chips.forEach((chip) => {
      chip.classList.toggle(
        "is-active",
        Boolean(route && route.chips.includes(chip.dataset.demoChip)),
      );
    });
    if (route) {
      reasonText.innerHTML = route.reason;
      reasonWrap.hidden = false;
    } else {
      reasonWrap.hidden = true;
    }

    // Time pill mirrors the app: detected time surfaces on the right of the
    // chip row in tabular mono.
    if (timePill) {
      const time = demoInput.value.match(DEMO_TIME_REGEX);
      if (time) {
        timePill.textContent = time[0];
        timePill.hidden = false;
      } else {
        timePill.hidden = true;
      }
    }
  }

  function stopAutoType() {
    if (typeTimer) {
      clearTimeout(typeTimer);
      typeTimer = null;
    }
  }

  function autoTypeExample() {
    if (userOwnsInput) return;
    const phrase = DEMO_EXAMPLES[exampleIndex % DEMO_EXAMPLES.length];
    exampleIndex += 1;
    let pos = 0;

    function tick() {
      if (userOwnsInput) return;
      pos += 1;
      demoInput.value = phrase.slice(0, pos);
      renderRoute();
      if (pos < phrase.length) {
        typeTimer = setTimeout(tick, 34 + Math.random() * 40);
      } else {
        typeTimer = setTimeout(() => {
          if (userOwnsInput) return;
          finishExample(phrase);
          demoInput.value = "";
          renderRoute();
          typeTimer = setTimeout(autoTypeExample, 1100);
        }, 2600);
      }
    }
    tick();
  }

  function takeOver() {
    if (userOwnsInput) return;
    userOwnsInput = true;
    stopAutoType();
    if (toast) toast.classList.remove("is-in");
    demoInput.value = "";
    renderRoute();
    demoInput.focus();
  }

  demoInput.addEventListener("focus", takeOver);
  demoInput.addEventListener("input", () => {
    userOwnsInput = true;
    stopAutoType();
    renderRoute();
  });
  if (tryBtn) tryBtn.addEventListener("click", takeOver);

  if (prefersReduced) {
    // No animation: show a filled-in example and a static history card.
    demoInput.value = DEMO_EXAMPLES[0];
    renderRoute();
    finishExample(DEMO_EXAMPLES[1]);
    finishExample(DEMO_EXAMPLES[2]);
    if (toast) toast.classList.remove("is-in");
  } else {
    // Start typing when the demo scrolls into view.
    const demoObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            demoObserver.disconnect();
            typeTimer = setTimeout(autoTypeExample, 500);
          }
        }
      },
      { threshold: 0.4 },
    );
    demoObserver.observe(demoInput);
  }
}

/* ---------- ⌘⇧Space summon overlay ----------
   The site performs the app's gesture: the global-hotkey combo drops a
   working capture window over the page. Same brain (demoRoute), scoped
   to the overlay's own elements. The hotkey toggles, exactly like the
   real app; Esc and the backdrop dismiss. */
const summonOverlay = document.querySelector("[data-summon]");
if (summonOverlay) {
  const summonInput = summonOverlay.querySelector("[data-summon-input]");
  const summonReason = summonOverlay.querySelector("[data-summon-reason]");
  const summonReasonText = summonOverlay.querySelector("[data-summon-reason-text]");
  const summonChips = summonOverlay.querySelectorAll("[data-summon-chip]");
  const summonTime = summonOverlay.querySelector("[data-summon-time]");
  const summonOpeners = document.querySelectorAll("[data-summon-open]");
  const summonPill = summonOpeners[0] || null;
  let lastFocus = null;

  function renderSummon() {
    summonInput.style.height = "auto";
    summonInput.style.height = `${Math.min(summonInput.scrollHeight, 320)}px`;

    const route = demoRoute(summonInput.value);
    summonChips.forEach((chip) => {
      chip.classList.toggle(
        "is-active",
        Boolean(route && route.chips.includes(chip.dataset.summonChip)),
      );
    });
    if (route) {
      summonReasonText.innerHTML = route.reason;
      summonReason.hidden = false;
    } else {
      summonReason.hidden = true;
    }
    const time = summonInput.value.match(DEMO_TIME_REGEX);
    if (time) {
      summonTime.textContent = time[0];
      summonTime.hidden = false;
    } else {
      summonTime.hidden = true;
    }
  }

  // Example prompts that route to different destinations — cycled as the
  // placeholder so the sorting is discoverable, not just "everything → Notes".
  const SUMMON_EXAMPLES = [
    "call mom tomorrow at 5pm",
    "lunch with Sarah friday 1pm",
    "remind me to pay rent",
    "ideas for the launch video",
    "should we charge per seat or flat?",
  ];
  const SUMMON_DEST = { reminders: "Reminders", notes: "Apple Notes", calendar: "Calendar", slack: "Slack" };
  let placeholderTimer = null;
  let placeholderIdx = 0;
  let summonSending = false;

  function cyclePlaceholder() {
    if (summonOverlay.hidden || summonInput.value) return;
    summonInput.setAttribute("placeholder", `Try: “${SUMMON_EXAMPLES[placeholderIdx % SUMMON_EXAMPLES.length]}”`);
    placeholderIdx += 1;
  }

  // Enter "files" the capture: light the destination, flash a sent confirmation,
  // then tuck the window away — the same beat as the real app (nothing is saved).
  function fileSummon() {
    const text = summonInput.value.trim();
    if (!text || summonSending) return;
    summonSending = true;
    const route = demoRoute(text);
    const destKey = route && route.chips.length ? route.chips[0] : "notes";
    const dest = SUMMON_DEST[destKey] || "Apple Notes";
    summonChips.forEach((chip) => chip.classList.toggle("is-active", chip.dataset.summonChip === destKey));
    summonTime.hidden = true;
    summonReasonText.innerHTML = `<span class="summon-sent-check">✓</span> Sent to <strong>${dest}</strong>`;
    summonReason.hidden = false;
    summonOverlay.classList.add("is-sent");
    summonInput.blur();
    window.setTimeout(() => {
      closeSummon();
      window.setTimeout(() => {
        summonOverlay.classList.remove("is-sent");
        summonSending = false;
      }, 300);
    }, prefersReduced ? 200 : 780);
  }

  function openSummon() {
    if (!summonOverlay.hidden) return;
    lastFocus = document.activeElement;
    summonOverlay.hidden = false;
    requestAnimationFrame(() => summonOverlay.classList.add("is-open"));
    summonInput.value = "";
    summonOverlay.classList.remove("is-sent");
    summonSending = false;
    renderSummon();
    summonInput.focus();
    cyclePlaceholder();
    if (placeholderTimer) window.clearInterval(placeholderTimer);
    placeholderTimer = window.setInterval(cyclePlaceholder, 2600);
  }

  function closeSummon() {
    if (summonOverlay.hidden) return;
    summonOverlay.classList.remove("is-open");
    if (placeholderTimer) window.clearInterval(placeholderTimer);
    window.setTimeout(() => {
      summonOverlay.hidden = true;
      if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
    }, prefersReduced ? 0 : 240);
  }

  window.addEventListener("keydown", (e) => {
    const combo = (e.metaKey || e.ctrlKey) && e.shiftKey && e.code === "Space";
    if (combo) {
      e.preventDefault();
      if (summonOverlay.hidden) openSummon();
      else closeSummon();
      return;
    }
    if (e.key === "Escape" && !summonOverlay.hidden) {
      closeSummon();
    }
  });

  summonInput.addEventListener("input", renderSummon);
  summonInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      fileSummon();
    }
  });
  summonOverlay.querySelector("[data-summon-close]").addEventListener("click", closeSummon);
  summonOpeners.forEach((el) => el.addEventListener("click", openSummon));
  if (summonPill && window.matchMedia("(min-width: 900px) and (hover: hover)").matches) {
    // Desktop pointers only — the CSS hides it, but don't even unhide on touch.
    summonPill.hidden = false;
  }
}

/* ---------- Menu-bar clock: the nav doubles as a Mac menu bar ---------- */
const macTime = document.querySelector("[data-mac-time]");
if (macTime) {
  const tickClock = () => {
    const now = new Date();
    const day = now.toLocaleDateString("en-US", { weekday: "short" });
    const time = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    macTime.textContent = `${day} ${time}`;
  };
  tickClock();
  setInterval(tickClock, 30_000);
}


/* ---------- Tabler icons used by both keyboards (MIT, tabler.io/icons) ---------- */
const ICON = {
  brightnessDown: '<path d="M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"/><path d="M12 5l0 .01"/><path d="M17 7l0 .01"/><path d="M19 12l0 .01"/><path d="M17 17l0 .01"/><path d="M12 19l0 .01"/><path d="M7 17l0 .01"/><path d="M5 12l0 .01"/><path d="M7 7l0 .01"/>',
  brightnessUp: '<path d="M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"/><path d="M12 5l0 -2"/><path d="M17 7l1.4 -1.4"/><path d="M19 12l2 0"/><path d="M17 17l1.4 1.4"/><path d="M12 19l0 2"/><path d="M7 17l-1.4 1.4"/><path d="M6 12l-2 0"/><path d="M7 7l-1.4 -1.4"/>',
  table: '<path d="M3 5a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14z"/><path d="M3 10h18"/><path d="M10 3v18"/>',
  search: '<path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0"/><path d="M21 21l-6 -6"/>',
  microphone: '<path d="M9 2m0 3a3 3 0 0 1 3 -3h0a3 3 0 0 1 3 3v5a3 3 0 0 1 -3 3h0a3 3 0 0 1 -3 -3z"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M8 21l8 0"/><path d="M12 17l0 4"/>',
  moon: '<path d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454z"/>',
  trackPrev: '<path d="M21 5v14l-8 -7z"/><path d="M10 5v14l-8 -7z"/>',
  skipForward: '<path d="M4 5v14l12 -7z"/><path d="M20 5l0 14"/>',
  trackNext: '<path d="M3 5v14l8 -7z"/><path d="M14 5v14l8 -7z"/>',
  volume3: '<path d="M6 15h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l3.5 -4.5a.8 .8 0 0 1 1.5 .5v14a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5"/><path d="M16 10l4 4m0 -4l-4 4"/>',
  volume2: '<path d="M15 8a5 5 0 0 1 0 8"/><path d="M6 15h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l3.5 -4.5a.8 .8 0 0 1 1.5 .5v14a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5"/>',
  volume: '<path d="M15 8a5 5 0 0 1 0 8"/><path d="M17.7 5a9 9 0 0 1 0 14"/><path d="M6 15h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l3.5 -4.5a.8 .8 0 0 1 1.5 .5v14a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5"/>',
  world: '<path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0"/><path d="M3.6 9h16.8"/><path d="M3.6 15h16.8"/><path d="M11.5 3a17 17 0 0 0 0 18"/><path d="M12.5 3a17 17 0 0 1 0 18"/>',
  chevronUp: '<path d="M6 15l6 -6l6 6"/>',
  command: '<path d="M7 9a2 2 0 1 1 2 -2v10a2 2 0 1 1 -2 -2h10a2 2 0 1 1 -2 2v-10a2 2 0 1 1 2 2h-10"/>',
  caretUp: '<path fill="currentColor" stroke-width="0" d="M11.293 7.293a1 1 0 0 1 1.32 -.083l.094 .083l6 6l.083 .094l.054 .077l.054 .096l.017 .036l.027 .067l.032 .108l.01 .053l.01 .06l.004 .057l.002 .059l-.002 .059l-.005 .058l-.009 .06l-.01 .052l-.032 .108l-.027 .067l-.07 .132l-.065 .09l-.073 .081l-.094 .083l-.077 .054l-.096 .054l-.036 .017l-.067 .027l-.108 .032l-.053 .01l-.06 .01l-.057 .004l-.059 .002h-12c-.852 0 -1.297 -.986 -.783 -1.623l.076 -.084l6 -6z"/>',
  caretLeft: '<path fill="currentColor" stroke-width="0" d="M13.883 5.007l.058 -.005h.118l.058 .005l.06 .009l.052 .01l.108 .032l.067 .027l.132 .07l.09 .065l.081 .073l.083 .094l.054 .077l.054 .096l.017 .036l.027 .067l.032 .108l.01 .053l.01 .06l.004 .057l.002 .059v12c0 .852 -.986 1.297 -1.623 .783l-.084 -.076l-6 -6a1 1 0 0 1 -.083 -1.32l.083 -.094l6 -6l.094 -.083l.077 -.054l.096 -.054l.036 -.017l.067 -.027l.108 -.032l.053 -.01l.06 -.01z"/>',
  caretDown: '<path fill="currentColor" stroke-width="0" d="M18 9c.852 0 1.297 .986 .783 1.623l-.076 .084l-6 6a1 1 0 0 1 -1.32 .083l-.094 -.083l-6 -6l-.083 -.094l-.054 -.077l-.054 -.096l-.017 -.036l-.027 -.067l-.032 -.108l-.01 -.053l-.01 -.06l-.004 -.057v-.118l.005 -.058l.009 -.06l.01 -.052l.032 -.108l.027 -.067l.07 -.132l.065 -.09l.073 -.081l.094 -.083l.077 -.054l.096 -.054l.036 -.017l.067 -.027l.108 -.032l.053 -.01l.06 -.01l.057 -.004l12.059 -.002z"/>',
  caretRight: '<path fill="currentColor" stroke-width="0" d="M9 6c0 -.852 .986 -1.297 1.623 -.783l.084 .076l6 6a1 1 0 0 1 .083 1.32l-.083 .094l-6 6l-.094 .083l-.077 .054l-.096 .054l-.036 .017l-.067 .027l-.108 .032l-.053 .01l-.06 .01l-.057 .004l-.059 .002l-.059 -.002l-.058 -.005l-.06 -.009l-.052 -.01l-.108 -.032l-.067 -.027l-.132 -.07l-.09 -.065l-.081 -.073l-.083 -.094l-.054 -.077l-.054 -.096l-.017 -.036l-.027 -.067l-.032 -.108l-.01 -.053l-.01 -.06l-.004 -.057l-.002 -12.059z"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`;
const OPTION =
  '<svg viewBox="0 0 32 32" fill="none"><rect stroke="currentColor" stroke-width="2" x="18" y="5" width="10" height="2"/><polygon stroke="currentColor" stroke-width="2" points="10.6,5 4,5 4,7 9.4,7 18.4,27 28,27 28,25 19.6,25"/></svg>';

/* ---------- Summon band: the keyboard presses ⌘ ⇧ Space, then the bar drops ---------- */
// Keyboard = vanilla port of Aceternity UI "Keyboard": same layout and legends; keys press on
// real keystrokes (and mouse) while it's on screen, and a demo presses the Chute hotkey.
const summonBand = document.querySelector("[data-summon-band]");
const summonKeyboard = summonBand?.querySelector("[data-summon-keyboard]");
if (summonBand && summonKeyboard) {
  const key = (code, face, { cls = "", faceCls = "", wrap = "" } = {}) =>
    `<div class="lkb-wrap ${wrap}"><button type="button" tabindex="-1" class="lkb-key ${cls}"${code ? ` data-code="${code}"` : ""}><div class="lkb-face ${faceCls}">${face}</div></button></div>`;
  const one = (letter) => key(`Key${letter}`, letter);
  const pair = (code, top, bottom) => key(code, `<span>${top}</span><span>${bottom}</span>`);
  const fkey = (n, name) => key(`F${n}`, `${icon(name)}<span class="lkb-mt">F${n}</span>`);
  const mod = (code, top, bottom, cls = "", wrap = "") =>
    key(code, top + bottom, { cls: `${cls} ${wrap}`, faceCls: "is-mod", wrap });
  const row = (...keys) => `<div class="lkb-row">${keys.join("")}</div>`;
  const FN_ICONS = ["brightnessDown", "brightnessUp", "table", "search", "microphone", "moon",
    "trackPrev", "skipForward", "trackNext", "volume3", "volume2", "volume"];

  summonKeyboard.innerHTML = `<div class="lkb-pad">${[
    row(
      key("Escape", "<span>esc</span>", { cls: "w-10 tl", faceCls: "is-l", wrap: "tl" }),
      ...FN_ICONS.map((name, i) => fkey(i + 1, name)),
      key("", '<span class="lkb-power"><span></span></span>', { cls: "tr", wrap: "tr" }),
    ),
    row(
      pair("Backquote", "~", "`"),
      ...["!1", "@2", "#3", "$4", "%5", "^6", "&amp;7", "*8", "(9", ")0"].map((p, i) =>
        pair(`Digit${(i + 1) % 10}`, p.slice(0, -1), p.slice(-1)),
      ),
      pair("Minus", "_", "-"),
      pair("Equal", "+", "="),
      key("Backspace", "<span>delete</span>", { cls: "w-10", faceCls: "is-r" }),
    ),
    row(
      key("Tab", "<span>tab</span>", { cls: "w-10", faceCls: "is-l" }),
      ..."QWERTYUIOP".split("").map(one),
      pair("BracketLeft", "{", "["),
      pair("BracketRight", "}", "]"),
      pair("Backslash", "|", "\\"),
    ),
    row(
      key("CapsLock", "<span>caps lock</span>", { cls: "w-caps", faceCls: "is-l" }),
      ..."ASDFGHJKL".split("").map(one),
      pair("Semicolon", ":", ";"),
      pair("Quote", "&quot;", "'"),
      key("Enter", "<span>return</span>", { cls: "w-ret", faceCls: "is-r" }),
    ),
    row(
      key("ShiftLeft", "<span>shift</span>", { cls: "w-shift", faceCls: "is-l" }),
      ..."ZXCVBNM".split("").map(one),
      pair("Comma", "&lt;", ","),
      pair("Period", "&gt;", "."),
      pair("Slash", "?", "/"),
      key("ShiftRight", "<span>shift</span>", { cls: "w-shift", faceCls: "is-r" }),
    ),
    row(
      mod("Fn", "<span>fn</span>", icon("world"), "", "bl"),
      mod("ControlLeft", icon("chevronUp"), "<span>control</span>"),
      mod("AltLeft", OPTION, "<span>option</span>"),
      mod("MetaLeft", icon("command"), "<span>command</span>", "w-8"),
      key("Space", "", { cls: "w-space" }),
      mod("MetaRight", icon("command"), "<span>command</span>", "w-8"),
      mod("AltRight", OPTION, "<span>option</span>"),
      `<div class="lkb-arrows">${key("ArrowLeft", icon("caretLeft"))}<div class="lkb-arrows-col">${key("ArrowUp", icon("caretUp"), { cls: "h-3" })}${key("ArrowDown", icon("caretDown"), { cls: "h-3" })}</div>${key("ArrowRight", icon("caretRight"), { cls: "br", wrap: "br" })}</div>`,
    ),
  ].join("")}</div>`;

  // A key is down if the demo or the person is holding it
  const keyEls = new Map(
    [...summonKeyboard.querySelectorAll("[data-code]")].map((el) => [el.dataset.code, el]),
  );
  const demoDown = new Set();
  const realDown = new Set();
  const paint = (code) =>
    keyEls.get(code)?.classList.toggle("is-pressed", demoDown.has(code) || realDown.has(code));

  // Real keyboard + mouse, only while the keyboard is on screen (like the original)
  let onScreen = false;
  document.addEventListener("keydown", (e) => {
    if (!onScreen || e.repeat) return;
    realDown.add(e.code);
    paint(e.code);
  });
  document.addEventListener("keyup", (e) => {
    realDown.delete(e.code);
    paint(e.code);
  });
  // ⌘-chords swallow their keyups on macOS; never leave a key stuck down
  window.addEventListener("blur", () => {
    for (const code of [...realDown]) {
      realDown.delete(code);
      paint(code);
    }
  });
  summonKeyboard.addEventListener("mousedown", (e) => {
    const code = e.target.closest("[data-code]")?.dataset.code;
    if (!code) return;
    realDown.add(code);
    paint(code);
    const up = () => {
      realDown.delete(code);
      paint(code);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mouseup", up);
  });

  // Demo: ⌘ → ⇧ → Space, timed with the bar's drop in CSS (bar at 0.95s, reason at 1.3s)
  const HOTKEY = [
    ["MetaLeft", 150],
    ["ShiftLeft", 300],
    ["Space", 450],
  ];
  // The hotkey stays outlined between presses so it's always findable on the board
  for (const [code] of HOTKEY) keyEls.get(code)?.classList.add("is-hotkey");
  const RELEASE_AT = 820;
  const REPLAY_EVERY = 6500;
  let timers = [];
  let loop = null;
  const playDemo = () => {
    timers.forEach(clearTimeout);
    summonBand.classList.remove("in-view");
    void summonBand.offsetWidth; // restart the bar's CSS animations
    summonBand.classList.add("in-view");
    timers = HOTKEY.map(([code, at]) =>
      setTimeout(() => {
        demoDown.add(code);
        paint(code);
      }, at),
    );
    timers.push(
      setTimeout(() => {
        for (const [code] of HOTKEY) {
          demoDown.delete(code);
          paint(code);
        }
      }, RELEASE_AT),
    );
  };

  const bandObserver = new IntersectionObserver(
    ([entry]) => {
      onScreen = entry.isIntersecting;
      if (prefersReduced) {
        if (onScreen) summonBand.classList.add("in-view");
        return;
      }
      if (entry.intersectionRatio >= 0.45 && !loop) {
        playDemo();
        loop = setInterval(playDemo, REPLAY_EVERY);
      } else if (!onScreen && loop) {
        clearInterval(loop);
        loop = null;
      }
    },
    { threshold: [0, 0.45] },
  );
  bandObserver.observe(summonBand);
}

/* ---------- Routing board (vanilla port of Aceternity UI "Text Flipping Board") ---------- */
// A split-flap departures board in "It decides where things go": each row flips in a capture
// and where Chute sent it. Same flip mechanics, timings and colors as the original.
const flipboard = document.querySelector("[data-flipboard]");
if (flipboard) {
  const FLAP_CHARS = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$()-+&=;:'\"%,./?°";
  // Brief color flashes while scrambling (Tailwind red/orange/yellow/green/blue/violet/white)
  const ACCENTS = [
    { top: "#e7000b", bottom: "#c10007", text: "#fff" },
    { top: "#ff6900", bottom: "#f54900", text: "#fff" },
    { top: "#fdc700", bottom: "#f0b100", text: "#171717" },
    { top: "#00a63e", bottom: "#008236", text: "#fff" },
    { top: "#155dfc", bottom: "#1447e6", text: "#fff" },
    { top: "#7f22fe", bottom: "#7008e7", text: "#fff" },
    { top: "#ffffff", bottom: "#f5f5f5", text: "#171717" },
  ];
  const FACE = "#171717";
  const FALLING = "#262626";
  const INK = "#fff";
  const COL_DELAY = 30;
  const ROW_DELAY = 20;
  const STEP_MS = 55;
  const FLIP_MS = 350;
  const FALL_EASE = "cubic-bezier(0.55, 0.055, 0.675, 0.19)";
  const RISE_EASE = "cubic-bezier(0.33, 1.55, 0.64, 1)";
  const PAGE_EVERY = 7000;

  // [what was typed, where it went]: every thought fits 14 columns, every pair fits 22
  const CAPTURES = [
    ["CALL MOM 5PM", "REMINDERS"],
    ["Q3 REVIEW THU", "CALENDAR"],
    ["DEPLOY FRI", "SLACK"],
    ["PRICING IDEA", "NOTION"],
    ["BOOK FLIGHTS", "TASKS"],
    ["STRETCH AT 6", "REMINDERS"],
    ["DENTIST TUE 9", "CALENDAR"],
    ["STANDUP RECAP", "SLACK"],
    ["READING LIST", "NOTES"],
    ["RENEW PASSPORT", "TASKS"],
    ["PAY RENT FRI", "REMINDERS"],
    ["1:1 SAM 3PM", "CALENDAR"],
    ["TELL #ENG FRI", "SLACK"],
    ["GIFT IDEAS", "NOTION"],
    ["RAID SAT 9PM", "DISCORD"],
  ];
  const chunk = (list, n) =>
    Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));
  // Wide: a header row, then five captures with the destination right-aligned
  const WIDE = {
    cols: 22,
    rows: 6,
    pages: chunk(CAPTURES, 5).map((page) => [
      "CAPTURED" + " ".repeat(22 - 8 - 7) + "SENT TO",
      ...page.map(([t, d]) => t + " ".repeat(22 - t.length - d.length) + d),
    ]),
  };
  // Phones: three captures, the thought on one row and its destination under it
  const NARROW = {
    cols: 14,
    rows: 6,
    pages: chunk(CAPTURES, 3).map((page) => page.flatMap(([t, d]) => [t, d.padStart(14)])),
  };

  const grid = document.createElement("div");
  grid.className = "fb-grid";
  flipboard.append(grid);

  const glyph = (ch) => (ch === " " ? " " : ch);
  const paint = (half, ch, bg, ink) => {
    half.style.background = bg;
    half.firstChild.textContent = glyph(ch);
    half.firstChild.style.color = ink;
  };

  const makeCell = () => {
    const el = document.createElement("div");
    el.className = "fb-cell";
    el.innerHTML =
      '<div class="fb-flap"><div class="fb-hinge"><i></i><i></i><i></i></div>' +
      '<div class="fb-half fb-top"><span> </span></div>' +
      '<div class="fb-half fb-bottom"><span> </span><i class="fb-shine"></i></div>' +
      '<div class="fb-half fb-top fb-fall"><span> </span><i class="fb-shade"></i></div>' +
      '<div class="fb-half fb-bottom fb-rise"><span> </span><i class="fb-shade"></i></div>' +
      '<i class="fb-split"></i></div><div class="fb-stripes"></div>';
    const [top, bottom, fall, rise] = el.querySelectorAll(".fb-half");
    return {
      el, top, bottom, fall, rise,
      shine: bottom.querySelector(".fb-shine"),
      fallShade: fall.querySelector(".fb-shade"),
      riseShade: rise.querySelector(".fb-shade"),
      cur: " ", acc: null, target: " ", plan: null, anims: [],
    };
  };

  // One flip: the old top half falls away, the new bottom half swings up behind it
  const flip = (c, ch, acc) => {
    const prev = c.cur;
    const prevAcc = c.acc;
    c.cur = ch;
    c.acc = acc;
    paint(c.top, ch, acc?.top ?? FACE, acc?.text ?? INK);
    paint(c.bottom, ch, acc?.bottom ?? FACE, acc?.text ?? INK);
    paint(c.fall, prev, prevAcc?.top ?? FALLING, prevAcc?.text ?? INK);
    paint(c.rise, ch, acc?.bottom ?? FACE, acc?.text ?? INK);
    c.el.classList.add("is-live");
    for (const a of c.anims) a.cancel();
    const rise = { duration: FLIP_MS * 0.85, delay: FLIP_MS * 0.5, fill: "both" };
    c.anims = [
      c.fall.animate([{ transform: "rotateX(0deg)" }, { transform: "rotateX(-100deg)" }],
        { duration: FLIP_MS, easing: FALL_EASE, fill: "forwards" }),
      c.fallShade.animate([{ opacity: 0 }, { opacity: 0.6 }], { duration: FLIP_MS, fill: "forwards" }),
      c.rise.animate([{ transform: "rotateX(90deg)" }, { transform: "rotateX(0deg)" }],
        { ...rise, easing: RISE_EASE }),
      c.riseShade.animate([{ opacity: 0.4 }, { opacity: 0 }], rise),
      c.shine.animate([{ opacity: 0.5 }, { opacity: 0 }],
        { duration: FLIP_MS * 1.3, easing: "ease-out", fill: "forwards" }),
    ];
  };

  // Every scrambling cell is advanced from one animation-frame loop
  const busy = new Set();
  let raf = null;
  const tick = (now) => {
    raf = null;
    for (const c of busy) {
      const p = c.plan;
      if (now < p.nextAt) continue;
      p.i += 1;
      const last = p.i === p.count;
      const ch = last ? p.target : FLAP_CHARS[1 + Math.floor(Math.random() * (FLAP_CHARS.length - 1))];
      const acc = !last && Math.random() < 0.2
        ? ACCENTS[Math.floor(Math.random() * ACCENTS.length)]
        : null;
      flip(c, ch, acc);
      if (last) {
        c.plan = null;
        busy.delete(c);
      } else {
        p.nextAt += STEP_MS;
      }
    }
    if (busy.size) raf = requestAnimationFrame(tick);
  };

  let layout = null;
  let cells = [];
  let page = 0;
  const showPage = (rows) => {
    const t0 = performance.now();
    cells.forEach((c, idx) => {
      const r = Math.floor(idx / layout.cols);
      const col = idx % layout.cols;
      const raw = (rows[r] ?? "")[col] ?? " ";
      const target = FLAP_CHARS.includes(raw.toUpperCase()) ? raw.toUpperCase() : " ";
      if (target === c.target) return;
      c.target = target;
      if (prefersReduced) {
        c.cur = target;
        paint(c.top, target, FACE, INK);
        paint(c.bottom, target, FACE, INK);
        return;
      }
      if (target === " " && c.cur === " ") {
        c.plan = null;
        busy.delete(c);
        return;
      }
      const count = target === " "
        ? 8 + Math.floor(Math.random() * 8)
        : 25 + Math.floor(Math.random() * 15);
      c.plan = { i: 0, count, target, nextAt: t0 + col * COL_DELAY + r * ROW_DELAY };
      busy.add(c);
    });
    if (busy.size && !raf) raf = requestAnimationFrame(tick);
  };

  const narrow = window.matchMedia("(max-width: 640px)");
  let onScreen = false;
  let cycle = null;
  const startCycle = () => {
    if (cycle || prefersReduced) return;
    cycle = setInterval(() => {
      page = (page + 1) % layout.pages.length;
      showPage(layout.pages[page]);
    }, PAGE_EVERY);
  };
  const stopCycle = () => {
    clearInterval(cycle);
    cycle = null;
  };

  const build = () => {
    for (const c of cells) for (const a of c.anims) a.cancel();
    busy.clear();
    layout = narrow.matches ? NARROW : WIDE;
    flipboard.style.setProperty("--cols", layout.cols);
    cells = Array.from({ length: layout.cols * layout.rows }, makeCell);
    grid.replaceChildren(...cells.map((c) => c.el));
    page = 0;
    if (onScreen || prefersReduced) showPage(layout.pages[0]);
  };

  build();
  narrow.addEventListener("change", () => {
    stopCycle();
    build();
    if (onScreen) startCycle();
  });
  new IntersectionObserver(
    ([entry]) => {
      const wasOnScreen = onScreen;
      onScreen = entry.isIntersecting;
      if (onScreen && !wasOnScreen) {
        // first sight flips the board in from blank; later visits just resume the cycle
        if (cells.every((c) => c.target === " ")) showPage(layout.pages[page]);
        startCycle();
      } else if (!onScreen) {
        stopCycle();
      }
    },
    { threshold: 0.35 },
  ).observe(flipboard);
}

/* ---------- MacBook scroll (vanilla port of Aceternity UI "MacBook Scroll") ---------- */
const mbs = document.querySelector("[data-mbs]");
if (mbs) {
  // Keypad — same rows, key widths, legends and Tabler icons as the original <Keypad />
  const key = (face, cap = "", faceCls = "") =>
    `<div class="kb"><div class="kb-cap ${cap}"><div class="kb-face ${faceCls}">${face}</div></div></div>`;
  const one = (ch) => key(`<span>${ch}</span>`);
  const pair = (top, bottom) => key(`<span>${top}</span><span>${bottom}</span>`);
  const fkey = (name, label) => key(`${icon(name)}<span class="kb-fn-label">${label}</span>`);
  const mod = (top, bottom, cap = "", topSide = "r") =>
    key(`<div class="kb-mod-${topSide}">${top}</div><div class="kb-mod-l">${bottom}</div>`, cap, "is-mod");
  const row = (...keys) => `<div class="kb-row">${keys.join("")}</div>`;

  mbs.querySelector("[data-mbs-keypad]").innerHTML = [
    row(
      key("esc", "w-10 is-l"),
      fkey("brightnessDown", "F1"), fkey("brightnessUp", "F2"), fkey("table", "F3"),
      fkey("search", "F4"), fkey("microphone", "F5"), fkey("moon", "F6"),
      fkey("trackPrev", "F7"), fkey("skipForward", "F8"), fkey("trackNext", "F9"),
      fkey("volume3", "F10"), fkey("volume2", "F11"), fkey("volume", "F12"),
      key('<span class="kb-power"><span></span></span>'),
    ),
    row(
      key('<span>~</span><span class="kb-fn-label">`</span>'),
      pair("!", "1"), pair("@", "2"), pair("#", "3"), pair("$", "4"), pair("%", "5"),
      pair("^", "6"), pair("&amp;", "7"), pair("*", "8"), pair("(", "9"), pair(")", "0"),
      pair("_", "-"), pair("+", "="),
      key("delete", "w-10 is-r"),
    ),
    row(
      key("tab", "w-10 is-l"),
      ..."QWERTYUIOP".split("").map(one),
      pair("{", "["), pair("}", "]"), pair("|", "\\"),
    ),
    row(
      key("caps lock", "w-caps is-l"),
      ..."ASDFGHJKL".split("").map(one),
      pair(":", ";"), pair("&quot;", "'"),
      key("return", "w-ret is-r"),
    ),
    row(
      key("shift", "w-shift is-l"),
      ..."ZXCVBNM".split("").map(one),
      pair("&lt;", ","), pair("&gt;", "."), pair("?", "/"),
      key("shift", "w-shift is-r"),
    ),
    row(
      mod("<span>fn</span>", icon("world")),
      mod(icon("chevronUp"), "<span>control</span>"),
      mod(OPTION, "<span>option</span>"),
      mod(icon("command"), "<span>command</span>", "w-8"),
      key("", "w-space"),
      mod(icon("command"), "<span>command</span>", "w-8", "l"),
      mod(OPTION, "<span>option</span>", "", "l"),
      `<div class="kb-arrows">${key(icon("caretUp"), "h-3")}<div class="kb-arrows-row">${key(icon("caretLeft"), "h-3")}${key(icon("caretDown"), "h-3")}${key(icon("caretRight"), "h-3")}</div></div>`,
    ),
  ].join("");

  // Scroll: the original's useScroll({ offset: ["start start", "end start"] }) is progress 0
  // when the section's top reaches the viewport top and 1 when its bottom does (the CSS
  // "exit-crossing" range), with its clamped useTransform ranges:
  //   scaleX [0, .3] → [1.2, end], scaleY [0, .3] → [0.6, end], rotateX [.1, .12, .3] →
  //   [-28, -28, 0], translateY [0, 1] → [0, travel], title translateY [0, .3] → [0, 100px].
  // It runs as a scroll-driven animation (ViewTimeline) so the compositor moves the screen in
  // step with the scroll. Updating it from scroll events made it trail the page and judder.
  const device = mbs.querySelector("[data-mbs-device]");
  const screen = mbs.querySelector("[data-mbs-screen]");
  const title = mbs.querySelector("[data-mbs-title]");
  const map = (p, input, output) => {
    if (p <= input[0]) return output[0];
    for (let i = 1; i < input.length; i++) {
      if (p <= input[i]) {
        const t = (p - input[i - 1]) / (input[i] - input[i - 1]);
        return output[i - 1] + (output[i] - output[i - 1]) * t;
      }
    }
    return output[output.length - 1];
  };
  const docTop = (el) => {
    let y = 0;
    for (let n = el; n; n = n.offsetParent) y += n.offsetTop;
    return y;
  };
  const STOPS = [0, 0.1, 0.12, 0.3, 1]; // every bend in the ranges above, so linear tweening is exact
  const NAV_CLEAR = 88; // keep the resting screen below the floating nav pill
  const titleAt = (p) => `translateY(${map(p, [0, 0.3], [0, 100])}px)`;

  let timeline = null;
  if (!prefersReduced && typeof window.ViewTimeline === "function") {
    try {
      timeline = new ViewTimeline({ subject: mbs, axis: "block" });
    } catch {
      timeline = null;
    }
  }
  let anims = [];
  let frames = null; // what the scroll-event fallback needs: { progress, screenAt, titleAt }
  let lastWidth = 0;
  const DEVICE_H = 544; // lid (12rem) + base (22rem), before scaling
  const clamp01 = (n) => Math.min(Math.max(n, 0), 1);

  const build = () => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const mobile = vw < 768;
    lastWidth = vw;
    // Desktop ends at the original's 1.5×. On phones the screen ends as wide as it starts
    // (1.2×, the full column) rather than shrinking back to the original's 1×.
    const end = mobile ? 1.2 : 1.5;
    const widest = 512 * Math.max(1.2, end); // 1.2× at the start, `end`× once flat
    const endH = 384 * end;
    const sectionTop = docTop(mbs);
    const height = mbs.offsetHeight || 1;
    const deviceTop = docTop(device) - sectionTop; // layout position; the scale's origin is its top

    // As large as fits: across the viewport with gutters, and short enough that the flat
    // screen is fully visible (below the nav).
    const byWidth = (vw - (mobile ? 32 : 64)) / widest;
    const byHeight = (vh - NAV_CLEAR - 24) / endH;
    const s = Math.max(0.4, Math.min(1.3, byWidth, byHeight));
    mbs.style.setProperty("--mbs-s", s.toFixed(4));

    for (const a of anims) a.cancel();
    anims = [];
    frames = null;
    screen.style.transform = "";
    title.style.transform = "";
    mbs.style.marginBottom = "";
    if (prefersReduced) return; // static start pose

    let stops;
    let range;
    if (mobile) {
      // Phones: the laptop stays in one piece. While it rises from the lower part of the
      // viewport to just above the middle, the screen stays hinged at the top, tilts flat and
      // unfolds over the keyboard to the full column width, leaving the bottom of the deck
      // (trackpad edge, badge) showing. (The desktop hover left a small screen floating in a
      // long empty scroll on a phone.)
      const startD = 0.2 * vh + deviceTop; // laptop top at 80% of the viewport…
      const endD = 0.55 * vh + deviceTop + (DEVICE_H * s) / 2; // …until its middle is at 45%
      stops = [0, 0.4, 1];
      range = { rangeStart: `cover ${startD}px`, rangeEnd: `cover ${endD}px` };
      frames = {
        // distance scrolled since the section's top entered at the bottom of the viewport
        progress: () => clamp01((vh - (sectionTop - window.scrollY) - startD) / (endD - startD)),
        screenAt: (q) =>
          `translateY(0px) scaleX(${map(q, [0, 1], [1.2, end])}) ` +
          `scaleY(${map(q, [0, 1], [0.6, end])}) rotateX(${map(q, [0, 0.4, 1], [-28, -28, 0])}deg)`,
        titleAt: null,
      };
    } else {
      // Travel so the screen comes to rest centred in the viewport (clear of the nav) at
      // p = 1, and reserve room below the section so it rests over empty space.
      const restTop = Math.max(NAV_CLEAR, (vh - endH * s) / 2);
      const travel = (restTop - deviceTop + height) / s; // in the scaled device's own px
      mbs.style.marginBottom = `${Math.ceil(restTop + endH * s + 48)}px`;
      stops = STOPS;
      range = { rangeStart: "exit-crossing 0%", rangeEnd: "exit-crossing 100%" };
      frames = {
        progress: () => clamp01((window.scrollY - sectionTop) / height),
        screenAt: (p) =>
          `translateY(${map(p, [0, 1], [0, travel])}px) scaleX(${map(p, [0, 0.3], [1.2, end])}) ` +
          `scaleY(${map(p, [0, 0.3], [0.6, end])}) rotateX(${map(p, [0.1, 0.12, 0.3], [-28, -28, 0])}deg)`,
        titleAt,
      };
    }

    if (timeline) {
      try {
        const opts = { timeline, ...range, fill: "both" };
        anims.push(
          screen.animate(stops.map((o) => ({ offset: o, transform: frames.screenAt(o) })), opts),
        );
        if (frames.titleAt) {
          anims.push(
            title.animate(stops.map((o) => ({ offset: o, transform: frames.titleAt(o) })), opts),
          );
        }
        return;
      } catch {
        for (const a of anims) a.cancel();
        anims = [];
        timeline = null; // fall through to the scroll-event fallback
      }
    }
    render();
  };

  // Fallback for browsers without scroll-driven animations
  const render = () => {
    if (timeline || !frames) return;
    const p = frames.progress();
    screen.style.transform = frames.screenAt(p);
    if (frames.titleAt) title.style.transform = frames.titleAt(p);
  };

  build();
  window.addEventListener(
    "resize",
    () => {
      // Phone toolbars resize the viewport's height while scrolling; only a width change
      // (rotation, desktop window resize) needs a rebuild there.
      if (window.innerWidth === lastWidth && lastWidth < 768) return;
      build();
    },
    { passive: true },
  );
  window.addEventListener("load", build);
  document.fonts?.ready.then(build);
  if (!prefersReduced) {
    let raf = null;
    window.addEventListener(
      "scroll",
      () => {
        if (timeline || raf) return;
        raf = requestAnimationFrame(() => {
          raf = null;
          render();
        });
      },
      { passive: true },
    );
  }
}
