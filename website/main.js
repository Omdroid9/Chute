import "./styles.css";
import { injectLogos } from "./logos.js";

injectLogos();

const prefersReduced =
  window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- Scroll progress bar ---------- */
const progress = document.querySelector(".scroll-progress");
if (progress) {
  const updateProgress = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = max > 0 ? window.scrollY / max : 0;
    progress.style.transform = `scaleX(${ratio})`;
  };
  updateProgress();
  window.addEventListener("scroll", updateProgress, { passive: true });
}

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
  { text: "Standup notes — orb polish, onboarding fix",            time: "Tomorrow · 9:30 AM" },
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

/* ---------- Floating capture bubbles in the privacy orbit ---------- */
const privacyArt = document.querySelector(".privacy-art");
if (privacyArt && !prefersReduced) {
  const CAPTURES = [
    "Standup at 9am",
    "Email Sarah Friday",
    "Book Q3 review",
    "Idea: hotkey swap",
    "Call mom 5pm",
    "Ship beta build",
    "Read research doc",
  ];
  let cycle = 0;
  let cycleTimer = null;

  const launchBubble = () => {
    const satellites = privacyArt.querySelectorAll(".privacy-satellite");
    const center = privacyArt.querySelector(".privacy-center");
    if (!satellites.length || !center) return;
    const sat = satellites[cycle % satellites.length];

    const artRect = privacyArt.getBoundingClientRect();
    const satRect = sat.getBoundingClientRect();
    const centerRect = center.getBoundingClientRect();

    const bubble = document.createElement("div");
    bubble.className = "privacy-bubble";
    bubble.textContent = CAPTURES[cycle % CAPTURES.length];

    const startX = satRect.left - artRect.left + satRect.width / 2;
    const startY = satRect.top - artRect.top + satRect.height / 2;
    const endX = centerRect.left - artRect.left + centerRect.width / 2;
    const endY = centerRect.top - artRect.top + centerRect.height / 2;

    bubble.style.left = `${startX}px`;
    bubble.style.top = `${startY}px`;
    privacyArt.appendChild(bubble);

    requestAnimationFrame(() => {
      bubble.classList.add("is-flying");
      bubble.style.left = `${endX}px`;
      bubble.style.top = `${endY}px`;
    });

    setTimeout(() => bubble.remove(), 1700);
    cycle++;
  };

  const obs = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          if (cycleTimer) clearInterval(cycleTimer);
          launchBubble();
          cycleTimer = setInterval(launchBubble, 1600);
        } else if (cycleTimer) {
          clearInterval(cycleTimer);
          cycleTimer = null;
        }
      }
    },
    { threshold: 0.3 },
  );
  obs.observe(privacyArt);
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
      setReason("Keep typing — that's not a full email yet", null);
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
      const sub = encodeURIComponent("Chute beta — count me in");
      const body = encodeURIComponent(
        `Hi Omkar,\n\n` +
          `I'd love early access to Chute. You can reach me at ${email}.\n\n` +
          `Sent from usechute.com`,
      );
      window.location.href = `mailto:hello@usechute.com?subject=${sub}&body=${body}`;
      setReason("Your mail app just opened — hit send there and you're in", "sent");
      if (sendBtn) sendBtn.disabled = true;
      input.disabled = true;
    } catch {
      setReason("Could not open your mail app — write to hello@usechute.com", "error");
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


/* ---------- Summon band: keys press themselves when scrolled into view ---------- */
const summonBand = document.querySelector("[data-summon-band]");
if (summonBand) {
  const bandObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          summonBand.classList.add("in-view");
          bandObserver.disconnect();
        }
      }
    },
    { threshold: 0.45 },
  );
  bandObserver.observe(summonBand);
}
