# Pubblicare il Web di RIMIAM su Railway dal Mac

Questa guida usa il pacchetto locale delle correzioni del 21 novembre 2026. Aggiorna il servizio Web della beta esistente. Database e worker sono già operativi; questo rilascio usa lo schema 075 già in produzione. Per distribuire l’app nativa servono build iOS e Android separate.

### 1. Prepara il pacchetto

Apri Terminale nella radice della copia locale che contiene il pacchetto e incolla questo blocco. L’archivio si trova in `dist/releases` sul Mac dove è stato preparato e viene escluso da Git. Il blocco lo verifica e lo estrae in una cartella temporanea fuori dal repository. Prosegui soltanto se il controllo restituisce `rimiam-web-raccolta.tar.gz: OK` e la preparazione termina con «Pacchetto pronto».

```sh
cd dist/releases/2026-11-21-web-raccolta &&
shasum -a 256 -c SHA256SUMS &&
rimiam_upload_dir="$(mktemp -d)" &&
tar -xzf rimiam-web-raccolta.tar.gz -C "$rimiam_upload_dir" &&
cd "$rimiam_upload_dir" &&
test -f Dockerfile &&
echo "Pacchetto pronto"
```

### 2. Accedi e pubblica

Nella stessa finestra digita `railway login`. Completa l’accesso nel browser con l’account Railway che gestisce RIMIAM. Dalla cartella preparata al punto 1 esegui `railway link` e seleziona il progetto **rimiam-chat**, l’ambiente **production** e il servizio **rimiam-chat-web**. Controlla con `railway status` che la destinazione sia corretta. Il comando seguente carica il pacchetto su quel servizio.

```sh
test -n "$rimiam_upload_dir" && test "$PWD" = "$rimiam_upload_dir" && test -f Dockerfile &&
railway up --detach --environment production --service rimiam-chat-web \
  --message "Raccolta, partecipanti e navigazione personale"
```

Apri il collegamento al deployment stampato dal comando. La conferma di caricamento indica che Railway ha ricevuto i file. Attendi lo stato **Success**. Se compare **Failed**, apri il primo errore nei log di build o di avvio e conserva il link del deployment. La funzione «Redeploy» del vecchio rilascio ripubblica il vecchio pacchetto. [Guida Railway al caricamento](https://docs.railway.com/cli/up)

### 3. Controlla la versione online

1. Apri lo [stato del servizio](https://rimiam-chat-web-production.up.railway.app/api/health) e verifica che risponda. Su [versione Web](https://rimiam-chat-web-production.up.railway.app/api/release) deve comparire un identificativo diverso da quello precedente al rilascio (alle 01:45 del 21 novembre era `99ca1391-1bdf-43ab-8df3-814c044efacc`).
2. Apri la [beta](https://rimiam-chat-web-production.up.railway.app/) sul telefono. Da **Tu ed Emme** usa il menu laterale per aprire **Oggi**. In uno spazio, apri **Condivisi**, filtra i collegamenti e verifica che un URL lungo resti nella larghezza dello schermo.
3. Quando hai finito, puoi chiudere la sessione CLI con `railway logout`. Il servizio continua a funzionare. [Guida per provare dal telefono](PROVA_IPHONE.md)

### Quale versione arriva sul telefono

Chi usa RIMIAM da Safari, Chrome o dall’icona della Web app sulla Home riceve il rilascio Railway. L’app React Native installata usa un proprio pacchetto. Il percorso di distribuzione per i tester è una build iOS firmata su TestFlight oppure una build Android firmata distribuita su un canale di test. [Avvio e verifica dei client nativi](MULTICLIENT.md#run-the-mobile-app)
