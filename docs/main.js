(() => {
  const videos = Array.from(document.querySelectorAll("video.lazy-video"));
  if (videos.length === 0) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const saveData = navigator.connection?.saveData === true;
  const canAutoplay = !reduceMotion && !saveData;
  const visibleVideos = new Set();

  const loadVideo = (video) => {
    if (video.dataset.loaded === "true") return;
    video.querySelectorAll("source[data-src]").forEach((source) => {
      source.src = source.dataset.src;
      source.removeAttribute("data-src");
    });
    video.dataset.loaded = "true";
    video.load();
  };

  const playVideo = (video) => {
    if (!canAutoplay) return;
    loadVideo(video);
    video.play().catch(() => {});
  };

  if (!("IntersectionObserver" in window)) {
    loadVideo(videos[0]);
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const video = entry.target;
      if (!(video instanceof HTMLVideoElement)) return;
      if (entry.isIntersecting) {
        visibleVideos.add(video);
        playVideo(video);
      } else {
        visibleVideos.delete(video);
        video.pause();
      }
    });
  }, { rootMargin: "240px 0px", threshold: 0.2 });

  videos.forEach((video) => observer.observe(video));

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      videos.forEach((video) => video.pause());
      return;
    }
    visibleVideos.forEach((video) => playVideo(video));
  });
})();

(() => {
  const root = document.documentElement;
  const btn = document.getElementById("theme-toggle");
  const KEY = "hcb-theme";

  const prefers = window.matchMedia("(prefers-color-scheme: dark)");
  const stored = localStorage.getItem(KEY);
  const initial = stored || (prefers.matches ? "mocha" : "latte");
  root.setAttribute("data-theme", initial);

  btn?.addEventListener("click", () => {
    const next = root.getAttribute("data-theme") === "latte" ? "mocha" : "latte";
    root.setAttribute("data-theme", next);
    localStorage.setItem(KEY, next);
  });

  prefers.addEventListener("change", (e) => {
    if (localStorage.getItem(KEY)) return; // respect manual choice
    root.setAttribute("data-theme", e.matches ? "mocha" : "latte");
  });
})();

(() => {
  const modal = document.getElementById("download-modal");
  const modalCard = modal?.querySelector(".download-modal-card");
  const closeButton = modal?.querySelector(".download-modal-close");
  const continueLink = document.getElementById("download-modal-continue");
  const triggers = document.querySelectorAll("[data-download-trigger]");
  const closers = document.querySelectorAll("[data-modal-close]");
  const lazyImages = modal?.querySelectorAll("img[data-src]") ?? [];
  let lastFocusedElement = null;

  if (!modal || !continueLink || triggers.length === 0) return;

  const loadModalImages = () => {
    lazyImages.forEach((image) => {
      if (!(image instanceof HTMLImageElement) || !image.dataset.src) return;
      image.src = image.dataset.src;
      image.removeAttribute("data-src");
    });
  };

  const openModal = (downloadURL) => {
    lastFocusedElement = document.activeElement;
    continueLink.href = downloadURL;
    loadModalImages();
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    window.requestAnimationFrame(() => {
      if (modalCard instanceof HTMLElement) modalCard.scrollTop = 0;
      if (closeButton instanceof HTMLElement) closeButton.focus({ preventScroll: true });
    });
  };

  const closeModal = () => {
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    if (lastFocusedElement instanceof HTMLElement) {
      lastFocusedElement.focus();
    }
  };

  triggers.forEach((trigger) => {
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      const downloadURL = trigger.getAttribute("data-download-url");
      if (!downloadURL) return;
      openModal(downloadURL);
    });
  });

  closers.forEach((closer) => {
    closer.addEventListener("click", closeModal);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal.hidden === false) {
      closeModal();
    }
  });

  continueLink.addEventListener("click", () => {
    closeModal();
  });
})();
