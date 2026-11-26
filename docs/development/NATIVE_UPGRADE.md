# Aggiornare un’installazione mobile

Chi aggiorna una precedente installazione React Native deve accedere a Flutter con lo stesso account e lo stesso indirizzo del server. Il recupero cerca solo bozze e operazioni sospese appartenenti a quell’account e a quella conversazione. Lo storico già inviato arriva dal server dopo il normale controllo degli accessi.

## Cosa trova la persona

- In uno spazio o in una chat privata, **Recupera dalla versione precedente** apre la bozza salvata sul telefono. **Riprendi nel campo di scrittura** conserva testo e allegati disponibili. Una bozza già presente nel campo ha la precedenza. Per riprendere una bozza con file irreperibili si può scegliere esplicitamente di proseguire senza quei file.
- Le citazioni e le menzioni del gruppo sono riprese dopo aver ricontrollato messaggi e partecipanti. L’identificativo immutabile di un file citato deve appartenere a una fonte ancora visibile. L’argomento della vecchia bozza resta consultabile. Quando il contesto originale non è ripristinabile la persona può riprendere esplicitamente solo testo e allegati.
- Se un invio poteva già essere partito, **Verifica ricevuta** consulta il server con l’identificativo originale. Una ricevuta assente lascia l’esito aperto. La bozza collegata a quell’invio resta consultabile. Aprire il pannello, controllare la ricevuta e riavviare l’app non invia messaggi.
- Il recupero riconosce anche i registri di creazione dello spazio, chat personale, caricamento file, messaggio vocale e uscita da una chiamata. La chat personale permette di riprendere una bozza di testo nel suo campo. Le operazioni già preparate restano consultabili nel rispettivo ambito.

## Dati sul dispositivo

Il ponte nativo accetta esclusivamente le chiavi degli indici e dei blocchi di bozze e operazioni che la precedente app scriveva tramite Expo SecureStore. La sessione precedente resta separata. Flutter verifica l’identità sul server prima di leggere e controlla nuovamente l’accesso prima di salvare la copia. I dati rimangono nel deposito protetto dell’app. L’archivio originale rimane disponibile anche dopo un recupero interrotto.

Per gli allegati, il client risolve il percorso all’interno delle directory dell’app. Su iOS può cambiare l’identificativo della directory dopo una sovrainstallazione. Su Android il medesimo contenitore dell’utente principale può comparire con i prefissi `/data/user/0/` e `/data/data/`. Il recupero verifica nome, dimensione e impronta SHA-256 nel formato effettivo del precedente client prima di copiare il contenuto in un nuovo file cifrato. Percorsi esterni, collegamenti simbolici, file scaduti nella cache e contenuti cambiati vengono segnalati.

## Collaudo ripetibile

Usare un’installazione di prova con due spazi e un account sintetico sul server locale, per esempio `http://127.0.0.1:3102` su iOS e sul Pixel con il reindirizzamento della porta. Entrambe le app devono identificare il server con lo stesso indirizzo.

1. Nel vecchio client salvare in uno spazio il testo **Bozza sintetica prima dell’aggiornamento**, un TXT e un invio incerto collegato a quella stessa bozza. In un altro spazio salvare **Bozza indipendente da recuperare** e il file **upgrade-synthetic.txt**, senza inviare il messaggio. Riaprire il vecchio client e verificare entrambi i record.
2. Installare Flutter sopra il binario esistente con lo stesso identificativo e firma compatibile. Accedere con il medesimo account. Nel primo spazio aprire il recupero. La verifica di un ID mai ricevuto deve mostrare l’assenza della conferma e conservare la bozza associata.
3. Nel secondo spazio riprendere la bozza indipendente. Controllare il testo nel campo e il nome del TXT nel selettore **Allegati · 1**. Chiudere e riavviare l’app, rientrare nello spazio e controllare entrambi. Il gruppo deve restare privo di un nuovo messaggio inviato dal recupero.

Il 26 novembre 2026 la prova su iPhone 16 simulato con iOS 18.2 ha usato il precedente binario React Native e un harness che chiamava le funzioni originali di salvataggio Expo. Prima dell’importatore Flutter vedeva lo storico del server, ma il campo appariva vuoto. La reinstallazione del vecchio binario ha confermato la sopravvivenza del file nella nuova posizione con la medesima impronta. Con l’importatore il percorso sopra è riuscito fino alla seconda apertura del file nel selettore.

Sul Pixel 5 emulato con Android 15 (API 35), il precedente APK è stato ricompilato dalla sorgente React Native con Expo SecureStore e Android Keystore reali. Flutter è stato installato sul medesimo `com.rimiam.chat`, con la stessa chiave di debug e versionCode superiore. La prova ha confermato in entrambe le versioni la bozza collegata al comando incerto e la bozza indipendente. Dopo il recupero, testo e TXT erano ancora disponibili nel selettore a un secondo avvio di Flutter. La prova ha riprodotto entrambi i percorsi assoluti equivalenti del contenitore Android.

I test Flutter in [legacy_mobile_data_test.dart](../../mobile/test/legacy_mobile_data_test.dart) coprono anche blocchi Unicode e incompleti, account e server diversi, perdita dell’accesso durante la copia, bozze concorrenti, ricevute presenti e assenti, file alterati o mancanti, percorsi di altri utenti e conservazione dell’ID dopo il riavvio.

## Condizioni per il rilascio

Nel collaudo finale il Pixel aveva già il progressivo di prova 4. Android ha rifiutato l’APK con progressivo 2 e poi quello con la firma di debug di un’altra installazione. Ricompilando gli stessi sorgenti con `--build-number=5` e usando la firma della precedente fixture, l’aggiornamento sul posto è riuscito e l’app si è avviata. La prova non ha richiesto di disinstallarla. Si tratta delle sole identità di debug locali.

Su iOS servono lo stesso Bundle ID, un team e gruppi del portachiavi compatibili. Su Android servono lo stesso application ID, una firma o linea di firma compatibile e un versionCode successivo. Gli identificativi locali separati consentono installazioni affiancate e non esercitano questo percorso. Una disinstallazione o un trasferimento a un altro telefono può rendere irrecuperabili i dati esclusivamente locali. I collaudi locali usano firme di debug e dati fittizi. La distribuzione su TestFlight, App Store e Play richiede prove con le effettive firme di distribuzione e dispositivi fisici.
