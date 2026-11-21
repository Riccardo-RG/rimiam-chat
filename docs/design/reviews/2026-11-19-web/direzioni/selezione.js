const options = new URLSearchParams(location.search);
const style = options.get("stile") === "voci" ? "voci" : "traccia";
const interactive = options.get("prova") === "decisione";
document.getElementById("direzione").href = style + ".css";
document.documentElement.dataset.theme = options.get("tema") === "scuro" ? "scuro" : "chiaro";
document.title = (style === "voci" ? "Voci" : "Traccia") + " · RIMIAM, studio Web";
