// script.js
// Core wallet logic, physics-style shredder, FLIP reflow & advanced interactions.

const state = {
  cards: [],
  filteredIds: null,
  viewMode: "grid",
  isTouch: "ontouchstart" in window || navigator.maxTouchPoints > 0,
  dragging: null,
  rafScrollScheduled: false,
  lastScrollY: 0,
  audio: null,
};

const $grid = document.getElementById("cards-grid");
const $search = document.getElementById("search-input");
const $viewToggle = document.querySelector("[data-view-toggle]");
const $modalOverlay = document.getElementById("modal-overlay");
const $modalTitle = document.getElementById("modal-title");
const $modalSubtitle = document.getElementById("modal-subtitle");
const $modalPreview = document.getElementById("modal-card-preview");
const $qrCanvas = document.getElementById("qr-canvas");
const modalCloseEls = document.querySelectorAll("[data-modal-close]");

// Utilities
const rand = (min, max) => Math.random() * (max - min) + min;
const sample = (arr) => arr[Math.floor(Math.random() * arr.length)];

function initAudio() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  const ctx = new AudioCtx();

  function playClick() {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = 220;
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.17);
  }

  function playShred() {
    const bufferSize = 2 * ctx.sampleRate;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize / 6));
    }
    const whiteNoise = ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 800;
    const gain = ctx.createGain();
    gain.gain.value = 0.4;
    whiteNoise.connect(filter).connect(gain).connect(ctx.destination);
    whiteNoise.start();
    whiteNoise.stop(ctx.currentTime + 0.35);
  }

  function playWoosh() {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(520, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(130, ctx.currentTime + 0.25);
    gain.gain.setValueAtTime(0.16, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  }

  return { ctx, playClick, playShred, playWoosh };
}

function vibrate(pattern) {
  if ("vibrate" in navigator) {
    navigator.vibrate(pattern);
  }
}

// Data generation
const firstNames = ["Alex", "Nina", "Louis", "Camille", "Sara", "Adam", "Léa", "Ilan"];
const lastNames = ["Martin", "Durand", "Bernard", "Petit", "Roux", "Lefèvre", "Moreau", "Fournier"];
const cities = ["Paris", "Lyon", "Marseille", "Nantes", "Bordeaux", "Lille"];
const airports = ["CDG", "ORY", "LYS", "NTE", "MRS", "BCN", "FCO"];
const loyaltyBrands = ["Café Nova", "Bookstore+", "Cinema Club", "Green Coffee", "Music House"];

function createCard(id) {
  const typeRoll = id % 4;
  const base = {
    id,
    holder: `${sample(firstNames)} ${sample(lastNames)}`,
    createdAt: new Date(Date.now() - rand(0, 1000 * 60 * 60 * 24 * 45)),
  };
  if (typeRoll === 0) {
    return {
      ...base,
      type: "idf",
      title: "IDF Mobilités",
      subtitle: "Pass Navigo",
      zone: "Zones 1-5",
      line: `Ligne ${["A", "B", "C", "D"][id % 4]}`,
      kindLabel: "Transport",
    };
  }
  if (typeRoll === 1) {
    return {
      ...base,
      type: "sncf",
      title: "SNCF TGV Inoui",
      subtitle: `${sample(cities)} → ${sample(cities)}`,
      seat: `Voiture ${1 + (id % 12)}, Place ${rand(10, 80).toFixed(0)}`,
      kindLabel: "Train",
    };
  }
  if (typeRoll === 2) {
    return {
      ...base,
      type: "flight",
      title: id % 2 === 0 ? "Air France" : "Vueling",
      subtitle: `${sample(airports)} → ${sample(airports)}`,
      flight: `${id % 2 === 0 ? "AF" : "VY"}${1000 + id}`,
      kindLabel: "Vol",
    };
  }
  return {
    ...base,
    type: "loyalty",
    title: sample(loyaltyBrands),
    subtitle: "Carte Gold",
    points: 1000 + id * 7,
    kindLabel: "Fidélité",
  };
}

function formatDate(d) {
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
  });
}

// FLIP utilities
function getCardRects() {
  const rects = new Map();
  $grid.querySelectorAll(".wallet-card").forEach((el) => {
    rects.set(el.dataset.id, el.getBoundingClientRect());
  });
  return rects;
}

function animateReflow(prevRects) {
  const newRects = getCardRects();
  newRects.forEach((newRect, id) => {
    const prev = prevRects.get(id);
    const el = $grid.querySelector(`.wallet-card[data-id="${id}"]`);
    if (!prev || !el) return;
    const dx = prev.left - newRect.left;
    const dy = prev.top - newRect.top;
    if (dx || dy) {
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      el.style.transition = "none";
      requestAnimationFrame(() => {
        el.style.transform = "";
        el.style.transition = "transform 200ms cubic-bezier(0.22, 0.9, 0.24, 1)";
      });
    }
  });
}

// Rendering
function renderCard(card) {
  const el = document.createElement("article");
  el.className = `wallet-card card-type-${card.type}`;
  el.dataset.id = String(card.id);
  if (state.isTouch) {
    el.classList.add("is-touch");
  }

  el.innerHTML = `
    <div class="wallet-card-inner">
      <header class="wallet-card-header">
        <div class="wallet-card-brand">
          <h2 class="wallet-card-title">${card.title}</h2>
          <p class="wallet-card-subtitle">${card.subtitle}</p>
        </div>
        <div class="wallet-card-meta">
          <span>${formatDate(card.createdAt)}</span>
          <span>ID • ${String(card.id).padStart(4, "0")}</span>
        </div>
      </header>
      <div class="wallet-card-body">
        <div class="wallet-card-primary">
          <div class="wallet-card-main-label">${card.holder}</div>
          <div class="wallet-card-main-value">${
            card.type === "flight"
              ? card.flight
              : card.type === "sncf"
              ? card.seat
              : card.type === "idf"
              ? card.zone
              : `${card.points.toLocaleString("fr-FR")} pts`
          }</div>
        </div>
        <div class="wallet-card-secondary">
          ${
            card.type === "idf"
              ? card.line
              : card.type === "sncf"
              ? "e-billet nominatif"
              : card.type === "flight"
              ? "Boarding pass"
              : "Statut Gold"
          }
        </div>
      </div>
      <footer class="wallet-card-footer">
        <span class="pill">${card.kindLabel}</span>
        <span>${card.type === "flight" ? "QR • Boarding" : "QR • Contrôle"}</span>
      </footer>
    </div>
    <button class="icon-button card-delete-button" type="button" aria-label="Supprimer"></button>
  `;

  const delBtn = el.querySelector(".card-delete-button");
  delBtn.textContent = "✕";

  delBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    handleDeleteCard(card, el);
  });

  el.addEventListener("click", () => {
    openModal(card, el);
  });

  setupParallaxForCard(el);
  setupDragForCard(el, card);

  return el;
}

function renderAllCards() {
  const frag = document.createDocumentFragment();
  state.cards.forEach((card) => {
    if (state.filteredIds && !state.filteredIds.has(card.id)) return;
    frag.appendChild(renderCard(card));
  });
  $grid.innerHTML = "";
  $grid.appendChild(frag);
}

// Shredder effect
function handleDeleteCard(card, cardEl) {
  if (state.audio) {
    state.audio.playShred();
  }
  vibrate([10, 20, 40]);

  const idStr = String(card.id);
  const prevRects = getCardRects();

  const rect = cardEl.getBoundingClientRect();
  const cloneCanvas = document.createElement("canvas");
  cloneCanvas.width = rect.width * window.devicePixelRatio;
  cloneCanvas.height = rect.height * window.devicePixelRatio;
  const ctx = cloneCanvas.getContext("2d");
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  const html2canvasLike = () => {
    ctx.fillStyle = "#1f2933";
    ctx.fillRect(0, 0, rect.width, rect.height);
  };
  html2canvasLike();

  const stripsContainer = document.createElement("div");
  stripsContainer.className = "card-strip-container";
  const stripCount = 12;
  const stripWidth = rect.width / stripCount;

  for (let i = 0; i < stripCount; i++) {
    const strip = document.createElement("div");
    strip.className = "card-strip";
    const x = -i * stripWidth;
    strip.style.left = `${(i * 100) / stripCount}%`;
    strip.style.width = `${100 / stripCount + 0.5}%`;
    strip.style.backgroundImage = `url(${cloneCanvas.toDataURL()})`;
    strip.style.backgroundPosition = `${x}px 0`;
    const delay = i * 0.015;
    const fallDuration = 0.6 + rand(-0.12, 0.12);
    const rotate = rand(-28, 28);
    const translateX = rand(-18, 18);
    const translateY = rect.height + rand(40, 90);

    strip.style.transition = `
      transform ${fallDuration}s cubic-bezier(0.16, 0.9, 0.3, 1.1) ${delay}s,
      opacity ${fallDuration}s ease-out ${delay}s
    `;
    requestAnimationFrame(() => {
      strip.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) rotate3d(1, 0, 0, ${rotate}deg)`;
      strip.style.opacity = "0";
    });
    stripsContainer.appendChild(strip);
  }

  cardEl.style.opacity = "0";
  cardEl.appendChild(stripsContainer);

  setTimeout(() => {
    state.cards = state.cards.filter((c) => c.id !== card.id);
    if (state.filteredIds) {
      state.filteredIds.delete(card.id);
    }
    $grid.removeChild(cardEl);
    animateReflow(prevRects);
  }, 200);
}

// Modal + QR (simple pseudo-code)
function openModal(card, cardEl) {
  if (state.audio) state.audio.playClick();
  vibrate(20);

  $modalTitle.textContent = card.title;
  $modalSubtitle.textContent = `${card.subtitle} • ${card.holder}`;
  $modalPreview.innerHTML = "";
  const preview = renderCard(card);
  preview.style.transform = "none";
  preview.style.cursor = "default";
  preview.querySelector(".card-delete-button").remove();
  $modalPreview.appendChild(preview);

  drawPseudoQR(String(card.id));

  $modalOverlay.classList.add("is-visible");
  $modalOverlay.setAttribute("aria-hidden", "false");
}

function closeModal() {
  $modalOverlay.classList.remove("is-visible");
  $modalOverlay.setAttribute("aria-hidden", "true");
}

modalCloseEls.forEach((el) => el.addEventListener("click", closeModal));
$modalOverlay.addEventListener("click", (e) => {
  if (e.target.classList.contains("modal-backdrop")) closeModal();
});

function drawPseudoQR(seed) {
  const ctx = $qrCanvas.getContext("2d");
  const size = $qrCanvas.width;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, size, size);

  const gridSize = 25;
  const cell = size / gridSize;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }

  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const v = (hash + x * 374761393 + y * 668265263) & 0xffffffff;
      const on = (v & 7) > 2;
      if (on) {
        ctx.fillStyle = "#f9fafb";
        ctx.fillRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2);
      }
    }
  }
}

// Parallax / gyroscopic
function setupParallaxForCard(cardEl) {
  const maxTilt = 10;

  function updateTilt(relX, relY) {
    const tiltX = (relY - 0.5) * -maxTilt;
    const tiltY = (relX - 0.5) * maxTilt;
    cardEl.style.transform = `rotateX(${tiltX}deg) rotateY(${tiltY}deg) translateY(-2px)`;
    cardEl.style.boxShadow =
      "0 30px 60px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.3)";
    cardEl.style.setProperty("--glare-x", `${relX * 100}%`);
    cardEl.style.setProperty("--glare-y", `${relY * 100}%`);
    cardEl.classList.add("is-gyroscopic");
  }

  if (!state.isTouch) {
    cardEl.addEventListener("mousemove", (e) => {
      const rect = cardEl.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width;
      const relY = (e.clientY - rect.top) / rect.height;
      updateTilt(relX, relY);
    });
    cardEl.addEventListener("mouseleave", () => {
      cardEl.style.transform = "";
      cardEl.classList.remove("is-gyroscopic");
    });
  }
}

if (window.DeviceOrientationEvent) {
  window.addEventListener(
    "deviceorientation",
    (e) => {
      const beta = e.beta || 0;
      const gamma = e.gamma || 0;
      const relX = (gamma + 45) / 90;
      const relY = (beta + 45) / 90;
      $grid.querySelectorAll(".wallet-card").forEach((cardEl) => {
        const maxTilt = 10;
        const tiltX = (relY - 0.5) * -maxTilt;
        const tiltY = (relX - 0.5) * maxTilt;
        cardEl.style.transform = `rotateX(${tiltX}deg) rotateY(${tiltY}deg) translateY(-2px)`;
        cardEl.style.setProperty("--glare-x", `${relX * 100}%`);
        cardEl.style.setProperty("--glare-y", `${relY * 100}%`);
        cardEl.classList.add("is-gyroscopic");
      });
    },
    true
  );
}

// Drag & drop reordering (grid, FLIP-based)
function setupDragForCard(cardEl, card) {
  cardEl.style.touchAction = "none";

  const onPointerDown = (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (e.target.closest(".card-delete-button")) return;
    e.preventDefault();

    const rect = cardEl.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const offsetX = startX - rect.left;
    const offsetY = startY - rect.top;

    const ghost = cardEl.cloneNode(true);
    ghost.classList.add("is-dragging");
    ghost.style.position = "fixed";
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    ghost.style.margin = "0";
    ghost.style.pointerEvents = "none";
    ghost.style.transform = "translate3d(0,0,0)";
    document.body.appendChild(ghost);

    cardEl.classList.add("drag-origin");

    state.dragging = {
      card,
      originEl: cardEl,
      ghost,
      offsetX,
      offsetY,
    };

    if (state.audio) state.audio.playWoosh();
    vibrate(8);

    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp, { once: true });
  };

  const onPointerMove = (e) => {
    if (!state.dragging) return;
    e.preventDefault();
    const { ghost, offsetX, offsetY } = state.dragging;
    const x = e.clientX - offsetX;
    const y = e.clientY - offsetY;
    ghost.style.transform = `translate3d(${x}px, ${y}px, 0)`;

    const prevRects = getCardRects();
    const overEl = document.elementFromPoint(e.clientX, e.clientY);
    const targetCard = overEl && overEl.closest(".wallet-card");
    if (!targetCard || targetCard === state.dragging.originEl) return;

    const draggingIndex = state.cards.findIndex((c) => c.id === state.dragging.card.id);
    const targetIndex = state.cards.findIndex(
      (c) => c.id === Number(targetCard.dataset.id)
    );
    if (draggingIndex === -1 || targetIndex === -1) return;

    const [moved] = state.cards.splice(draggingIndex, 1);
    state.cards.splice(targetIndex, 0, moved);
    renderAllCards();
    animateReflow(prevRects);
  };

  const onPointerUp = () => {
    window.removeEventListener("pointermove", onPointerMove);
    if (!state.dragging) return;
    const { ghost, originEl } = state.dragging;
    const destRect = originEl.getBoundingClientRect();
    const ghostRect = ghost.getBoundingClientRect();
    const dx = destRect.left - ghostRect.left;
    const dy = destRect.top - ghostRect.top;
    ghost.style.transition =
      "transform 160ms cubic-bezier(0.22, 0.9, 0.24, 1), opacity 160ms ease-out";
    ghost.style.transform += ` translate3d(${dx}px, ${dy}px, 0)`;
    ghost.style.opacity = "0";
    setTimeout(() => {
      ghost.remove();
    }, 180);
    originEl.classList.remove("drag-origin");
    state.dragging = null;
  };

  cardEl.addEventListener("pointerdown", onPointerDown);
}

// Search + staggered filtering
function applySearchFilter(query) {
  const q = query.trim().toLowerCase();
  if (!q) {
    state.filteredIds = null;
    const prevRects = getCardRects();
    renderAllCards();
    animateReflow(prevRects);
    return;
  }

  const filtered = new Set();
  state.cards.forEach((card) => {
    const haystack = `${card.title} ${card.subtitle} ${card.holder} ${card.kindLabel}`.toLowerCase();
    if (haystack.includes(q)) {
      filtered.add(card.id);
    }
  });
  const prevRects = getCardRects();
  state.filteredIds = filtered;
  renderAllCards();

  $grid.querySelectorAll(".wallet-card").forEach((el, index) => {
    el.classList.add("is-animating-in");
    const delay = index * 22;
    setTimeout(() => {
      el.classList.add("wallet-card--enter-final");
    }, delay);
    setTimeout(() => {
      el.classList.remove("is-animating-in", "wallet-card--enter-final");
    }, delay + 260);
  });

  animateReflow(prevRects);
}

// Stack view on scroll
function handleScroll() {
  if (state.rafScrollScheduled) return;
  state.rafScrollScheduled = true;
  state.lastScrollY = window.scrollY;

  requestAnimationFrame(() => {
    const max = 220;
    const progress = Math.max(0, Math.min(1, state.lastScrollY / max));
    document.documentElement.style.setProperty("--stack-progress", String(progress));

    const cards = $grid.querySelectorAll(".wallet-card");
    cards.forEach((el, index) => {
      const depthFactor = Math.min(3, index);
      const offset = depthFactor * -10 * progress;
      const scale = 0.02 * depthFactor * progress;
      el.style.setProperty("--stack-offset", `${offset}px`);
      el.style.setProperty("--stack-scale", `${scale}`);
      if (index < 4) {
        el.classList.add("is-stacked");
      } else {
        el.classList.remove("is-stacked");
      }
    });

    state.rafScrollScheduled = false;
  });
}

// View toggle (grid/pile visual only)
if ($viewToggle) {
  $viewToggle.addEventListener("click", () => {
    state.viewMode = state.viewMode === "grid" ? "stack" : "grid";
    if (state.audio) state.audio.playClick();
    vibrate(12);
    if (state.viewMode === "stack") {
      window.scrollTo({ top: 40, behavior: "smooth" });
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });
}

// Init
function init() {
  state.audio = initAudio();
  const cards = [];
  for (let i = 0; i < 50; i++) {
    cards.push(createCard(i + 1));
  }
  state.cards = cards;
  renderAllCards();

  $search.addEventListener("input", (e) => {
    applySearchFilter(e.target.value);
  });

  window.addEventListener("scroll", handleScroll, { passive: true });
}

window.addEventListener("DOMContentLoaded", init);


