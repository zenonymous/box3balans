// Apply the saved theme before first paint to avoid a flash of the wrong colours.
try {
  const t = localStorage.getItem("theme");
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
} catch {
  // storage unavailable: follow the system theme
}
