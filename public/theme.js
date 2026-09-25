// Runs before first paint so a chosen or system dark theme never flashes light.
// Only a theme picked with the toggle is stored; otherwise the system decides.
// A same-origin file rather than an inline script: the CSP allows only 'self'.
(function () {
  var saved = null;
  try {
    saved = localStorage.getItem("token-econ.theme-choice");
  } catch (e) {
    /* storage blocked: follow the system */
  }
  var theme =
    saved === "light" || saved === "dark"
      ? saved
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  document.documentElement.setAttribute("data-theme", theme);
})();
