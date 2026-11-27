# Provare RIMIAM sul proprio iPhone

## Mettere RIMIAM sulla schermata Home oggi

1. Apri la [beta di RIMIAM](https://rimiam-chat-web-production.up.railway.app/) direttamente in **Safari**. Se ti arriva su WhatsApp, usa «Apri in Safari».
2. Tocca **Condividi → Aggiungi alla schermata Home**. Se compare **Apri come app web**, lascialo attivo. Tocca **Aggiungi**.
3. Apri **RIMIAM** dalla nuova icona e accedi con l’account con cui hai ricevuto l’invito. Se avevi già l’icona della beta sullo stesso indirizzo, riaprila. Per una vecchia scheda ferma sulla versione precedente, salva quello che stavi scrivendo e ricarica una volta.

La versione Web viene servita da Railway. Una build nativa per iPhone si distribuisce separatamente. [Guida Apple alle app web](https://support.apple.com/it-it/guide/iphone/iphea86e5236/ios)

## Una prova di cinque minuti in due

| Sul tuo iPhone                                                                                                                                                                               | Cosa dovresti vedere                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Apri la Home e poi uno spazio di prova condiviso con una seconda persona.                                                                                                                    | Prima le conversazioni, poi Personale, infine Oggi.                                                                                                                                                                            |
| Scrivi «Prova iPhone 1». Con la tastiera ancora aperta tocca Invia. Chiedi all’altra persona di rispondere.                                                                                  | Entrambi vedete il messaggio una sola volta. Il campo si svuota. La risposta arriva senza aggiornare la pagina.                                                                                                                |
| Tocca il campo di scrittura e poi la graffetta. Scegli una foto di prova e inviala.                                                                                                          | L’anteprima appare prima dell’invio. L’altra persona vede la foto in chat e in Condivisi.                                                                                                                                      |
| Scrivi «Quale foto abbiamo appena condiviso?» e invia con «Chiedi a Emme».                                                                                                                   | Con il servizio disponibile, Emme risponde sotto la richiesta o nel flusso della chat. Se il servizio registra un errore, la domanda resta e l’avviso compare sotto di essa. Una richiesta ancora in coda può impiegare tempo. |
| Dall’icona sulla Home, apri lo spazio e tocca la campanella → **Attiva per questo spazio**. Accetta l’avviso di iOS. Blocca il telefono e fai inviare un nuovo messaggio dall’altro account. | L’avviso arriva sul telefono e apre lo spazio giusto. Se resta silenzioso controlla **Impostazioni → Notifiche → RIMIAM** e **Full immersion**.                                                                                |

Per segnalare un problema bastano modello di iPhone, versione iOS, orario e pulsante premuto. Per un mancato invio, il dettaglio più utile è se l’altra persona ha ricevuto il messaggio.

## Installare Flutter dal Mac sul proprio iPhone

1. Per questa build usa **Xcode 26.1 o successivo**, compatibile con la versione iOS del telefono. Collega l’iPhone via USB, sbloccalo e tocca **Autorizza**. In **Impostazioni → Privacy e sicurezza → Modalità sviluppatore**, attiva la modalità, riavvia e conferma. Se la voce manca, apri prima Xcode con l’iPhone collegato.
2. In **Xcode → Settings → Accounts** aggiungi il tuo Apple Account. Per provare l’app sul tuo dispositivo basta il **Personal Team** gratuito. Il suo profilo scade dopo sette giorni; puoi reinstallare dal Mac.
3. Nell’[host generato da Flutter](../../mobile/README.md#riprodurre) apri `ios/Runner.xcworkspace`. Seleziona **Runner → TARGETS → Runner → Signing & Capabilities**, attiva **Automatically manage signing** e scegli il tuo team. Se l’identificativo è già occupato da un altro team, usa un bundle ID dedicato per il collaudo.
4. Dalla cartella dell’host, esegui `flutter devices` per individuare l’iPhone. Sostituisci `ID_IPHONE` nel comando seguente. La build release si può riaprire dall’icona anche dopo aver staccato il cavo.

   ```sh
   flutter run --release -d ID_IPHONE --dart-define=RIMIAM_ORIGIN=https://rimiam-chat-web-production.up.railway.app
   ```

5. Se iOS chiede di autorizzare lo sviluppatore, vai in **Impostazioni → Generali → VPN e gestione dispositivo** e autorizza il certificato. Apri RIMIAM e controlla che il server indicato nella schermata di accesso sia la beta Railway.

**Primo accesso.** Con un account RIMIAM esistente usa lo stesso metodo del Web. Per un nuovo account con password, tocca **Crea account**, inserisci nome, email e una password da 12 a 128 caratteri. Apri il link di verifica ricevuto per email, poi torna nell’app e accedi. [Installazione Flutter su iPhone](https://docs.flutter.dev/platform-integration/ios/setup) · [Personal Team e durata della firma](https://developer.apple.com/help/account/basics/about-your-developer-account)

## Distribuire la beta con TestFlight

Per installarla in due senza tenere collegato il Mac, il canale previsto è **TestFlight**. Occorrono una build iOS firmata, il caricamento su App Store Connect e l’invito ai tester. Per i tester esterni il primo build deve superare la verifica beta di Apple. Una volta ricevuto l’invito, si installa TestFlight dall’App Store, si apre l’invito sull’iPhone e si tocca **Installa**. Il deploy Railway aggiorna il servizio utilizzato dall’app.

[TestFlight di Apple](https://developer.apple.com/testflight/)
