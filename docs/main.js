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
