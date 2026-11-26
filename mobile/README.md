# RIMIAM per iOS e Android

Questa app accede alla chat tramite l’API v1 di RIMIAM. Le regole della beta, l’identità del mittente e i permessi provengono dal server. Il collaudo usa account fittizi su un server locale. Il codice del client è in `lib/`. I runner iOS e Android vengono generati in una directory di build.

La schermata di accesso mostra l’indirizzo dell’installazione. «Cambia installazione» permette di scegliere il proprio server HTTPS. Ogni installazione conserva una sessione distinta. Chi distribuisce una build può proporre il proprio indirizzo con `--dart-define=RIMIAM_ORIGIN=https://rimiam.example.org`. Durante lo sviluppo sono disponibili anche gli indirizzi HTTP locali dei simulatori.

## Navigazione personale

Su telefono, tocca il titolo con la freccia per aprire il menu da «I tuoi spazi», «Tu ed Emme», «Documenti personali», «Configura Emme» e «Oggi». Gli spazi recenti compaiono sotto «I tuoi spazi». «Altri spazi» mostra il resto dell’elenco. Su tablet con almeno 840 pixel logici di larghezza, la barra laterale è sempre visibile.

Si può passare dalla chat personale all’agenda direttamente. «Indietro» riporta alla Home. Se un editor richiede conferma prima di uscire, chiudilo o salva le modifiche prima di cambiare sezione.

Nella chat di gruppo, data e ora separano le giornate e gli scambi distanti almeno due ore. Sul telefono il nome introduce una serie di messaggi della stessa persona. Emme mantiene il proprio simbolo. Sul tablet compare anche la foto di chi scrive, oppure le sue iniziali. Quando uno stesso messaggio ha più suggerimenti, tocca «Passi proposti» per leggerli. Aprirli lascia a te la scelta di agire.

In «Tu ed Emme», «Consulta uno spazio» sceglie la conversazione da usare per le domande successive. Il suo nome rimane visibile fino a «Termina». Domanda e risposta restano personali. Una fonte si apre sotto la risposta. Se ce ne sono più di una, tocca il conteggio. Da una fonte collegata a un messaggio, «Vai al messaggio» apre quel punto nel gruppo. «Indietro» riporta alla risposta e alla bozza personale.

Durante una stessa consultazione, Emme può usare le due risposte precedenti per capire una domanda successiva. Se termini e scegli di nuovo lo spazio, parte una nuova consultazione. Le vecchie risposte restano consultabili finché conservi l’accesso originario. «Riprova consultazione» usa la stessa domanda e compare solo mentre è ancora selezionata la conversazione in cui l’hai posta.

In «Tu ed Emme», la graffetta salva il file nella conversazione personale aperta. Resta visibile solo a te anche mentre consulti uno spazio. Tocca il file per aprire l’anteprima. «Vai al messaggio» torna al punto in cui l’hai salvato. Per creare un documento dalla conversazione, tocca «Prepara documento». L’anteprima indica dove ritrovarlo e «Apri Documenti personali» apre il tuo archivio. Da lì puoi scegliere se condividerlo e in quale spazio.

Con la fixture locale sulla porta 3102, `flutter test test/personal_attachment_local_fixture.dart` salva il TXT «Riservato» in una nuova chat mentre il primo account consulta **Native shared verification**. Il test interrompe la risposta dopo il salvataggio, riapre il trasferimento e controlla i byte dell’originale, il mittente e l’assenza di un secondo invio. Il secondo account verifica che il file sia inaccessibile e assente nella raccolta del gruppo.

## Identità e firma di distribuzione

L’host Android usa una firma di debug per il collaudo. Per firmare una build di distribuzione, impostare nel proprio ambiente protetto `RIMIAM_ANDROID_KEYSTORE` (percorso assoluto), `RIMIAM_ANDROID_STORE_PASSWORD`, `RIMIAM_ANDROID_KEY_ALIAS` e `RIMIAM_ANDROID_KEY_PASSWORD`. Se tutte e quattro sono assenti, Gradle configura la variante release senza firma. Per aggiornare un’installazione esistente servono l’identificativo e la firma compatibili, oltre a un numero di build superiore a quello installato. Per l’upgrade in locale sono documentati i [risultati su Android e iOS](../docs/development/NATIVE_UPGRADE.md).

## Riprodurre

Con Flutter 3.50.1, dalla directory `mobile/`:

```sh
flutter pub get
flutter test
```

Per il collaudo interattivo genera i runner in una directory temporanea. Lo script copia i sorgenti e gli asset, configura il portachiavi di iOS e disabilita il backup dei dati dell’app Android. Usa identificativi dedicati alla prova.

```sh
dart run tool/prepare_host.dart
```

Per generare un host con l’identità della propria installazione usa `dart run tool/prepare_host.dart --app-id=com.rimiam.chat --output=/percorso/nuovo/rimiam-app`. La directory deve essere nuova. Aprila, esegui `flutter pub get --enforce-lockfile` e poi `flutter run`. Per un aggiornamento distribuito occorrono anche la firma della precedente app e un numero di build superiore. Una build con identificativo di collaudo si installa separatamente.

Per compilare la release iOS serve Xcode 26.1 o successivo. LiveKit usa `device_info_plus`, che interroga una proprietà di Foundation introdotta nell’SDK 26.1 con controllo della versione a runtime. Per il solo simulatore con Xcode 26.0, esegui dalla directory dell’host `XCODE_XCCONFIG_FILE="$PWD/ios/Flutter/RimiamSimulatorSDK26.xcconfig" flutter run -d <id>`. La configurazione integra la dichiarazione nel solo target del plugin con l’SDK simulatore 26.0. [Documentazione Apple](https://developer.apple.com/documentation/foundation/processinfo/isiosapponvision)

Avvia l’API locale con il database di prova e due utenti verificati ammessi allo stesso spazio. Il server usato nel collaudo ascoltava sulla porta 4633. La [fixture nativa del repository](../tests/run-native-server.ts) usa la porta 3102. Apri la directory indicata dallo script, esegui `flutter pub get`, scegli il simulatore con `flutter devices` e avvia `flutter run -d <id> --dart-define=RIMIAM_TEST_PORT=3102` per questa fixture.

Con la fixture locale su 3102, usa `native-ios@example.test` come mittente e `native-android@example.test` come destinatario. La [fixture](../tests/run-native-server.ts) crea gli account di prova e li ammette entrambi in **Native shared verification**. Apri quello spazio su entrambi i client, scrivi **Verifica tastiera 01** dal primo, lascia aperta la tastiera di sistema e premi **Invia** una volta. Il campo si svuota e la frase appare una sola volta sul secondo client. Se ripeti sullo stesso database, cambia il suffisso in **02** per distinguere i due invii.

Per verificare gli inviti crea un nuovo record dal primo account. In **Nuovo spazio** usa il nome **Collaudo invito 01**, l’introduzione **Prima nota del gruppo** e scegli **Native android tester** dalla rubrica. Conferma la visibilità della cronologia e premi **Crea spazio e invita**. Il creatore entra nella nuova chat. Il secondo account vede l’invito nella Home, accetta la visibilità della cronologia, entra nello stesso spazio e vi trova l’introduzione. In un database riutilizzato usa un suffisso nuovo. Il test `flutter test test/workspace_creation_local_fixture.dart` esercita lo stesso contratto su questa fixture anche con un TXT e una risposta persa.

Per verificare il recupero scrivi una bozza, manda l’app in background, termina il processo e riapri lo stesso spazio. Il server verifica la sessione al riavvio. La bozza riappare per il suo autore e l’altro membro riceve il messaggio dopo la pressione di «Invia». Se l’esito di un invio è incerto, «Verifica e riprova» cerca la ricevuta e riusa lo stesso identificativo. Il [rapporto di verifica](../docs/development/MULTICLIENT.md#flutter-chat-feasibility-on-26-november-2026) distingue le prove su nuove installazioni dalla migrazione dei dati di React Native.

Per verificare le menzioni usa lo stesso spazio della fixture. Come mittente digita `@Native`, scegli **Native android tester**, aggiungi **Controlla la bozza 01** e invia. Con l’altro account tocca la @ accanto allo spazio e verifica che il messaggio abbia quel testo. Il test `flutter test test/group_addressing_local_fixture.dart` esegue anche la perdita della conferma dopo l’invio e verifica una sola registrazione sul server.

Nel campo vuoto dello spazio, digita `/file`, poi scegli **Apri il raccoglitore**. Ripeti con `/documenti`. Entrambi aprono **Condivisi**. Nel menu di una foto apri l’anteprima, poi **Chiedi a Emme su questo file**. In chat deve comparire il nome del file nel campo principale. La domanda parte quando premi **Invia**. Per aggiornare il catalogo Flutter dopo una modifica di quello Web, dalla radice esegui `node --import tsx mobile/tool/sync_composer_actions.ts`. Con `--check` lo stesso script verifica che i due cataloghi corrispondano.
