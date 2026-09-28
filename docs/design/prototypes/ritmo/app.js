/* Design-only, scripted local interactions. No API, auth, model or persistence. */
"use strict";

const paths = {
  back: '<path d="m14 5-7 7 7 7"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  up: '<path d="M12 19V5m-6 6 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  leaf: '<path d="M5 20C5 9 10 4 20 4c0 10-5 15-12 14M5 20l9-10"/>',
  rimiam:
    '<path d="M12 3c0 6-3 9-9 9 6 0 9 3 9 9 0-6 3-9 9-9-6 0-9-3-9-9Z"/><path d="M12 8v8M8 12h8"/>',
  lens: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M9 3v18m4-12h3m-3 4h3"/>',
  goal: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="m12 12 8-8"/>',
  context:
    '<path d="M4 5h5c2 0 3 1 3 2 0-1 1-2 3-2h5v14h-5c-2 0-3 1-3 2 0-1-1-2-3-2H4Zm8 2v14"/>',
  work: '<rect x="4" y="7" width="16" height="13" rx="2"/><path d="M8 7V4h8v3M4 12c5 3 11 3 16 0m-8 1v3"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Zm0 0v6h6M8 13h8m-8 4h5"/>',
  people:
    '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-15a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2"/>',
  mic: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-3 0h6"/>',
  wave: '<path d="M4 10v4m4-8v12m4-15v18m4-15v12m4-8v4"/>',
  call: '<path d="m8 3 3 5-3 3c2 3 3 4 6 5l3-3 4 3c0 4-2 5-5 5C9 20 4 15 3 8c0-3 1-5 5-5Z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="m8 4 12 8-12 8Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
  calendar:
    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2"/>',
  thread:
    '<path d="M5 3v12a4 4 0 0 0 4 4h10M5 8h14m-4-4 4 4-4 4m0 3 4 4-4 4"/>',
  pin: '<path d="m8 3 8 0-1 6 4 4H5l4-4Zm4 10v8"/>',
  shield:
    '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.file}</svg>`;
const escapeHTML = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const people = { riccardo: "Riccardo", giulia: "Giulia" };
const state = {
  platform: "ios",
  scene: "conversation",
  page: "workspace",
  person: "riccardo",
  work: "idle",
  version: 1,
  contractVersion: 1,
  conflict: false,
  hadConflict: false,
  withdrawn: [],
  scope: "full",
  initiatedBy: "riccardo",
  focus: false,
  stream: "active",
  streamVersion: 1,
  contractExtra: false,
  draft: "",
  extraMessages: [],
  events: [],
  detail: null,
  backStack: [],
  pinned: false,
  workspace: "RIMIAM · Prima beta",
  introduction: null,
  created: false,
  creationPerson: "riccardo",
  outdated: false,
};
const app = document.getElementById("app");
const device = document.getElementById("device");
const dialog = document.getElementById("detail");
const studio = document.getElementById("studio");
const announce = (text) => {
  document.getElementById("announcement").textContent = text;
};
const button = (action, label, kind = "text-link", svg = "") =>
  `<button type="button" class="${kind}" data-action="${action}">${svg ? icon(svg) : ""}${label}</button>`;
const avatar = (person, self = false) =>
  `<span class="avatar ${person === "giulia" ? "giulia" : self ? "me" : ""}" aria-hidden="true">${person === "giulia" ? "G" : "R"}</span>`;
const badge = (text, kind = "") => `<span class="badge ${kind}">${text}</span>`;

function human(person, text, time = "10:42", attachment = false) {
  const self = person === state.person;
  return `<article class="message ${self ? "self" : "human"}"><div class="message-meta">${avatar(person, self)}<span class="message-author">${people[person]}${self ? " · tu" : ""}</span><time>${time}</time></div><p>${text}</p>${attachment ? `<button type="button" class="attached-source" data-action="source"><span class="file-icon">${icon("file")}</span><span><strong>Stima costi beta · esempio.pdf</strong><small>Caricato da Giulia · documento originale</small></span></button>` : ""}</article>`;
}
function rimiam(body, time = "10:44") {
  return `<article class="message rimiam"><div class="message-meta"><span class="rimiam-mark">${icon("rimiam")}</span><span class="message-author">RIMIAM</span><time>${time}</time></div><div class="rimiam-body">${body}</div></article>`;
}
function currentStatus() {
  if (state.conflict && state.work === "paused")
    return "In pausa · perimetro da chiarire";
  if (state.conflict && state.work === "stopped")
    return "Fermato · indicazioni da chiarire";
  if (state.work === "stopped") return "Lavoro fermato";
  if (state.work === "paused") return "Lavoro in pausa";
  if (state.conflict) return "Serve un chiarimento";
  if (state.outdated) return "Risultato da ricontrollare";
  if (state.work === "completed") return "Il confronto è pronto";
  return "Confronto della prima beta in corso";
}
function activity() {
  if (state.work === "idle") return "";
  return `<button type="button" class="activity-strip ${state.conflict || state.outdated ? "conflict" : ""}" data-action="work"><span class="activity-dot"></span><span>${currentStatus()}</span>${icon("arrow")}</button>`;
}
function workCard() {
  const conflict = state.conflict;
  const completed = state.work === "completed";
  return `<section class="work-card ${conflict ? "conflicted" : ""}"><div class="work-inner"><span class="eyebrow">${icon(conflict ? "pause" : completed ? "file" : "work")}${conflict ? "INDICAZIONI DA CHIARIRE" : completed ? "CONTRIBUTO · NON ADOTTATO" : "LAVORO CONDIVISO"}</span><h3>${conflict ? "Quali costi confrontiamo?" : "La prima beta, a confronto."}</h3><p>${conflict ? "Solo servizi oppure anche tempo di supporto? Il confronto aspetta un chiarimento sul perimetro." : completed ? "10 o 50 gruppi: costi stimati, supporto e ipotesi da verificare." : "Parto dai documenti condivisi. Segnalerò separatamente i dati mancanti."}</p></div><button type="button" class="work-card-footer" data-action="${conflict ? "conflict" : completed ? "result" : "work"}">${conflict ? "Vedi le due indicazioni" : completed ? "Leggi il confronto" : "Vedi perimetro e fonti"}${icon("arrow")}</button></section>`;
}
function conversationContent() {
  if (state.created) {
    return `<div class="day-divider">Oggi · un nuovo spazio</div>${state.introduction ? human(state.creationPerson, escapeHTML(state.introduction), "Adesso") : ""}${rimiam('<p>Questo è il vostro spazio. Potete partire da ciò che volete esplorare insieme.</p><p class="context-note">Messaggio di benvenuto · non generato da un modello</p>', "Adesso")}${extraMessages()}`;
  }
  let result = `<div class="day-divider">Oggi, 13 settembre</div>`;
  if (!state.focus)
    result += human(
      "giulia",
      "Vorrei che la prima beta ci dicesse se le persone tornano perché RIMIAM le aiuta davvero a portare avanti un progetto.",
      "10:38",
    );
  result += human(
    "giulia",
    "Ho condiviso una prima stima: 150 € al mese di servizi per una beta con 10 gruppi. Il consumo AI è ancora da verificare.",
    "10:41",
    true,
  );
  result += human(
    "riccardo",
    "RIMIAM, da dove partiamo per la prima beta?",
    "10:43",
  );
  if (state.work === "idle") {
    result += rimiam(
      `<p>State valutando una beta con <strong>10 gruppi</strong> oppure <strong>50 gruppi</strong>. Nel documento ci sono <button class="reference" data-action="source" type="button">150 €/mese stimati</button> per la prima; Giulia ipotizza circa 500 € per la seconda.</p><p>Mancano due dati: quanto useranno l’AI e quanto tempo servirà per seguirli. Posso confrontare ciò che sappiamo, lasciando aperte queste ipotesi.</p><button type="button" class="source-chip" data-action="context">${icon("context")}1 documento · 1 stima attribuita</button><div class="suggestion-row">${button("start", "Confronta i due scenari", "", "arrow")}</div>`,
    );
  } else {
    result += human(
      state.initiatedBy,
      "Confronta i due scenari usando quello che abbiamo condiviso. Evidenzia cosa manca.",
      "10:45",
    );
    if (state.hadConflict) {
      result += human(
        "riccardo",
        "Limita il confronto ai costi dei servizi: escludi il tempo di supporto.",
        "10:47",
      );
      result += human(
        "giulia",
        "Nel confronto deve esserci anche il tempo per supporto e feedback.",
        "10:48",
      );
      result += rimiam(
        `<p>Le indicazioni sul perimetro sono diverse. Ho conservato entrambe e sospeso il confronto; nessuna sostituisce automaticamente l’altra.</p>${workCard()}`,
        "10:48",
      );
    }
    if (!state.hadConflict && state.work === "completed") {
      result += rimiam(
        `<p>La beta con 10 gruppi sembra più gestibile per imparare dai primi utilizzi. È una raccomandazione: costi reali e tempo di supporto restano da misurare.</p>${workCard()}${state.outdated ? '<p class="context-note">Una fonte è cambiata dopo il completamento: il risultato va ricontrollato.</p>' : ""}`,
        "10:49",
      );
    } else if (!state.hadConflict) {
      result += rimiam(
        `<p>Confronto costi stimati, supporto e punti da verificare nei materiali condivisi. Non invito utenti né attivo servizi.</p>${workCard()}`,
        "10:45",
      );
    }
  }
  result += extraMessages();
  return result;
}
function extraMessages() {
  return state.extraMessages
    .map((m) =>
      m.kind === "notice"
        ? rimiam(
            `<p>${escapeHTML(m.text)}</p><p class="context-note">Risposta illustrativa del prototipo</p>`,
            "Adesso",
          )
        : human(m.person, escapeHTML(m.text), "Adesso"),
    )
    .join("");
}
function homeHTML() {
  return `<header class="home-header"><span class="wordmark">rimiam</span><span class="web-nav">I tuoi spazi</span>${button("account", avatar(state.person, true), "icon-btn")}</header><div class="home-scroll"><span class="eyebrow">CIAO, ${people[state.person].toUpperCase()}</span><h1>Le cose che<br />state costruendo.</h1><p class="home-intro">Uno spazio per ogni intenzione.<br />Un filo da riprendere, insieme.</p><div class="section-label"><h2>I tuoi spazi</h2>${button("create", "Nuovo spazio", "text-link", "plus")}</div><button type="button" class="workspace-card" data-action="enter"><span class="workspace-art">${icon("leaf")}</span><h3>${escapeHTML(state.workspace)}</h3><p>${state.created ? "Il primo passo, insieme." : "Dall’idea ai primi utenti. Costruiamo RIMIAM, insieme."}</p><span class="card-foot"><span class="avatar-stack">${avatar(state.created ? state.creationPerson : "riccardo")}${state.created ? "" : avatar("giulia")}</span><span>${state.created ? "Appena creato" : "Riprendi la conversazione"} ↗</span></span></button><button type="button" class="invitation-entry" data-action="invitations">${icon("mail")}<span>Inviti</span><span class="muted">Nessuno in attesa</span></button><div class="home-footer">${icon("shield")}Ogni spazio ha la sua conversazione e la sua storia.</div></div>`;
}
function workspaceHTML() {
  return `<header class="workspace-header">${button("home", '<span class="sr-only">I tuoi spazi</span>', "icon-btn", "back")}<div class="workspace-name"><h1>${escapeHTML(state.workspace)}</h1><button type="button" data-action="people">${state.created ? "Solo tu, per ora" : "Tu e " + people[state.person === "riccardo" ? "giulia" : "riccardo"]}${icon("down")}</button></div>${button("lens", "Lo spazio", "lens-entry", "lens")}</header><div class="workspace-body"><section class="conversation-column" aria-label="Conversazione dello Workspace">${activity()}${state.focus ? `<div class="focus-strip">${icon("thread")}<span>Filone · Il lancio della beta</span>${button("unfocus", "Tutta la conversazione", "")}</div>` : ""}<div class="conversation" id="conversation">${conversationContent()}</div><div class="composer-area"><form class="composer" id="composer"><label class="sr-only" for="message">Messaggio nella conversazione condivisa</label><textarea id="message" rows="1" placeholder="Continuiamo da qui…" maxlength="2000">${escapeHTML(state.draft)}</textarea><div class="composer-tools">${button("attach", '<span class="sr-only">Aggiungi una fonte</span>', "icon-btn", "plus")}${button("voice", '<span class="sr-only">Messaggio vocale</span>', "icon-btn", "mic")}<span class="composer-context">${state.focus ? "Nello stesso spazio" : "Nella conversazione"}</span>${button("voice-dialogue", '<span class="sr-only">Parla con RIMIAM</span>', "icon-btn", "wave")}<button type="submit" class="icon-btn send" aria-label="Invia il messaggio nell’anteprima">${icon("up")}</button></div></form><div class="composer-footer">${icon("rimiam")}RIMIAM interviene quando la chiami.</div></div></section><aside class="dock ${state.pinned && state.platform === "web" ? "visible" : ""}" id="dock" aria-label="Dettaglio dello spazio"></aside></div>`;
}
function render({ end = false } = {}) {
  const previous = document.getElementById("conversation");
  const oldScroll = previous?.scrollTop || 0;
  app.innerHTML = state.page === "home" ? homeHTML() : workspaceHTML();
  document.querySelectorAll("[data-scene]").forEach((b) => {
    b.classList.toggle("selected", b.dataset.scene === state.scene);
    b.setAttribute("aria-pressed", String(b.dataset.scene === state.scene));
  });
  const conversation = document.getElementById("conversation");
  if (conversation)
    conversation.scrollTop = end ? conversation.scrollHeight : oldScroll;
  if (state.detail) renderDetail();
}

function lens() {
  const row = (type, title, subtitle, glyph) =>
    `<button type="button" class="lens-row" data-action="${type}">${icon(glyph)}<span><strong>${title}</strong><small>${subtitle}</small></span>${icon("arrow")}</button>`;
  return {
    title: "Lo spazio",
    body: `<div class="lens-intro"><span class="workspace-art">${icon("leaf")}</span><div><strong>Quello che resta.</strong><small>La struttura della vostra conversazione.</small></div></div>${row("goal", "Dove volete arrivare", "Goal, adesioni e storia", "goal")}${row("context", "Quello che è emerso", "Informazioni, fonti e punti aperti", "context")}${row("work", "Il lavoro", state.work === "idle" ? "Filoni e attività" : currentStatus(), "work")}${row("outputs", "Quello che avete costruito", state.work === "completed" ? "Un contributo da leggere" : "Risultati e documenti", "file")}<div class="lens-extra">${button("sources", "Fonti", "", "file")}${button("people", "Persone", "", "people")}${button("email", "Email", "", "mail")}${button("calendar", "Calendario", "", "calendar")}${button("call", "Chiamata audio", "", "call")}${button("stream", "Filoni", "", "thread")}</div>`,
    footer: "",
  };
}
function workDetail() {
  if (state.work === "idle")
    return {
      title: "Il lavoro",
      body: `<span class="eyebrow">DA ESPLORARE INSIEME</span><h3>Una cosa alla volta.<br />Senza perdere il resto.</h3><p>Nessun lavoro di RIMIAM in corso in questa scena.</p><h4>Filoni attivi</h4>${button("stream", "Il lancio della beta", "lens-row", "thread")}<h4>Task</h4><p class="muted">Nessun Task assegnato. Un suggerimento di RIMIAM non assegna una responsabilità.</p>`,
      footer: button("start", "Confronta i due scenari", "primary", "rimiam"),
    };
  const log = [
    {
      text: `${people[state.initiatedBy]} ha richiesto il confronto`,
      detail: "13 settembre, 10:45 · Work Contract v1",
    },
    ...state.events,
  ];
  const controls =
    state.work === "completed"
      ? button("result", "Leggi il risultato", "primary", "file")
      : `${button(state.work === "working" || state.work === "needs_input" ? "pause" : "resume", state.work === "working" || state.work === "needs_input" ? "Metti in pausa" : "Riprendi", "secondary", state.work === "working" || state.work === "needs_input" ? "pause" : "play")}${state.work !== "stopped" ? button("stop-confirm", "Ferma il lavoro", "text-link danger") : ""}`;
  return {
    title: "Il lavoro di RIMIAM",
    body: `${badge(currentStatus(), state.conflict || state.outdated ? "warning" : "")}<h3>Come partire<br />con la prima beta.</h3><p class="lead">Un confronto dei materiali condivisi, con i dati mancanti lasciati visibili.</p>${state.conflict ? `<div class="info-block warning"><strong>Il perimetro è da chiarire</strong><p>La pausa o la ripresa non cancellano le due indicazioni incompatibili.</p>${button("conflict", "Vedi il punto da chiarire", "text-link", "arrow")}</div>` : ""}<h4>Perimetro del lavoro <span class="muted">· v${state.contractVersion}</span></h4><dl class="definition"><div><dt>Obiettivo</dt><dd>Confrontare una beta con 10 gruppi e una con 50. Nessuna decisione di lancio.</dd></div><div><dt>Ambito</dt><dd>${state.scope === "services-only" ? "Solo costi dei servizi; tempo di supporto escluso secondo l’indicazione di Riccardo ancora vigente." : "Costi stimati dei servizi, ipotesi di utilizzo e tempo per supporto e feedback."}${state.contractExtra ? " Esplicitare le ipotesi sul consumo AI, senza inventare dati mancanti." : ""}</dd></div><div><dt>Ipotesi e limiti</dt><dd>150 €/mese nel documento e circa 500 €/mese riferiti da Giulia sono stime illustrative, non prezzi verificati. Utilizzo AI e tempo di supporto non misurati.</dd></div><div><dt>Fonti pertinenti</dt><dd>${button("source", "Stima costi beta · originale v1", "text-link", "file")}<br />${button("larger-beta", "Messaggio di Giulia · 12 settembre", "text-link", "context")}</dd></div><div><dt>Risultato atteso</dt><dd>Contributo con confronto e punti da verificare. Nessuna adozione, assegnazione o azione esterna.</dd></div></dl><h4>Continuità</h4><ol class="history">${log.map((entry) => `<li>${escapeHTML(entry.text)}<small>${escapeHTML(entry.detail)}</small></li>`).join("")}</ol>${state.work !== "completed" && !state.conflict && state.scope === "full" && !state.contractExtra ? button("compatible", "Esplicita le ipotesi sul consumo AI", "text-link", "plus") : ""}<p class="footnote">${people[state.person]} può guidare questo lavoro perché può contribuire allo spazio. La richiesta iniziale non assegna un proprietario.</p>`,
    footer: controls,
  };
}
function conflictDetail() {
  return {
    title: "Un punto da chiarire",
    body: `${badge("In attesa di chiarimento", "warning")}<h3>Stesso confronto.<br />Due perimetri diversi.</h3><p>Le indicazioni sono entrambe conservate. RIMIAM non sceglie quale persona seguire.</p><div class="question-pair"><div><strong>Riccardo · 10:47</strong><p>«Limita il confronto ai costi dei servizi: escludi il tempo di supporto.»</p></div><div><strong>Giulia · 10:48</strong><p>«Nel confronto deve esserci anche il tempo per supporto e feedback.»</p></div></div><p class="lead">Volete confrontare solo i costi dei servizi oppure includere anche il tempo per supporto e feedback?</p><p class="footnote">Puoi ritirare la tua indicazione. Non puoi ritirare quella dell’altra persona. Il perimetro non contestato e la storia restano conservati.</p>`,
    footer: `${button("withdraw", "Ritiro la mia indicazione", "primary")}${button("ask-conflict", "Ne parliamo in conversazione", "text-link", "arrow")}`,
  };
}
function resultDetail() {
  if (state.work !== "completed")
    return {
      title: "Risultati",
      body: '<span class="eyebrow">OUTPUTS</span><h3>Lo spazio per ciò<br />che costruirete.</h3><p>Nessun risultato prodotto in questa scena. Le fonti caricate restano consultabili anche prima che esista un risultato.</p>',
      footer: button("sources", "Apri le fonti", "secondary", "file"),
    };
  return {
    title: "Il confronto",
    body: `${badge(state.outdated ? "Da ricontrollare · fonte aggiornata" : "Contributo · non adottato", state.outdated ? "warning" : "neutral")}<h3>Partire piccoli,<br />per imparare meglio.</h3><p class="footnote">RIMIAM · 13 settembre, 10:49 · risultato v1<br />Completato sul Work Contract v${state.contractVersion} · dati illustrativi</p><p class="lead">I 150 € sono una stima nel documento condiviso; i 500 € sono un’ipotesi di Giulia. Nessuno dei due importi è un preventivo verificato.</p><div class="comparison"><div><span class="eyebrow">10 GRUPPI</span><strong>~150 €</strong><p>al mese · stima nel documento</p></div><div><span class="eyebrow">50 GRUPPI</span><strong>~500 €</strong><p>al mese · ipotesi di Giulia</p></div></div><p>La differenza ipotizzata è di 350 € al mese, ma non basta per scegliere: le stime potrebbero assumere un uso diverso dell’AI e non includono il vostro tempo.</p><div class="info-block"><strong>Il punto utile per proseguire</strong><p>Misurare il costo di alcune sessioni reali e stimare il tempo di supporto prima di scegliere la dimensione della beta.</p><p class="footnote">Raccomandazione · nessun Task creato o assegnato.</p></div><h4>Da dove viene</h4>${button("source", "Stima costi beta · v1", "text-link", "file")}<br />${button("larger-beta", "Stima attribuita a Giulia", "text-link", "context")}<p class="footnote">Questo contributo non è una decisione o un’informazione accettata. Eventuali adozioni seguono il percorso governato della capability pertinente.</p>${state.outdated ? '<div class="info-block warning"><strong>Il risultato era completo quando è stato prodotto.</strong><p>Una modifica successiva alla fonte richiede una nuova verifica. Nessun riavvio automatico.</p></div>' : ""}`,
    footer: button("ask-result", "Parliamone con RIMIAM", "primary", "rimiam"),
  };
}
function getDetail(type) {
  if (type === "lens") return lens();
  if (
    state.created &&
    [
      "context",
      "source",
      "sources",
      "larger-beta",
      "work",
      "outputs",
      "result",
      "stream",
      "information-history",
      "attach",
    ].includes(type)
  ) {
    return {
      title: "Uno spazio nuovo",
      body: '<span class="eyebrow">SI PARTE DA QUI</span><h3>La struttura<br />arriverà parlando.</h3><p>In questo spazio non ci sono ancora fonti, informazioni accettate, filoni o lavori di RIMIAM. I contenuti della startup RIMIAM appartengono all’altro spazio.</p>',
      footer: button("close", "Torna alla conversazione", "secondary"),
    };
  }
  if (type === "work") return workDetail();
  if (type === "conflict") return conflictDetail();
  if (type === "result" || type === "outputs") return resultDetail();
  if (type === "source")
    return {
      title: "La fonte originale",
      body: `${badge("Documento condiviso", "neutral")}<h3>Le prime stime<br />per la beta.</h3><p class="footnote">Caricata da Giulia · 13 settembre, 10:41<br />Documento originale · v1 · esempio illustrativo</p><blockquote class="quote">«Beta con 10 gruppi: servizi stimati a 150 €/mese. Consumo AI da verificare.»<small>Stima costi beta · pagina 1 · esempio</small></blockquote><p>È un’ipotesi riportata nel documento, non un prezzo verificato o un budget di spesa approvato.</p><dl class="definition"><div><dt>Provenienza</dt><dd>Allegato al messaggio di Giulia delle 10:41. Giulia è la persona che l’ha condiviso, non necessariamente l’autrice del documento.</dd></div><div><dt>Usi</dt><dd>Riferimento nel confronto della beta. Nessuna accettazione editoriale di questa stima nella scena.</dd></div></dl><p class="footnote">Documento e importi inventati per il prototipo: non sono preventivi, prezzi correnti o stime del repository reale.</p>`,
      footer: button("context", "Vedi nel contesto", "secondary", "context"),
    };
  if (type === "larger-beta")
    return {
      title: "Una stima attribuita",
      body: `${badge("Affermazione · non accettata", "neutral")}<h3>L’ipotesi<br />per 50 gruppi.</h3><blockquote class="quote">«Per una beta con 50 gruppi ipotizzerei circa 500 € al mese di servizi. È ancora da verificare.»<small>Giulia · messaggio del 12 settembre, 18:12</small></blockquote><p>Un’ipotesi di Giulia, non un preventivo verificato né una spesa autorizzata. Importo illustrativo, non una stima reale per RIMIAM.</p>`,
      footer: button("context", "Torna al contesto", "secondary", "context"),
    };
  if (type === "context")
    return {
      title: "Quello che è emerso",
      body: `<span class="eyebrow">CONTEXT</span><h3>Un riferimento.<br />Con le sue basi.</h3><p>Informazioni, ipotesi e decisioni restano distinguibili.</p><h4>Informazione accettata</h4><div class="info-block">${badge("Accettata da Riccardo")}<p>Nel foglio condiviso risultano <strong>6 persone disponibili a un’intervista</strong>.</p><p class="footnote">Informazione v2 · accettata il 13 settembre, 10:30 · fonte: elenco contatti illustrativo. Riferimento di lavoro, non consenso collettivo o certezza garantita.</p>${button("information-history", "Fonte e correzione precedente", "text-link", "clock")}</div><h4>Ancora da verificare</h4>${button("source", "10 gruppi · ~150 €/mese nel documento", "lens-row", "file")}${button("larger-beta", "50 gruppi · ~500 €/mese ipotizzati da Giulia", "lens-row", "context")}<h4>Domanda aperta</h4><p>Quante sessioni faranno i gruppi e quanto supporto richiederanno?</p>`,
      footer: button("ask-context", "Chiedi a RIMIAM", "primary", "rimiam"),
    };
  if (type === "information-history")
    return {
      title: "Fonte e correzioni",
      body: `${badge("Informazione accettata · v2")}<h3>Sei disponibilità.<br />Non sei utenti attivi.</h3><p>Qualificazione corrente: disponibilità a un’intervista riportate nel foglio condiviso. Non sono adesioni alla beta né utilizzi effettivi del prodotto.</p><dl class="definition"><div><dt>Fonte corrente</dt><dd>Elenco interviste, v2: sei disponibilità riportate. Fonte interamente illustrativa, senza contatti o dati personali reali.</dd></div><div><dt>Accettazione editoriale</dt><dd>Riccardo · 13 settembre, 10:30 · contenuto v2</dd></div></dl><h4>La storia resta consultabile</h4><ol class="history"><li>v2 · 6 disponibilità secondo l’elenco aggiornato<small>Riccardo · 13 settembre, 10:30 · correzione accettata con nuova fonte</small></li><li>v1 · circa 5 disponibilità, stima riferita da Giulia<small>Riccardo · 12 settembre, 18:20 · accettata con la qualificazione di stima; ora superata</small></li></ol><p>La correzione non riscrive il messaggio di Giulia né la precedente accettazione.</p>`,
      footer: button("context", "Torna al contesto", "secondary"),
    };
  if (type === "goal")
    return {
      title: "Dove volete arrivare",
      body: `<span class="eyebrow">GOAL PRINCIPALE</span><h3>${state.created ? "Il Goal può<br />emergere parlando." : "Portare RIMIAM<br />ai primi gruppi reali."}</h3>${state.created ? "<p>L’introduzione del nuovo spazio esprime il tuo intento. Non è stata trasformata automaticamente in Goal.</p>" : `<p class="footnote">Goal G-01 · versione 2 · adottata il 12 settembre</p><p>Costruire una startup attorno a uno spazio in cui persone e AI portano avanti progetti insieme. La prima beta serve a capire se la collaborazione è davvero utile.</p><h4>Adesioni esplicite a questa versione</h4><div class="person-row">${avatar("riccardo")}<span><strong>Riccardo</strong><small>12 settembre · Goal G-01, v2</small></span>${icon("check")}</div><div class="person-row">${avatar("giulia")}<span><strong>Giulia</strong><small>12 settembre · Goal G-01, v2</small></span>${icon("check")}</div><p class="footnote">Adesione al Goal, partecipazione e poteri decisionali sono distinti. Nessuna delega deriva da questa schermata.</p><h4>Versione precedente</h4><p class="small muted">v1 · «Lanciare la prima beta di RIMIAM». La stessa iniziativa, prima della precisazione sui primi gruppi.</p>`}`,
      footer: button(
        "ask-goal",
        "Parliamone in conversazione",
        "primary",
        "rimiam",
      ),
    };
  if (type === "stream")
    return {
      title: "Un filone dello spazio",
      body: `${badge(state.stream === "active" ? "Attivo" : state.stream === "resolved" ? "Risolto" : "Archiviato", state.stream !== "active" ? "neutral" : "")}<h3>Il lancio<br />della beta.</h3><p>Dimensione della beta, costi e primi riscontri: messaggi, fonti e lavoro raccolti senza spostarli dalla conversazione condivisa.</p><p class="footnote">Filone W-01 · v${state.streamVersion} · stessi partecipanti e stessa visibilità dello Workspace</p><h4>Dentro questo filone</h4>${button("source", "Stima costi beta", "lens-row", "file")}${button("work", "Il confronto della beta", "lens-row", "work")}<div class="info-block"><strong>Un punto di vista, non un’altra stanza.</strong><p>La vista focalizzata filtra la lettura. Le fonti pertinenti dello spazio restano disponibili a RIMIAM; la storia originale non cambia.</p></div><p class="footnote">Risolvere o archiviare il filone non completa Task, Goal o impegni. Riaprirlo conserva la stessa identità.</p>`,
      footer: `${button("focus", "Apri la vista focalizzata", "primary", "thread")}${state.stream === "active" ? button("resolve-stream", "Segna il filone come risolto", "text-link") : button("reopen-stream", "Riapri lo stesso filone", "text-link")}${state.stream === "resolved" ? button("archive-stream", "Archivia il filone", "text-link") : ""}`,
    };
  if (type === "sources" || type === "attach")
    return {
      title: "Le fonti dello spazio",
      body: `<span class="eyebrow">ORIGINALI, SEMPRE RITROVABILI</span><h3>Da dove<br />siamo partiti.</h3>${button("source", "Stima costi beta · esempio.pdf", "lens-row", "file")}${button("larger-beta", "Ipotesi di Giulia · 50 gruppi", "lens-row", "context")}<div class="info-block warning"><strong>Note interviste · esempio.pdf</strong><p>Caricamento non riuscito · file non disponibile nello spazio.</p><p class="footnote">Stato illustrativo. Non è stato caricato un file reale.</p></div><p class="footnote">Nel prodotto, un file non elaborato resta raggiungibile anche senza risultati derivati. L’anteprima non legge i file del dispositivo.</p>`,
      footer: "",
    };
  if (type === "people")
    return {
      title: "Le persone",
      body: `<span class="eyebrow">UNO SPAZIO CONDIVISO</span><h3>${state.created ? "Si può iniziare<br />anche da soli." : "Insieme,<br />senza un capotavola."}</h3>${(state.created ? [state.creationPerson] : ["riccardo", "giulia"]).map((p) => `<div class="person-row">${avatar(p)}<span><strong>${people[p]}${p === state.person ? " · tu" : ""}</strong><small>Può partecipare e contribuire</small></span></div>`).join("")}<p>Chi può contribuire può guidare il lavoro esplorativo condiviso. Questo non attribuisce poteri sulle decisioni o sugli impegni degli altri.</p><div class="info-block"><strong>Anche la storia è condivisa.</strong><p>Un nuovo membro ammesso potrà leggere la storia condivisa conservata, anche precedente al suo ingresso.</p></div><p class="footnote">Gestione degli accessi e authority di progetto sono separate. Nessun ruolo Owner/Guest viene creato da queste etichette.</p>`,
      footer: button("invitations", "Inviti dello spazio", "secondary", "mail"),
    };
  if (type === "invitations")
    return {
      title: "Inviti",
      body: '<span class="eyebrow">NESSUN INVITO IN ATTESA</span><h3>Il prossimo ingresso<br />parte da qui.</h3><p>Questa anteprima non invia email né modifica gli accessi. Il percorso definitivo mostrerà destinatario, stato di consegna e conseguenze della storia condivisa prima dell’invio.</p>',
      footer: button("close", "Torna allo spazio", "secondary"),
    };
  if (type === "create")
    return {
      title: "Un nuovo spazio",
      body: '<span class="eyebrow">BASTA UN’INTENZIONE</span><h3>Che cosa volete<br />costruire?</h3><form id="create-form"><label class="field">Nome dello spazio<input id="workspace-name" name="name" required maxlength="80" placeholder="Per esempio, Il nostro viaggio" autocomplete="off" /></label><label class="field">Da dove partite? <span class="muted">Facoltativo</span><textarea name="introduction" maxlength="2000" placeholder="Un’idea, una domanda, qualcosa da capire insieme…"></textarea></label><p class="footnote">La tua introduzione apre la conversazione. Goal e adesioni potranno essere stabiliti dopo. Puoi iniziare da solo e invitare gli altri in seguito.</p><p class="footnote">Creazione simulata, solo in questa anteprima.</p><button class="primary full" type="submit">Entra nel tuo spazio</button></form>',
      footer: "",
    };
  if (type === "stop-confirm")
    return {
      title: "Fermare questo lavoro?",
      body: "<h3>Il lavoro si ferma.<br />La storia resta.</h3><p>RIMIAM non continuerà l’esecuzione di questo lavoro. Fonti, contributi e indicazioni rimangono consultabili; eventuali impegni collegati non vengono soddisfatti o cancellati.</p>",
      footer: `${button("stop", "Ferma il lavoro", "primary")}${button("work", "Torna al dettaglio", "text-link")}`,
    };
  if (type === "call")
    return {
      title: "Chiamata audio",
      body: `${badge("Anteprima · nessuna chiamata attiva", "neutral")}<h3>Una conversazione<br />fra voi.</h3><p>RIMIAM non partecipa e non parla live nelle chiamate fra persone.</p><div class="info-block"><strong>Prima di registrare, ognuno sceglie.</strong><p>Il consenso personale deve includere audio, trascrizione e conservazione come fonte condivisa, visibile anche ai membri ammessi successivamente secondo la policy dello spazio.</p></div><div class="person-row">${avatar("riccardo")}<span><strong>Riccardo</strong><small>Consenso non espresso</small></span></div><div class="person-row">${avatar("giulia")}<span><strong>Giulia</strong><small>Consenso non espresso</small></span></div><p class="footnote">L’analisi di RIMIAM richiede una richiesta separata dopo la chiamata. Nessun microfono viene attivato nell’anteprima.</p>`,
      footer:
        '<button type="button" class="primary" disabled>Registrazione non autorizzata</button>',
    };
  if (type === "email" || type === "calendar")
    return {
      title: type === "email" ? "Email" : "Calendario",
      body: `${badge("Account personale · non connesso", "neutral")}<h3>Il tuo ${type === "email" ? "account" : "calendario"}.<br />Le tue scelte.</h3><p>Collegare un account non condivide automaticamente messaggi o appuntamenti con lo spazio.</p><div class="info-block"><strong>Prima condividi ciò che serve.</strong><p>Una condivisione esplicita rende il contenuto visibile secondo la policy dello Workspace. Invii e modifiche esterne richiedono il loro atto autorizzato sul contenuto esatto.</p></div><p class="footnote">Ingresso illustrativo. Nessuna connessione o autorizzazione OAuth nell’anteprima.</p>`,
      footer: button("close", "Torna alla conversazione", "secondary"),
    };
  if (type === "voice" || type === "voice-dialogue")
    return {
      title: type === "voice" ? "Un messaggio vocale" : "Parla con RIMIAM",
      body: `<span class="eyebrow">VOCE NELLO STESSO SPAZIO</span><h3>${type === "voice" ? "Puoi dirlo<br />a voce." : "La conversazione<br />continua a voce."}</h3><p>${type === "voice" ? "Audio originale e trascrizione restano distinguibili e collegati alla loro fonte." : "RIMIAM usa lo stesso contesto della Conversation. Parlare non salta i passaggi di autorizzazione delle azioni conseguenziali."}</p><p class="footnote">Questo prototipo esplora l’ingresso al percorso. Non attiva il microfono, non registra e non genera audio.</p>`,
      footer: button("close", "Torna alla conversazione", "secondary"),
    };
  if (type === "account")
    return {
      title: "La tua presenza",
      body: `<h3>${people[state.person]}.</h3><p>Stai esplorando dati dimostrativi. Il selettore fuori dal telefono cambia il punto di vista per confrontare i controlli disponibili ai due contributori; non autentica un utente.</p>`,
      footer: button("close", "Continua", "secondary"),
    };
  return lens();
}

function detailMarkup() {
  const detail = getDetail(state.detail);
  return `<div class="detail-layout"><div class="sheet-handle" aria-hidden="true"></div><header class="detail-header">${state.backStack.length ? button("detail-back", '<span class="sr-only">Indietro nel dettaglio</span>', "icon-btn", "back") : ""}<h2 id="detail-title" tabindex="-1">${detail.title}</h2>${button("pin", `<span class="sr-only">${state.pinned ? "Sgancia" : "Affianca"} il dettaglio</span>`, "icon-btn pin", "pin")}${button("close", '<span class="sr-only">Chiudi il dettaglio</span>', "icon-btn", "close")}</header><div class="detail-content">${detail.body}</div>${detail.footer ? `<footer class="detail-footer">${detail.footer}</footer>` : ""}</div>`;
}
function sizeDialog() {
  if (!dialog.open) return;
  const rect = device.getBoundingClientRect();
  const border = parseFloat(getComputedStyle(device).borderLeftWidth) || 0;
  const isWeb = state.platform === "web";
  const width = isWeb
    ? Math.min(375, rect.width - border * 2)
    : rect.width - border * 2;
  const height = isWeb
    ? rect.height - border * 2
    : (rect.height - border * 2) * (state.platform === "android" ? 0.93 : 0.89);
  Object.assign(dialog.style, {
    position: "fixed",
    left: `${rect.right - border - width}px`,
    right: "auto",
    top: `${rect.bottom - border - height}px`,
    bottom: "auto",
    width: `${width}px`,
    height: `${height}px`,
    maxHeight: `${height}px`,
  });
}
function renderDetail() {
  const priorFocused =
    document.activeElement?.closest("[data-action]")?.dataset.action;
  const dock = document.getElementById("dock");
  if (!state.detail) return;
  if (
    state.pinned &&
    state.platform === "web" &&
    device.clientWidth > 760 &&
    dock
  ) {
    if (dialog.open) dialog.close();
    dialog.innerHTML = "";
    dock.classList.add("visible");
    dock.innerHTML = detailMarkup();
  } else {
    if (dock) {
      dock.innerHTML = "";
      dock.classList.remove("visible");
    }
    dialog.innerHTML = detailMarkup();
    if (!dialog.open) dialog.showModal();
    sizeDialog();
  }
  const host = dialog.open ? dialog : dock;
  const target =
    priorFocused && host?.querySelector(`[data-action="${priorFocused}"]`);
  (target || host?.querySelector("#detail-title"))?.focus({
    preventScroll: true,
  });
}
function openDetail(type, { replace = false } = {}) {
  if (state.detail && state.detail !== type && !replace)
    state.backStack.push(state.detail);
  state.detail = type;
  renderDetail();
  announce(getDetail(type).title);
}
function closeDetail() {
  state.detail = null;
  state.backStack = [];
  if (dialog.open) dialog.close();
  dialog.innerHTML = "";
  const dock = document.getElementById("dock");
  if (dock) {
    dock.innerHTML = "";
    dock.classList.remove("visible");
  }
}
function record(text) {
  state.version += 1;
  state.events.push({
    text,
    detail: `Atto illustrativo · ${people[state.person]} · versione di controllo ${state.version}`,
  });
}
function resetScene(scene) {
  closeDetail();
  Object.assign(state, {
    scene,
    page: scene === "home" ? "home" : "workspace",
    workspace: "RIMIAM · Prima beta",
    introduction: null,
    created: false,
    work:
      scene === "completed"
        ? "completed"
        : scene === "conflict"
          ? "needs_input"
          : "idle",
    version: 1,
    contractVersion: 1,
    conflict: scene === "conflict",
    hadConflict: scene === "conflict",
    withdrawn: [],
    scope: "full",
    initiatedBy: "riccardo",
    focus: false,
    stream: "active",
    streamVersion: 1,
    contractExtra: false,
    draft: "",
    extraMessages: [],
    events: [],
    outdated: false,
  });
  if (scene === "completed")
    state.events.push({
      text: "RIMIAM ha prodotto il contributo v1",
      detail: "13 settembre, 10:49 · non adottato",
    });
  if (scene === "conflict")
    state.events.push({
      text: "Indicazioni incompatibili conservate; esecuzione sospesa",
      detail: "Riccardo, 10:47 · Giulia, 10:48",
    });
  render({ end: true });
}
function ask(text) {
  closeDetail();
  state.page = "workspace";
  state.draft = text;
  render({ end: true });
  document.getElementById("message")?.focus();
}
function action(name) {
  if (name === "close") return closeDetail();
  if (name === "detail-back") {
    state.detail = state.backStack.pop() || "lens";
    return renderDetail();
  }
  if (name === "pin") {
    state.pinned = !state.pinned;
    return renderDetail();
  }
  if (name === "home" || name === "enter") {
    closeDetail();
    state.page = name === "home" ? "home" : "workspace";
    return render();
  }
  if (name === "start") {
    closeDetail();
    if (state.work === "idle") {
      state.work = "working";
      state.initiatedBy = state.person;
      state.page = "workspace";
      state.events.push({
        text: "Confronto avviato sui materiali condivisi",
        detail: `${people[state.person]} · richiesta esplicita nell’anteprima`,
      });
    }
    render({ end: true });
    announce(
      "Confronto avviato nella scena. Per vedere l’output illustrativo, apri la scena Un risultato da leggere.",
    );
    return;
  }
  if (name === "pause") {
    record("Lavoro messo in pausa");
    state.work = "paused";
    render();
    return;
  }
  if (name === "stop") {
    record("Lavoro fermato; storia e restrizioni conservate");
    state.work = "stopped";
    openDetail("work", { replace: true });
    render();
    return;
  }
  if (name === "resume") {
    record(
      state.conflict
        ? "Tentativo di ripresa: il conflitto resta da chiarire"
        : "Lavoro ripreso entro il perimetro vigente",
    );
    state.work = state.conflict ? "needs_input" : "working";
    render();
    announce(
      state.conflict
        ? "Il conflitto non è risolto. Esecuzione ancora sospesa."
        : "Ripresa illustrativa del lavoro.",
    );
    return;
  }
  if (name === "compatible") {
    if (!state.contractExtra && !state.conflict && state.scope === "full") {
      state.contractExtra = true;
      state.contractVersion += 1;
      record(
        "Aggiunta l’esplicitazione delle ipotesi sul consumo AI; nessun servizio attivato o spesa autorizzata",
      );
    }
    render();
    return;
  }
  if (name === "withdraw") {
    if (!state.conflict) return;
    state.withdrawn.push(state.person);
    record(
      `${people[state.person]} ha ritirato la propria indicazione contestata`,
    );
    state.conflict = false;
    state.work = "paused";
    state.scope = state.person === "giulia" ? "services-only" : "full";
    if (state.scope === "services-only") state.contractVersion += 1;
    state.extraMessages.push({
      kind: "notice",
      text: `${people[state.person]} ha ritirato la propria indicazione. Il conflitto è risolto; il lavoro resta in pausa fino alla ripresa esplicita. L’altra indicazione e la storia rimangono conservate.`,
    });
    openDetail("work", { replace: true });
    render();
    return;
  }
  if (name === "focus" || name === "unfocus") {
    closeDetail();
    state.focus = name === "focus";
    render();
    return;
  }
  if (["resolve-stream", "archive-stream", "reopen-stream"].includes(name)) {
    state.stream =
      name === "resolve-stream"
        ? "resolved"
        : name === "archive-stream"
          ? "archived"
          : "active";
    state.streamVersion += 1;
    renderDetail();
    announce(
      `Filone ${state.stream === "active" ? "riaperto" : state.stream === "resolved" ? "risolto" : "archiviato"} nell’anteprima. Nessun effetto su altri oggetti.`,
    );
    return;
  }
  const questions = {
    "ask-result":
      "RIMIAM, nel confronto della beta (contributo v1), che cosa dobbiamo misurare prima di invitare i primi gruppi?",
    "ask-context":
      "RIMIAM, sui costi riportati nella stima beta v1, quali ipotesi dobbiamo ancora verificare?",
    "ask-conflict":
      "RIMIAM, sul confronto della beta: chiarisco la mia indicazione sul perimetro…",
    "ask-goal":
      "RIMIAM, vorrei discutere il Goal corrente senza modificarlo ancora.",
  };
  if (questions[name]) return ask(questions[name]);
  openDetail(name);
}

document.addEventListener("click", (event) => {
  const platform = event.target.closest("[data-platform]");
  if (platform) {
    closeDetail();
    state.platform = platform.dataset.platform;
    device.className = `device ${state.platform}`;
    device.setAttribute(
      "aria-label",
      `Anteprima RIMIAM per ${state.platform === "ios" ? "iOS" : state.platform === "android" ? "Android" : "Web"}`,
    );
    studio.classList.toggle("web-mode", state.platform === "web");
    document
      .querySelectorAll("[data-platform]")
      .forEach((b) => b.setAttribute("aria-pressed", String(b === platform)));
    render();
    return;
  }
  const scene = event.target.closest("[data-scene]");
  if (scene) return resetScene(scene.dataset.scene);
  const control = event.target.closest("[data-action]");
  if (control) action(control.dataset.action);
});
document.addEventListener("input", (event) => {
  if (event.target.id === "message") state.draft = event.target.value;
});
document.getElementById("persona").addEventListener("change", (event) => {
  state.person = event.target.value;
  if (state.created) resetScene("conversation");
  else render();
  announce(`Punto di vista illustrativo: ${people[state.person]}`);
});
document.addEventListener("submit", (event) => {
  if (event.target.id === "create-form") {
    event.preventDefault();
    const data = new FormData(event.target);
    const name = String(data.get("name") || "").trim();
    if (!name) return;
    const intro = String(data.get("introduction") || "").trim();
    closeDetail();
    Object.assign(state, {
      workspace: name,
      introduction: intro,
      created: true,
      creationPerson: state.person,
      page: "workspace",
      work: "idle",
      conflict: false,
      hadConflict: false,
      focus: false,
      extraMessages: [],
      draft: "",
    });
    render();
    announce("Nuovo spazio illustrativo. Nessun dato salvato nel prodotto.");
    return;
  }
  if (event.target.id === "composer") {
    event.preventDefault();
    const text = state.draft.trim();
    if (!text) return;
    state.draft = "";
    if (
      /rimiam/i.test(text) &&
      /confronta/i.test(text) &&
      state.work === "idle" &&
      !state.created
    ) {
      state.work = "working";
      state.initiatedBy = state.person;
      state.events.push({
        text: "Avvio esplicito dalla conversazione",
        detail: `${people[state.person]} · scena illustrativa`,
      });
    } else {
      state.extraMessages.push({ person: state.person, text });
      if (/rimiam/i.test(text))
        state.extraMessages.push({
          kind: "notice",
          text: "Qui puoi esplorare l’interazione, ma non è collegato un modello. Il messaggio resta nell’anteprima; le altre risposte sono esempi scritti per il design.",
        });
    }
    render({ end: true });
    document.getElementById("message")?.focus();
  }
});
document.addEventListener("keydown", (event) => {
  if (
    event.target.id === "message" &&
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.isComposing
  ) {
    event.preventDefault();
    event.target.closest("form").requestSubmit();
  }
});
dialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeDetail();
});
window.addEventListener("resize", () => {
  const shouldDock =
    state.pinned && state.platform === "web" && device.clientWidth > 760;
  if (state.detail && shouldDock === dialog.open) renderDetail();
  else sizeDialog();
});
window.addEventListener("scroll", sizeDialog, { passive: true });
render({ end: true });
