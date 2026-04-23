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
  const continueLink = document.getElementById("download-modal-continue");
  const triggers = document.querySelectorAll("[data-download-trigger]");
  const closers = document.querySelectorAll("[data-modal-close]");
  let lastFocusedElement = null;

  if (!modal || !continueLink || triggers.length === 0) return;

  const openModal = (downloadURL) => {
    lastFocusedElement = document.activeElement;
    continueLink.href = downloadURL;
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    window.requestAnimationFrame(() => continueLink.focus());
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
