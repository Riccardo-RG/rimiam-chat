# RIMIAM Web · Intervista di design

## Chiusura dell’intervista Web · 19 novembre 2026

Riccardo ha confermato insieme le sei scelte finali e ha chiuso l’intervista. I percorsi descritti costituiscono il brief UX per la prossima fase di UI Web. Le osservazioni sull’app attuale e le proposte visive sono identificate nelle rispettive sezioni. Implementazione, collaudo con utenti e approvazione visiva restano passaggi successivi.

1. **Lettura tra dispositivi.** Punto di lettura, messaggi non letti e menzioni sono sincronizzati per persona e conversazione. Una chat già aperta su un altro dispositivo mantiene la posizione mentre la persona legge.
2. **Bozze e invio.** Per la prima versione, ogni bozza resta sul dispositivo in cui è stata scritta, associata al relativo account e alla conversazione. Dopo «Invia», la persona vede il messaggio inviato oppure «Invio non riuscito · Riprova», con il testo recuperabile.
3. **Documenti esistenti.** I documenti creati con il vecchio editor restano leggibili e scaricabili, con versioni e fonti consultabili. Per proseguire si scarica una copia, la si modifica all’esterno e la si ricarica come nuovo documento.
4. **Filoni.** Aprire un filone come «Test della beta» filtra la chat sui messaggi di quel tema. «Torna a tutta la chat» ripristina la vista completa. Lo spazio, i partecipanti e i messaggi originali restano gli stessi.
5. **Riepiloghi delle chat private.** Ciascuna delle due persone può ritirare il proprio consenso. Da allora i nuovi riepiloghi sono bloccati finché manca uno dei due consensi. Quelli già consegnati restano privati per chi li aveva richiesti.
6. **Uscita da uno spazio.** La persona conserva i file che aveva salvato esplicitamente nei propri Documenti personali. Per riaprire fonti o consultazioni collegate allo spazio serve un accesso ancora valido. La distinzione va resa chiara al momento del salvataggio.

## Home dopo l’accesso

Il 19 novembre 2026 Riccardo ha indicato che, entrando, vuole vedere direttamente nella lista spazi dove ci sono nuovi messaggi e dove qualcuno lo ha chiamato, per poi aprire la chat.

Riccardo si aspetta di trovare in Home i promemoria dell’intera giornata, già prima della scadenza, e di raggiungere il calendario direttamente da lì. Vuole poter nascondere la vista quando appesantisce la schermata. Ha confermato che vuole creare sia un promemoria sia un appuntamento direttamente dalla Home, senza aprire il calendario. Proposta: un blocco «Oggi» richiudibile che ricorda la scelta personale; l’ingresso «Calendario» e le due azioni rapide rimangono raggiungibili anche a blocco chiuso.

«Oggi» riunisce, in ordine di orario, promemoria e appuntamenti personali e quelli degli spazi che riguardano l’utente. Per ciascuna voce si deve riconoscere se è personale o da quale spazio proviene. Riccardo accoglie eventuali filtri purché discreti; la vista iniziale resta unificata.

Un appuntamento del calendario dello spazio compare nell’«Oggi» della persona solo se è invitata direttamente o se chi crea l’appuntamento sceglie «Tutto lo spazio». Senza destinatari espliciti l’appuntamento rimane nel calendario dello spazio.

L’invito in attesa di risposta compare già in ordine di orario con «Da confermare». Se la persona accetta, l’appuntamento mantiene il suo posto e perde la dicitura. Se rifiuta, esce dal suo «Oggi» e rimane nel calendario dello spazio.

I promemoria personali dei giorni passati ancora aperti sono raggiungibili dalla riga discreta «Promemoria precedenti». La persona sceglie «Ricordamelo oggi» o «Archivia». Il solo passaggio a un nuovo giorno non li sposta nell’agenda odierna e non genera notifiche aggiuntive.

Per un promemoria ricorrente, le scadenze passate ancora aperte occupano un’unica riga e si archiviano insieme. La scadenza di oggi rimane in «Oggi» e quelle future restano programmate.

Quando si modifica una ricorrenza, «Solo questo venerdì» (con il giorno pertinente) è preselezionato. «Da questo venerdì in poi» applica la modifica a quella scadenza e alle successive.

Creando un promemoria o un appuntamento dalla Home, la destinazione iniziale è «Solo io». Per entrambe le azioni, l’utente può scegliere esplicitamente uno spazio nello stesso modulo prima di salvare.

- La Home riunisce chat private e spazi di gruppo in un’unica lista per ultima attività. Riccardo vuole distinguere a colpo d’occhio il tipo di conversazione, anche quando i due tipi si alternano nella lista.
- La lista segue l’ultimo messaggio o file condiviso, dal più recente. L’ingresso di un membro compare nella cronologia senza far risalire lo spazio in Home. Una menzione personale resta segnalata nella posizione cronologica della conversazione.
- L’anteprima mostra l’ultimo messaggio anche quando un messaggio precedente contiene una menzione personale non letta. Sulla stessa riga, la `@` apre direttamente quel messaggio. Il normale accesso alla conversazione conserva la regola di rientro descritta sotto.
- Prova di Riccardo sulla Home attuale: per capire se qualcuno si è rivolto a lui deve aprire la chat. Accanto al nome dello spazio vuole distinguere i messaggi non letti, anche senza menzioni, e la @ per le menzioni personali.
- Esempio per verificare i futuri bozzetti: Lancio ha un messaggio di cinque minuti fa; Agenda ha una menzione di ieri ancora da leggere. Lancio resta primo e la menzione si riconosce sulla riga di Agenda.

Riccardo ha precisato la regola di rientro: toccando il nome di una conversazione già aperta si torna al punto in cui quella persona aveva lasciato la lettura, anche se stava rileggendo un passaggio precedente. Questa scelta raffina la precedente apertura sul primo non letto. Quando non si è in fondo deve essere disponibile un salto diretto al messaggio più recente. Toccare la `@` nella lista conserva la destinazione esplicita della menzione personale non letta. «Riassumi da qui» rimane associato al primo messaggio non letto.

«Vai in fondo» sposta soltanto la vista. Il salto non segna come letti i messaggi saltati. La `@` rimane finché la persona vede effettivamente il messaggio che contiene la menzione; raggiungere un messaggio successivo non basta.

Prova riferita da Riccardo: riaprendo uno spazio già letto in parte, la chat si è aperta sul messaggio più recente. Ha dovuto scorrere indietro per ritrovare il punto in cui si era fermato.

Con più menzioni non lette nello stesso spazio, la @ in Home apre la più vecchia. «Menzione successiva» porta alla prossima in ordine cronologico direttamente dalla chat. Il contatore personale scende per ciascuna menzione quando il messaggio corrispondente viene effettivamente visto.

Una risposta diretta compare in fondo alla chat al momento dell’invio. Sopra il testo, una riga cliccabile mostra l’autore del messaggio originale e un breve estratto. Toccarla porta a quel messaggio nella stessa cronologia, senza aprire un thread.

Nella chat di uno spazio, Riccardo cercherebbe «Chiedi a Emme» nel menu dei tre puntini del singolo messaggio, accanto a «Rispondi». Si aspetta di trovare il messaggio selezionato già citato nella richiesta.

Sia «Rispondi» sia «Chiedi a Emme» riportano il cursore nel campo principale della chat dello spazio, con il messaggio selezionato già citato. Con «Rispondi» la persona scrive la propria risposta; con «Chiedi a Emme» la richiesta è indirizzata a Emme. L’invio avviene quando la persona preme «Invia». Dallo stesso campo si può anche scrivere una domanda specifica direttamente a Emme.

Al primo ingresso in uno spazio si parte dall’ultimo scambio accessibile. I messaggi anteriori all’ingresso non contano come non letti. Dal secondo accesso si riprende dal proprio punto di lettura. Proposta per i bozzetti: mentre la persona legge più indietro, l’arrivo di messaggi mantiene fermo il punto di lettura.

Riccardo ha confermato [ADR-0009](../../../decisions/ADR-0009-visibilita-storica-membri-confine-condiviso-workspace.md) e scartato la selezione della cronologia per invito. Chi entra ha accesso a tutto ciò che è ancora conservato e condiviso nello spazio, compresi messaggi precedenti, file, Goal e decisioni. Chi invita vede questa condizione e il destinatario la accetta entrando. Chat e documenti personali restano privati.

In Home, un invito in attesa appare come riga sopra la lista degli spazi, con il nome di chi invita, il nome dello spazio e «Vedi invito». Accettare apre direttamente la chat dello spazio. La riga scompare dopo la risposta.

Quando la persona entra, la cronologia dello spazio mostra una riga discreta, per esempio «Giulia è entrata nello spazio». L’ingresso non genera una card, un saluto automatico di Emme o una notifica push.

Riccardo vuole poter aggiungere una foto al proprio profilo e un’immagine allo spazio. Ha confermato che chi è attualmente abilitato a contribuire nello spazio può cambiarne l’immagine. Proposta visiva: nella chat privata mostrare la persona con avatar tondo; nel gruppo mostrare l’immagine dello spazio in un riquadro arrotondato con un segno di gruppo. In assenza di immagini, mantenere la distinzione con iniziali e simboli.

Nel codice esaminato, la [Home Web](../../../../src/app/page.tsx) apre già lo spazio selezionato. La [query dell’elenco](../../../../src/server/queries.ts) ordina gli spazi per creazione crescente e il [contratto](../../../../src/contracts/v1.ts) restituisce nome e identificativo. Ultima attività, lettura personale e menzione non letta richiedono dati ulteriori per la Home.

Per lo sviluppo, verificare separatamente l’ultimo messaggio visibile alla persona, la destinazione delle sue menzioni ancora da leggere e il suo punto di rientro. Possono riferirsi a tre messaggi diversi. Lo stesso passaggio dai bozzetti ai contratti riguarda anche la riservatezza di chat e riepiloghi personali, i Preferiti individuali e la visibilità degli elementi di «Oggi». Riccardo darà le indicazioni di implementazione dopo la revisione UX.

## Chat privata tra due persone

Riccardo vuole poter scrivere direttamente a una persona dalla rubrica personale. La chat privata fra due persone è distinta dallo spazio collaborativo: si avvia senza titolo, Goal o passaggio manuale da «Crea spazio». La conversazione personale con la sola Emme è un altro percorso.

In Home «Tu ed Emme» è una voce fissa accanto a «Documenti personali». Riapre l’ultima chat privata con Emme nel punto in cui la persona l’aveva lasciata. «Nuova conversazione» apre un filo separato senza chiedere un titolo. Le chat precedenti restano accessibili.

Ogni nuova chat personale parte dal proprio filo. Su richiesta esplicita, Emme può aiutare a ritrovare una conversazione precedente; la persona sceglie se riaprirla. Dalla Home si possono fare domande private anche senza scegliere uno spazio. Se la domanda riguarda uno spazio, la persona seleziona la conversazione da consultare tra quelle a cui ha accesso. La consultazione prosegue nella chat personale già aperta. Dentro uno spazio si può interrogare la conversazione specifica.

Riccardo rimanda allo sviluppo le scelte backend su costi e uso delle risorse per le domande personali, per mantenere il focus del prodotto sulla collaborazione. L’intervista non stabilisce soglie o strategie tecniche.

Da «Tu ed Emme» si può avviare anche una ricerca approfondita personale, senza creare o selezionare uno spazio. Scegliere uno spazio rimane un’opzione per chi vuole avviarvi il lavoro. Questa precisazione supera l’ipotesi precedente di richiedere sempre una destinazione condivisa.

Se si avvia la ricerca personale mentre si consulta «Lancio RIMIAM», il risultato resta privato. La persona lo legge e può pubblicarlo con «Condividi in Lancio RIMIAM». La consultazione dello spazio e il completamento della ricerca non pubblicano il risultato.

Al rientro in Home, «Ricerca pronta» accanto a «Tu ed Emme» riporta al risultato nella conversazione personale di origine. Il completamento genera una notifica sul telefono solo se la persona ha attivato «Avvisami» per quella ricerca.

Durante la consultazione privata il nome della conversazione scelta resta visibile accanto a «Termina». Le domande successive possono riferirsi alla stessa conversazione finché la persona mantiene l’accesso e la consultazione è aperta. «Termina» rimuove quel riferimento per le domande successive. Le domande e le risposte restano nella chat personale anche durante la consultazione.

Proposta per il Web: «Scrivi» sul contatto apre la conversazione privata già esistente fra i due oppure il compositore del primo messaggio. Il dialogo ha un confine proprio rispetto al gruppo in cui i due si sono incontrati; i materiali di quel gruppo non vi vengono trasferiti. Oggi la rubrica alimenta il [selettore degli inviti](../../../../src/client/workspace-invite-picker.tsx).

Riccardo ha confermato l’esperienza del destinatario: se Matteo è già nella sua rubrica e gli scrive per la prima volta, la chat compare subito nella lista con il nome di Matteo e il messaggio non letto, senza accettazione preliminare. La scelta si riferisce alla chat diretta con un contatto esistente. L’ammissione agli spazi di gruppo resta disciplinata dalle regole degli inviti.

Il 19 novembre Riccardo ha corretto l’ipotesi precedente di abilitare Emme come interlocutrice delle due persone. Nella chat diretta la sola funzione AI è un riepilogo personale. Ciascuna persona dà esplicitamente il proprio consenso una sola volta per quella chat. Solo dopo entrambi i consensi, ciascuno può chiedere autonomamente il riepilogo dell’intera conversazione, inclusi i messaggi precedenti all’abilitazione. Il risultato è visibile soltanto a chi lo richiede. Emme non interviene nel dialogo, non risponde a domande libere e non attiva comandi, operazioni o strumenti collaborativi.

La chat offre «Crea uno spazio con questa persona». L’interfaccia spiega in privato che per fare domande a Emme o lavorare insieme con gli strumenti serve uno spazio. Riccardo ha confermato che il contatto è preselezionato nella creazione e che si può scrivere un’introduzione facoltativa e allegare documenti scelti per il nuovo spazio. La cronologia della chat privata, inclusi i suoi file, resta separata. Il flusso non importa messaggi, allegati precedenti o riepiloghi personali.

## Media dello spazio

In alto nello spazio le sole viste fisse sono «Chat» e «Condivisi». «Condivisi» apre file, media e collegamenti. Tornando a «Chat» si riprende dal punto di lettura lasciato prima di aprire il raccoglitore. «In programma», «Contesto» e «Direzione» si raggiungono da «Strumenti».

Nella prova sull’interfaccia attuale, Riccardo indica «Documenti» come primo posto in cui cercherebbe uno screenshot, ma il nome lo lascia incerto. Il percorso che si aspetta è «Condivisi» → «Media», dove può riconoscere l’immagine dall’anteprima.

Riccardo richiede filtri combinabili per data e tipo e delega le scelte di presentazione. Proposta: «Data di condivisione» offre ultimi 7 giorni, ultimi 30 giorni o un intervallo scelto; «Tipo» distingue immagini, PDF, documenti di testo, fogli di calcolo e altri file. «Media» apre direttamente le anteprime e mantiene disponibile il filtro data. Senza filtri si parte dai materiali condivisi più di recente.

Riccardo ricorda l’aspetto di uno screenshot e l’argomento della conversazione, raramente il nome del file. Se invia più screenshot insieme, il testo e le anteprime compaiono in un unico messaggio, nell’ordine scelto. In «Media» ciascuno screenshot ha una miniatura distinta per data di condivisione e permette di tornare al messaggio originale. Nei bozzetti si potrà verificare il percorso usando screenshot dal nome generico.

Nella prova Riccardo ha dovuto aprire il campo di scrittura per vedere la graffetta. La vuole visibile e utilizzabile accanto al campo anche quando è chiuso, sul Web sia da computer sia da telefono. Da computer vuole anche poter trascinare i file nella conversazione. Entrambi i gesti aggiungono gli allegati allo stesso messaggio in preparazione.

Nel dettaglio dello screenshot, Riccardo non ha individuato un modo chiaro per risalire alla conversazione. Vuole un’azione visibile «Vai al messaggio» che apra la chat direttamente sul messaggio in cui quello screenshot è stato condiviso.

Nella prova, chiudendo lo screenshot Riccardo è tornato a «Documenti». Se è partito da «Media», vuole che «Chiudi» lo riporti alla stessa posizione della raccolta, con i filtri ancora applicati. Il passaggio intenzionale alla chat avviene con «Vai al messaggio».

«Rispondi» si applica al messaggio completo. Chi commenta una foto specifica la indica nel testo, per esempio «Nel secondo screenshot…». L’anteprima ingrandita resta dedicata alla consultazione.

Prima di passare al Contesto, Riccardo ha indicato la struttura del raccoglitore di Teams come riferimento per questa sezione Web. Nello screenshot, «Recente» riunisce file e collegamenti per data di condivisione; sono visibili il nome, la data e chi ha condiviso. In alto si trovano i filtri per tipo, la ricerca per parola chiave e «Carica».

Proposta da valutare: aprire su «Recenti» con un elenco misto, mantenere «File» e «Collegamenti» e offrire «Media» come vista per immagini. In «Recenti» le immagini hanno una miniatura reale; in «Media» le anteprime sono più grandi e raggruppate per data. Sono due modi di consultare gli stessi materiali. La composizione visiva resta da scegliere.

Riccardo ha confermato che «Carica» deve anche pubblicare il file in chat a nome della persona che lo carica. La vista «Preferiti» dentro il raccoglitore è personale: il file rimane in «Condivisi» per chi ha accesso allo spazio, mentre solo chi lo segna con la stella lo ritrova nei propri «Preferiti».

Quando Emme genera un documento su richiesta, Riccardo vuole aprire un’anteprima. Se la chiude, ritrova il file nei propri «Documenti personali» e può condividerlo nello spazio in un secondo momento. Soltanto «Condividi in chat» pubblica il file nella conversazione e lo rende disponibile nel raccoglitore del gruppo.

Nella condivisione dai «Documenti personali» è preselezionato lo spazio di origine. La persona può scegliere un altro spazio in cui può condividere. Il pulsante riporta il nome della destinazione effettiva e si aggiorna quando cambia la selezione, per esempio «Condividi in Cliente».

Il file deve essere scaricabile in un formato modificabile all’esterno. Se qualcuno modifica la copia esterna e la ricarica, il caricamento crea un documento distinto anche a parità di nome; lo spazio conserva l’originale e il relativo messaggio. Questa indicazione UX differisce dalla [specifica degli Artifact, §5.1](../../../product/MVP_SPEC_v0.1.md#51-artifacts) e dal comando Web «Prepara una revisione». Il rapporto con le revisioni degli Artifact va riconciliato prima dello sviluppo.

Per materiali destinati a persone diverse, Riccardo immagina di scegliere un altro spazio. Il riferimento esistente sono gli [spazi collegati](../../../../src/client/workspace-links.tsx): ciascuno conserva il proprio pubblico e il collegamento è visibile a chi accede a entrambi. Nel bozzetto, mostrare il nome dello spazio di destinazione accanto al caricamento aiuta a prevedere dove apparirà il file. Una gerarchia con ereditarietà dei permessi non è stata richiesta o approvata.

## Ingresso al Contesto condiviso

Riccardo vuole una schermata iniziale neutra: nessun contenuto dello spazio viene mostrato direttamente. L’ingresso è una mini chat di consultazione con Emme. Una frase breve chiarisce che qui si fanno domande sul contesto di questo spazio; due domande suggerite mostrano come iniziare. La persona può scrivere una domanda libera. La precedente ipotesi di aprire su riepiloghi o su un indice in primo piano è superata.

Riccardo ha confermato che la risposta resta nella mini chat del Contesto. Compare nella conversazione del gruppo soltanto quando la persona preme «Condividi in chat». Al rientro si vedono le due domande suggerite. Se la persona ha già consultato il Contesto di quello spazio, «Riprendi l’ultima consultazione» permette di rileggere la sua risposta con la data originale.

Proposta per i bozzetti: da una risposta si può risalire al passaggio pertinente e capire se si tratta di un riferimento accettato, di una proposta o di una questione aperta. Consultare o condividere una risposta non registra una decisione né accetta informazioni.

## Attività e promemoria dello spazio

Riccardo ha scelto una vista iniziale di gruppo, ordinata per scadenza. «Solo mie» è un filtro esplicito per concentrarsi sulle proprie attività. «In programma» è un titolo di lavoro per il bozzetto.

Una proposta di attività indirizzata a una persona appare in chat come riga cliccabile. La riga apre il dettaglio con «Accetta» e «Rifiuta». Fino alla risposta, la proposta è raggiungibile anche da «In attesa di te» nella Home del destinatario. Entrare nel dettaglio non assume la responsabilità: l’attività compare tra «Solo mie» dopo l’accettazione esplicita.

All’accettazione, la stessa riga mostra chi ha accettato e lo stato è consultabile in «In programma». Questo aggiornamento non aggiunge un messaggio in chat né invia un avviso personale a chi aveva proposto l’attività.

Quando una persona chiede esplicitamente a Emme un promemoria indicando cosa ricordare, quando e a chi, Emme lo imposta subito. A salvataggio riuscito, una riga conferma destinatari e orario e offre «Modifica». Se manca soltanto l’orario, Emme chiede soltanto quello.

Anche nella chat di gruppo, «ricordami» crea un promemoria personale in «Solo io»: alla scadenza avvisa soltanto chi lo ha chiesto. «Ricordaci» crea un promemoria dello spazio con richiamo nella chat del gruppo. Il messaggio di richiesta resta visibile nella conversazione in cui è stato inviato. Chi ha creato un promemoria, personale o condiviso, può riaprirlo e modificarlo anche dopo la conferma.

Quando si crea un promemoria nel gruppo, «Per tutti» indica i membri attivi dello spazio. Chi entra successivamente è incluso nelle scadenze future dei promemoria «Per tutti» già programmati, singoli e ricorrenti, senza aggiornare i destinatari a mano. Ricevere il richiamo non assegna una responsabilità personale.

Chi entra dopo la scadenza può leggere il richiamo già pubblicato nella cronologia. Se entra più tardi nella stessa giornata e il promemoria è ancora aperto, lo vede anche nel proprio «Oggi». L’ingresso non genera una notifica retroattiva.

«Nascondi per me» toglie il promemoria condiviso soltanto dal proprio «Oggi». Chi lo ha creato può invece scegliere «Chiudi per tutti». Se il promemoria è ricorrente, la chiusura collettiva riguarda solo quella scadenza e conserva le successive.

## Decisioni nella conversazione e chiusura dei pannelli

In «Direzione», Riccardo vuole l’obiettivo dello spazio in una riga e subito sotto le decisioni già prese. Quando una o più proposte attendono una risposta proprio dalla persona che sta leggendo, compare «In attesa di te» con il relativo numero.

In Home il segnale inizialmente chiamato «Da decidere» indica una risposta importante richiesta a quella persona. Nasce da un gesto esplicito dell’utente sul messaggio e rimane visibile fino alla risposta. La normale notifica della chat è sufficiente. La @ resta dedicata alle menzioni e l’ordine degli spazi segue l’ultima attività. Una richiesta di risposta può riguardare anche un normale messaggio. Attribuirgli priorità o rispondere non adotta una decisione. Per una proposta formale restano necessari l’inoltro esplicito a chi deve decidere e l’atto previsto.

Questa scelta riguarda anche le capacità di Emme. Può suggerire o preparare una proposta. Non può stabilire autonomamente che serva una risposta, scegliere chi debba darla o attivare una richiesta di decisione. La pertinenza rispetto al Goal, da sola, non produce richieste di attenzione.

Il destinatario può chiudere il proprio richiamo in due modi: invia una risposta diretta al messaggio oppure seleziona «Già risposto» se ha già dato riscontro, anche altrove. Leggere il messaggio, scrivere su un altro argomento o aprire il compositore non rimuove il richiamo. «Già risposto» chiude l’avviso personale e lascia intatto lo stato di un’eventuale proposta formale.

Se la stessa richiesta è rivolta a più persone, ogni destinatario ha un avviso indipendente. La risposta o «Già risposto» di Riccardo chiude solo il suo avviso; quello di Giulia resta aperto fino al suo riscontro.

Guardando «Traccia», Riccardo terrebbe la chat compatta ma trova la schermata ancora anonima quando copre il marchio. Vuole riconoscere Emme al volo dalla combinazione del logo stilizzato accanto al nome e di un colore distintivo per il nome e il testo della risposta. Il messaggio rimane nel flusso ordinario, senza card.

La firma sta sopra il messaggio. Sul computer comprende una piccola immagine (per Emme il logo), il nome, la data e l’ora di invio. Sul Web da telefono le persone hanno solo il nome; Emme mantiene il piccolo logo stilizzato accanto al nome e il suo colore sia sul nome sia sulla risposta. All’inizio di ogni giornata un separatore riporta il giorno della settimana corrente, oppure la data per le giornate precedenti, e l’ora di inizio. Dopo una lunga pausa nella stessa giornata riappare soltanto l’ora. La soglia di due ore è un’ipotesi del bozzetto.

Durante il lavoro di Emme in background, a Riccardo basta l’indicatore in alto. Al completamento vuole una sola riga discreta e cliccabile nella cronologia, senza card. Dal titolo si deve poter riaprire lo stesso risultato anche il giorno dopo. La riga segnala che il lavoro è pronto; l’eventuale adozione rimane un atto distinto.

Sul computer Riccardo vuole aprire il risultato accanto alla conversazione, con «Allarga» per leggere un documento lungo. Chiudere il dettaglio deve riportarlo allo stesso passaggio della chat. Proposta per il Web su telefono: dettaglio a schermo intero con «Chiudi» sempre raggiungibile; il ritorno usa il messaggio o l’evento come punto di lettura anche se nel frattempo sono arrivati messaggi.

Per un confronto lungo richiesto a Emme nella chat, il messaggio riporta la conclusione e il motivo principale. «Leggi il confronto completo» apre il dettaglio e, alla chiusura, si torna allo stesso punto della conversazione.

Il confronto resta riapribile dal messaggio originale. Compare nel raccoglitore del gruppo solo quando una persona sceglie «Salva in Condivisi». Da quel momento tutti i membri con accesso allo spazio possono ritrovarlo anche lì.

Se la risposta cita un solo documento, sotto il testo compare un riferimento cliccabile che apre il documento al passaggio citato. Se le fonti sono più di una, compare soltanto il conteggio («3 fonti»); l’elenco si apre su richiesta.

Nel dettaglio, «Chiedi in chat» apre il campo di scrittura dello spazio con il confronto già citato. La persona scrive la domanda e decide quando inviarla al gruppo. Il percorso usa la chat dello spazio, senza aprire una conversazione privata aggiuntiva.

Se una domanda a Emme incontra il limite giornaliero, un unico avviso compare sotto la domanda originale. Quando torna disponibile una chiamata, «Riprova» permette di rilanciarla su richiesta. Il ripristino della disponibilità non fa ripartire da solo la domanda.

Riccardo ha scelto «Riassumi da qui» sul primo messaggio non letto. Al rientro la sintesi viene preparata solo su richiesta e si consulta in una vista personale, con rimandi ai messaggi originali. Anche in uno spazio di gruppo, la generazione non invia messaggi nella conversazione dello spazio né in «Tu ed Emme». Solo «Condividi in chat» pubblica il riepilogo nel gruppo.

Il riepilogo apre con due o tre righe su cosa è successo nel gruppo. Segue «Ti riguarda» soltanto in presenza di una menzione della persona o di una richiesta di risposta esplicitamente rivolta a lei nei messaggi riepilogati.

«Condividi in chat» pubblica soltanto le due o tre righe sul gruppo con i rimandi ai messaggi originali. «Ti riguarda» rimane nella vista personale anche dopo la condivisione.

Per contenere i riepiloghi inutili, distinguere tre comportamenti verificati nel backend locale: il [worker](../../../../src/server/worker-runner.ts) controlla ogni 30 secondi i lavori da recuperare, senza un digest periodico della chat; il [rientro](../../../../src/server/attention.ts) può leggere i cambiamenti strutturati senza un’inferenza; il [brief autonomo](../../../../src/server/active-work-worker.ts) ha condizioni proprie ed è escluso in modalità discreta. La [creazione del lavoro](../../../../src/server/active-work-commands.ts) riusa quello esistente per la stessa chiave di tema. La frequenza effettiva in produzione non è stata misurata.

Il 19 novembre Riccardo ha scelto di mostrare la decisione adottata come riga discreta nella cronologia. La riga si apre sul dettaglio della decisione. La proposta grafica esclude una card tra i messaggi.

Riccardo ha segnalato che oggi deve cercare la piccola «×». Per tutti i popup e pannelli sovrapposti del Web vuole una chiusura evidente, facile da raggiungere e visivamente discreta. Come soluzione da provare nei bozzetti: «Chiudi ×» in una posizione coerente, raggiungibile anche durante lo scorrimento. Per le bozze, la chiusura deve rispettare il flusso di conservazione o conferma già previsto.

## Identità e perimetro

**Aggiornamento successivo all’intervista, 19 novembre.** Riccardo ha eliminato la personalizzazione degli sfondi. L’aspetto offre «Come il dispositivo», «Chiaro» e «Scuro». Le immagini per identificare una persona o uno spazio e i media condivisi in chat hanno funzioni distinte. [Schermate della realizzazione Web locale](verifica/README.md).

Riccardo vuole una direzione originale. Palette, caratteri e trattamenti dei temi chiaro e scuro sono aperti. Il richiamo a WhatsApp riguarda il comportamento della lista spazi. La revisione comprende Home personale, conversazione e singole sezioni Web.

La [galleria](index.html) documenta il punto di partenza. Durante l’intervista Riccardo ha autorizzato il [confronto isolato fra Attuale, Traccia e Voci](direzioni/index.html). Le tre viste riprendono la stessa conversazione di prova a 1440 × 900. Nei bozzetti interattivi si possono aprire la decisione e il risultato, controllare l’origine e chiudere tornando alla lettura. Il ritmo compatto di Traccia è il punto di partenza. Riccardo giudicherà l’identità visiva sul Web e darà separatamente il via alle modifiche dell’app.

## Segnalazioni Web del 21 novembre 2026 · Condivisi e Partecipanti

Annotate dagli screenshot e dal racconto di Riccardo. Riproduzione tecnica e questionario ancora da fare.

| Area | Segnalazione e risultato desiderato |
| --- | --- |
| Link lunghi | Dopo la condivisione di un link lungo si può trascinare la pagina verso destra. Il link deve restare leggibile entro la larghezza della colonna, senza scorrimento orizzontale della pagina. Riferimento allo screenshot delle 01:53:09. |
| Condivisi | La presentazione dei link è difficile da leggere. Impaginarli insieme agli altri contenuti condivisi e renderli ritrovabili con il filtro per tipo «Link». |
| Rimozione dei media | Su ogni elemento deve essere facile trovare l’azione di rimozione e capire chi ne subirà l’effetto. Nel prossimo questionario confrontare «Nascondi per me» e «Elimina per tutti», chiarendo chi può agire sui propri caricamenti, cosa può fare sugli elementi altrui e cosa rimane nel messaggio originale. Il comportamento è ancora da scegliere. |
| Partecipanti | Rivedere le righe di «Persone e accesso». Nello screenshot delle 01:57:38 il nome di chi è senza foto inizia più a sinistra. Riservare lo stesso spazio all’avatar in tutte le righe e mostrare le iniziali quando manca la foto, come nel riferimento a Teams. |
| Finestra «Condivisi» | Nello screenshot delle 01:59:23 Riccardo fatica a capire cosa troverà nel pannello. Segnala la barra superiore, le icone e la presentazione di «Allega file» e «Nuova nota». Premere la freccia indietro gli sembra poco naturale. A raccolta conclusa, ricostruire da dove aveva aperto il pannello, dove si aspettava di tornare e come distingue «Indietro» da «Chiudi». |
| Collegamento a Google Calendar | Nella beta Web, dopo «Collega calendario», Google blocca l’autorizzazione con l’errore `403 access_denied`. La schermata delle 02:04:19 indica che l’app è in fase di test, con verifica Google incompleta e accesso limitato ai tester approvati. Il calendario dell’account usato resta scollegato. A raccolta conclusa, verificare la configurazione OAuth della beta e il percorso previsto per chi collega il proprio calendario. |
| Area personale → Documenti | Riccardo chiede una vista più leggibile e intuitiva. Nello screenshot delle 02:06:34, anche a raccolta vuota, compaiono «I tuoi file» e «I tuoi documenti», la scheda «Collegamenti» e la sezione «Pagine web». I comandi per allegare, aggiungere un link o creare un documento sono in punti diversi. Nel questionario riprendere due casi concreti: dove cercherebbe qualcosa di già salvato e da dove partirebbe per aggiungere il primo elemento. |
| Area personale → Promemoria | Riccardo segnala disordine visivo e difficoltà a riconoscere le azioni. Nello screenshot delle 02:08:05 la stessa campanella compare per «Notifiche personali», per la scheda «Promemoria» e per «Nuovo promemoria». La freccia per aprire un promemoria è all’estremità destra, lontana dal titolo e dall’orario. Da riprendere nel questionario distinguendo i gesti di creare un promemoria, aprirne uno esistente e configurare gli avvisi. |
| Area personale → Tu ed Emme | Riccardo vuole che la barra laterale di navigazione del Web resti accessibile anche nella chat personale con Emme, così può passare direttamente agli spazi senza dover prima tornare alla Home. |
| Home → Oggi | Riccardo riferisce che, premendo «Oggi», la sezione non si apre e non compare alcun cambiamento visibile. Il comando preciso usato (voce della barra laterale o intestazione in Home) e la riproduzione restano da verificare. |
| Pulsante della barra laterale | Nello screenshot delle 02:13:54 Riccardo chiede di ingrandire l’icona che apre e chiude la barra laterale e di curarne la forma, così che il comando sia più riconoscibile. |
| Disposizione della barra laterale | Negli screenshot delle 02:15:04 e 02:16:29, «Tu ed Emme», «Configura Emme» e «Oggi» separano «I tuoi spazi» dall’elenco degli spazi. Riccardo chiede di raccogliere gli spazi subito sotto quella voce e di rivedere distanze e allineamenti. Nella parte libera in basso desidera il logo stilizzato di RIMIAM. Nel questionario valutare se lì serva anche un’azione rapida e quale gesto faciliterebbe. |
