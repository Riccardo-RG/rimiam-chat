const panel = document.querySelector(".detail");
const shell = document.querySelector(".shell");
const closeButton = panel.querySelector(".close-detail");
const expandButton = panel.querySelector(".expand-detail");
const decisionRow = document.getElementById("riga-decisione");
const resultRow = document.querySelector(".work-result");
const jumpButton = document.querySelector(".jump-end");
const narrow = matchMedia("(max-width: 760px)");
let returnTo;
let expanded = false;

function syncPanel() {
  const full = panel.open && (expanded || narrow.matches);
  document.body.classList.toggle("detail-open", panel.open);
  document.body.classList.toggle("detail-wide", panel.open && expanded);
  shell.inert = full;
  panel.setAttribute("aria-modal", String(full));
  expandButton.setAttribute("aria-pressed", String(expanded));
  expandButton.textContent = expanded ? "Affianca" : "Allarga";
  updateJump();
}

function openDetail(kind, trigger) {
  returnTo = { trigger, scrollY: window.scrollY };
  const title = kind === "decisione" ? "titolo-decisione" : "titolo-brief";
  panel.setAttribute("aria-labelledby", title);
  panel.querySelector(".detail-label").textContent = kind === "decisione" ? "Decisioni" : "Lavoro di Emme";
  closeButton.setAttribute("aria-label", "Chiudi");
  for (const body of panel.querySelectorAll("[data-detail]")) {
    body.hidden = body.dataset.detail !== kind;
  }
  expanded = false;
  if (!panel.open) panel.show();
  panel.scrollTop = 0;
  syncPanel();
  closeButton.focus({ preventScroll: true });
}

function closeDetail() {
  if (!panel.open) return;
  panel.close();
  expanded = false;
  syncPanel();
  returnTo.trigger.focus({ preventScroll: true });
  window.scrollTo({ top: returnTo.scrollY, behavior: "instant" });
}

function updateJump() {
  const remaining = document.documentElement.scrollHeight - innerHeight - window.scrollY;
  jumpButton.hidden = !interactive || panel.open || remaining < 24;
}

closeButton.addEventListener("click", closeDetail);
panel.querySelector(".origin-jump").addEventListener("click", event => {
  event.preventDefault();
  closeDetail();
  const source = document.getElementById("frase-decisione");
  source.focus({ preventScroll: true });
  source.scrollIntoView({ block: "center", behavior: "instant" });
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && panel.open) {
    event.preventDefault();
    closeDetail();
  }
});
expandButton.addEventListener("click", () => {
  expanded = !expanded;
  syncPanel();
});
narrow.addEventListener("change", syncPanel);
for (const row of [decisionRow, resultRow]) {
  row.hidden = !interactive;
  row.querySelector("button").addEventListener("click", event => {
    openDetail(row === decisionRow ? "decisione" : "brief", event.currentTarget);
  });
}
document.querySelector(".ready").addEventListener("click", event => openDetail("brief", event.currentTarget));
jumpButton.addEventListener("click", () => {
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
});
window.addEventListener("scroll", updateJump, { passive: true });
window.addEventListener("resize", updateJump);
if (interactive) {
  document.fonts.ready.then(() => {
    decisionRow.scrollIntoView({ block: "center", behavior: "instant" });
    updateJump();
  });
}
