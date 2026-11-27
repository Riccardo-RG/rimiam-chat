# Pubblicare il Web di RIMIAM su Railway dal Mac

Usa questa procedura per un rilascio del solo servizio Web. Parti dal commit verificato e approvato. Se cambia anche il worker o ci sono migrazioni da applicare, segui il [runbook di rilascio](RELEASE_RUNBOOK.md) per backup, ripristino di prova e ordine di aggiornamento dei servizi. Il [registro Railway](RAILWAY_DEPLOYMENT.md#current-setup) indica quale versione è stata pubblicata.

### 1. Prepara il commit

Apri il Terminale nella radice del repository. Il blocco chiede lo SHA del commit e prepara in una directory temporanea i soli file tracciati a quella revisione. Controlla lo SHA e il titolo stampati prima di procedere. Le modifiche locali e il file `.env` del Mac restano fuori dal pacchetto.

```sh
printf 'SHA del commit da pubblicare: ' &&
IFS= read -r rimiam_ref &&
test -n "$rimiam_ref" &&
rimiam_sha="$(git rev-parse --verify --end-of-options "${rimiam_ref}^{commit}")" &&
git show --no-patch --format='%H %s' "$rimiam_sha" &&
rimiam_upload_dir="$(mktemp -d)" &&
git archive --format=tar -o "$rimiam_upload_dir/source.tar" "$rimiam_sha" &&
mkdir "$rimiam_upload_dir/source" &&
tar -xf "$rimiam_upload_dir/source.tar" -C "$rimiam_upload_dir/source" &&
cd "$rimiam_upload_dir/source" &&
test -f Dockerfile && test ! -e .env && echo "Pacchetto pronto"
```

### 2. Pubblica il Web

Nella stessa finestra esegui `railway login` se la sessione è scaduta. Con `railway link` scegli il progetto **rimiam-chat**, l’ambiente **production** e il servizio **rimiam-chat-web**. Controlla la destinazione con `railway status`. Annota l’identificativo restituito dall’[endpoint della versione](https://rimiam-chat-web-production.up.railway.app/api/release) prima del caricamento.

```sh
test -n "$rimiam_sha" && test "$PWD" = "$rimiam_upload_dir/source" && test -f Dockerfile &&
railway up --detach --environment production --service rimiam-chat-web \
  --message "Web $rimiam_sha"
```

Apri il deployment indicato dal comando e attendi **Success**. Il caricamento riuscito conferma soltanto la ricezione dei file. In caso di errore, consulta i log di build o di avvio. [Comando railway up](https://docs.railway.com/cli/up)

### 3. Verifica il rilascio

1. Controlla che lo [stato del servizio](https://rimiam-chat-web-production.up.railway.app/api/health) restituisca HTTP 200 e che l’[identificativo della versione](https://rimiam-chat-web-production.up.railway.app/api/release) sia cambiato rispetto a quello annotato.
2. Apri la [beta](https://rimiam-chat-web-production.up.railway.app/) con un account di prova ed esegui il percorso interessato dalla modifica. Verifica anche il ritorno su una scheda già aperta.
3. Registra commit, identificativo servito ed esito. Se hai aperto una sessione CLI temporanea, chiudila con `railway logout`. Revoca un eventuale token temporaneo usato per quel rilascio.

### Quale versione arriva sul telefono

Safari, Chrome e l’icona della Web app sulla Home ricevono il rilascio Web. L’app Flutter installata si aggiorna con una nuova build iOS o Android. Su iPhone puoi provarla dal Mac con Xcode oppure riceverla via TestFlight quando è distribuita ai tester. [Guida iPhone](PROVA_IPHONE.md) · [Build Flutter per iOS e Android](MULTICLIENT.md#run-the-mobile-app)
