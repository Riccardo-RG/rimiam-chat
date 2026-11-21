# Provare RIMIAM sul proprio iPhone

## Mettere RIMIAM sulla schermata Home oggi

1. Apri la [beta di RIMIAM](https://rimiam-chat-web-production.up.railway.app/) direttamente in **Safari**. Se ti arriva su WhatsApp, usa «Apri in Safari».
2. Tocca **Condividi → Aggiungi alla schermata Home**. Se compare **Apri come app web**, lascialo attivo. Tocca **Aggiungi**.
3. Apri **RIMIAM** dalla nuova icona e accedi con l’account con cui hai ricevuto l’invito. Se avevi già l’icona della beta sullo stesso indirizzo, riaprila. Per una vecchia scheda ferma sulla versione precedente, salva quello che stavi scrivendo e ricarica una volta.

La versione Web viene servita da Railway. Una build nativa per iPhone si distribuisce separatamente. [Guida Apple alle app web](https://support.apple.com/it-it/guide/iphone/iphea86e5236/ios)

## Una prova di cinque minuti in due

| Sul tuo iPhone | Cosa dovresti vedere |
| --- | --- |
| Apri la Home e poi uno spazio di prova condiviso con una seconda persona. | Prima le conversazioni, poi Personale, infine Oggi. |
| Scrivi «Prova iPhone 1». Con la tastiera ancora aperta tocca Invia. Chiedi all’altra persona di rispondere. | Entrambi vedete il messaggio una sola volta. Il campo si svuota. La risposta arriva senza aggiornare la pagina. |
| Tocca il campo di scrittura e poi la graffetta. Scegli una foto di prova e inviala. | L’anteprima appare prima dell’invio. L’altra persona vede la foto in chat e in Condivisi. |
| Scrivi «Quale foto abbiamo appena condiviso?» e invia con «Chiedi a Emme». | Con il servizio disponibile, Emme risponde sotto la richiesta o nel flusso della chat. Se il servizio registra un errore, la domanda resta e l’avviso compare sotto di essa. Una richiesta ancora in coda può impiegare tempo. |
| Dall’icona sulla Home, apri lo spazio e tocca la campanella → **Attiva per questo spazio**. Accetta l’avviso di iOS. Blocca il telefono e fai inviare un nuovo messaggio dall’altro account. | L’avviso arriva sul telefono e apre lo spazio giusto. Se resta silenzioso controlla **Impostazioni → Notifiche → RIMIAM** e **Full immersion**. |

Per segnalare un problema bastano modello di iPhone, versione iOS, orario e pulsante premuto. Per un mancato invio, il dettaglio più utile è se l’altra persona ha ricevuto il messaggio.

## Scaricare la beta nativa

Per installarla in due senza tenere collegato il Mac, il canale previsto è **TestFlight**. Occorrono una build iOS firmata, il caricamento su App Store Connect e l’invito ai tester. Per i tester esterni il primo build deve superare la verifica beta di Apple. Una volta ricevuto l’invito, si installa TestFlight dall’App Store, si apre l’invito sull’iPhone e si tocca **Installa**. Il deploy Railway aggiorna il servizio utilizzato dall’app.

Per una prova di sviluppo sul solo iPhone collegato al Mac si può anche compilare il progetto nativo con Xcode, usando un team e un profilo di firma compatibili con le funzionalità da provare. [Progetto mobile e avvio locale](MULTICLIENT.md#run-the-mobile-app) · [TestFlight di Apple](https://developer.apple.com/testflight/)
