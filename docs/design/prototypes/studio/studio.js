(() => {
  const one = (s) => document.querySelector(s);
  const all = (s) => [...document.querySelectorAll(s)];
  const shell = one(".shell");
  const panel = one(".inspector");
  const feed = one("#feed");
  const draft = one("textarea");
  const fileInput = one("#file-input");
  const isPhone = window.matchMedia("(max-width:760px)");
  const theme = new URLSearchParams(location.search).get("tema");
  let opener;
  let selectedFile = "";
  let chatPosition = 0;
  let sharedHere = [];
  const panels = {
    decision: ["Decisione adottata", '<p class="panel-title">Apriamo la prima beta di RIMIAM a tre gruppi.</p><small>Adottata da</small><p>Caterina Test</p><small>Data</small><p>20 novembre 2026</p><button data-original>Vai al messaggio</button>'],
    goal: ["Goal dello spazio", '<p class="panel-title">Invitare i primi gruppi a provare la beta di RIMIAM.</p><button data-panel="decision">Apri la decisione adottata</button>'],
    members: ["Persone nello spazio", "<p>Caterina Test</p><p>Matteo Test</p>"],
    tools: ["Strumenti", '<button data-panel="goal">Direzione dello spazio</button><button data-panel="decision">Decisione adottata</button><button data-files>Condivisi</button>'],
    home: ["I tuoi spazi", '<button data-chat>Lancio RIMIAM</button>'],
    today: ["Oggi", "<p>Nessun appuntamento o promemoria in questo esempio.</p>"],
    personal: ["Tu ed Emme", "<p>Il bozzetto mostra la conversazione condivisa di Lancio RIMIAM.</p><button data-chat>Torna allo spazio</button>"],
    invite: ["Invita nello spazio", "<p>L’invio di inviti è disponibile nell’app. Questo bozzetto è locale.</p>"],
    commands: ["Comandi", '<button data-files>/file · Apri Condivisi</button><button data-panel="goal">/goal · Direzione dello spazio</button>'],
    availability: ["Disponibilità di Emme", "<p>Le risposte di Emme sono disattivate nello spazio di prova usato per questo confronto.</p>"],
  };
  function setTheme(value) {
    document.documentElement.dataset.theme = value;
    all(".theme").forEach((b) => { b.title = value === "light" ? "Passa al tema scuro" : "Passa al tema chiaro"; b.setAttribute("aria-label", b.title); });
  }
  setTheme(theme === "scuro" || theme === "dark" ? "dark" : "light");
  function closeNav() { shell.classList.remove("mobile-open"); }
  function closePanel(restore = true) {
    if (panel.hidden) return;
    panel.hidden = true;
    one("main").classList.remove("panel-open");
    if (restore && opener?.isConnected) opener.focus({ preventScroll:true });
  }
  function renderPanel(name, button) {
    if (!panels[name]) return;
    if (panel.hidden) opener = button;
    closeNav(); panel.hidden = false;
    one("main").classList.add("panel-open");
    one("#panel-title").textContent = panels[name][0];
    one("#panel-body").innerHTML = panels[name][1]; // Fixed local prototype copy.
    one(".dismiss").focus({ preventScroll:true });
  }
  function switchView(files) {
    closeNav(); closePanel(false);
    if (files && !one(".workarea").hidden) chatPosition = feed.scrollTop;
    one(".workarea").hidden = files;
    one(".library").hidden = !files;
    all(".tabs button").forEach((b) => {
      if (b.hasAttribute(files ? "data-files" : "data-chat")) b.setAttribute("aria-current","page");
      else b.removeAttribute("aria-current");
    });
    if (!files) feed.scrollTop = chatPosition;
  }
  function fileCategory(name) {
    return /\.(png|jpe?g|webp|gif|avif|heic|svg)$/i.test(name) ? "Media" : "File";
  }
  function renderLibrary(filter) {
    const selected = sharedHere.filter((item) => filter === "Recenti" || fileCategory(item) === filter);
    one(".empty").replaceChildren();
    if (!selected.length) {
      const message = document.createElement("p"); message.textContent = "Nessun elemento condiviso"; one(".empty").append(message);
    }
    for(const filename of selected) {
      const item = document.createElement("p"); item.textContent = filename; one(".empty").append(item);
    }
  }
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest("button"); if (!b) return;
    if (b.matches(".theme")) setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
    else if (b.matches("[data-dismiss-nav]")) closeNav();
    else if (b.matches("[data-nav]")) {
      if (isPhone.matches) shell.classList.toggle("mobile-open"); else shell.classList.toggle("nav-hidden");
    } else if (b.matches(".dismiss")) closePanel();
    else if (b.matches("[data-panel]")) renderPanel(b.dataset.panel, b);
    else if (b.matches("[data-files]")) switchView(true);
    else if (b.matches("[data-chat]")) switchView(false);
    else if (b.hasAttribute("data-original")) {
      closePanel(false); const source = one("#original"); source.tabIndex = -1;
      source.scrollIntoView({block:"nearest"}); source.focus({preventScroll:true});
    } else if (b.matches(".library-tabs button")) {
      all(".library-tabs button").forEach((t) => t.setAttribute("aria-pressed",String(t === b)));
      renderLibrary(b.textContent.trim());
    }
  });
  const invite = one(".invite");
  invite.addEventListener("focus", () => invite.classList.remove("tip-dismissed"));
  invite.addEventListener("pointerenter", () => invite.classList.remove("tip-dismissed"));
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") { invite.classList.add("tip-dismissed"); if (shell.classList.contains("mobile-open")) { closeNav(); one(".show-nav").focus(); } else closePanel(); }
    if (ev.key === "Tab" && isPhone.matches && !panel.hidden) {
      const buttons = [...panel.querySelectorAll("button")]; const first = buttons[0], last = buttons.at(-1);
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    }
  });
  function syncDraft() { one(".send").disabled = !draft.value.trim() && !selectedFile; }
  function setFile(name) {
    selectedFile = name; const line = one(".draft-file"); line.replaceChildren(); line.hidden = !name;
    if (name) {
      line.append(document.createTextNode(name)); const b = document.createElement("button"); b.type = "button";
      b.textContent = "Rimuovi"; b.onclick = () => { fileInput.value=""; setFile(""); }; line.append(b);
    }
    syncDraft();
  }
  one("#attach").onclick = () => fileInput.click();
  fileInput.onchange = () => setFile(fileInput.files[0]?.name || "");
  draft.addEventListener("input", syncDraft);
  draft.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !matchMedia("(pointer: coarse)").matches) {e.preventDefault(); if(!one(".send").disabled) one(".composer").requestSubmit();}
  });
  one(".composer").onsubmit = (e) => {
    e.preventDefault(); if (!draft.value.trim() && !selectedFile) return;
    const msg=document.createElement("article"); msg.className="message preview-message";
    msg.innerHTML='<div class="sig"><i class="round ct">CT</i><b>Caterina Test</b></div>';
    const p=document.createElement("p"); p.textContent=[draft.value.trim(),selectedFile].filter(Boolean).join("\n"); msg.append(p); one(".thread").append(msg);
    if (selectedFile) {sharedHere.unshift(selectedFile); renderLibrary(one(".library-tabs [aria-pressed=true]").textContent.trim());}
    draft.value=""; fileInput.value=""; setFile(""); feed.scrollTop=feed.scrollHeight; draft.focus();
  };
  syncDraft();
})();
