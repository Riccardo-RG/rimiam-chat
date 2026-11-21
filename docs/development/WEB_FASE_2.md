# RIMIAM · problemi rinviati alla fase 2

## Google Calendar · collegamento bloccato per chi non è tester

**Aperto, rinviato da Riccardo il 21 novembre 2026.** Nella beta, dopo «Collega calendario», Google mostra `403 access_denied` e indica che l’app è in fase di test. La segnalazione riguarda il collegamento del calendario personale. [Segnalazione e orario dello screenshot](../design/reviews/2026-11-19-web/INTERVISTA.md#segnalazioni-web-del-21-novembre-2026--condivisi-e-partecipanti)

- [ ] Verificare nella console del progetto OAuth quali utenti possono collegarsi, quali permessi Calendar sono dichiarati e a che punto è la verifica pubblica. Responsabile della configurazione: gestore della beta. [Configurazione per installazione](GOOGLE_INTEGRATIONS.md#self-hosting-with-google)
- [ ] Preparare l’accesso pubblico desiderato con il dominio, la pagina informativa e i permessi pertinenti. Registrare l’esito della verifica di Google per la beta ospitata. [Requisiti di Google](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
- [ ] Con un account Google esterno alla lista tester e il consenso della persona, partire da «Collega calendario», tornare a RIMIAM e sincronizzare un evento di prova nella sua agenda privata. Verificare anche lo scollegamento. Sul Web controllare il ritorno dal browser, su iOS e Android anche la riapertura dell’app dopo il consenso.

**Si chiude quando** un account idoneo fuori dalla lista tester completa il percorso sulla beta pubblicata. L’aggiunta di un singolo tester consente una prova circoscritta e lascia aperto questo obiettivo.

## Ticket aperti · Web e mobile

Raccolti il 21 novembre 2026. Sviluppo e verifiche da avviare.

| Ticket | Richiesta | Criteri di accettazione |
| --- | --- | --- |
| F2-01 · Caricamento | Mostrare il logo stilizzato di RIMIAM con un indicatore di caricamento mentre si prepara la schermata. | Con caricamento lento il logo è visibile fino a quando la schermata è utilizzabile. Un aggiornamento in background lascia leggibile la chat già aperta. Verificare anche con movimento ridotto. |
| F2-02 · Errori di rendering | Controllare la console durante il caricamento e la navigazione tra Home, chat e strumenti. | Registrare i passaggi che riproducono eventuali errori, correggere quelli confermati e ripetere gli stessi percorsi. Distinguere la console del browser dai log dell’app iOS e Android. |
| F2-03 · Prestazioni Web e mobile | Ridurre le attese percepite nell’apertura della Home, nell’ingresso in una chat popolata e durante lo scorrimento. | Misurare prima e dopo sullo stesso spazio, dispositivo e rete. Confrontare il tempo fino alla prima interazione e gli scatti durante lo scorrimento. Distinguere Web desktop, Web mobile e app React Native, indicando dove si è usato un dispositivo fisico. |
| F2-04 · Nome dello spazio in chat | Dare più risalto al nome nell’intestazione della chat su Web e mobile. | Con l’accento predefinito cambia solo la dimensione, leggermente più grande. Con un accento scelto dall’utente il titolo mantiene la nuova dimensione e prende quel colore. Controllare la leggibilità in chiaro e in scuro e che un nome lungo lasci accessibili i comandi anche su telefono. |
| F2-05 · Stella dei Preferiti in Condivisi | Rifinire l’aspetto della stella selezionata. Direzione da valutare: contorno leggero a riposo e riempimento discreto quando il contenuto è tra i propri Preferiti. | I due stati si distinguono anche senza basarsi sul colore. Verificare entrambi accanto a un file e a un’anteprima, in tema chiaro e scuro, su Web e mobile. La stella continua a esprimere una preferenza personale. |
| F2-06 · Ripensare «Attività proposte» | Rivedere il ruolo della sezione su Web e mobile. | In fase di analisi, partire da una proposta reale e chiarire chi l’ha suggerita, a chi è rivolta e cosa succede se la persona decide di darle seguito. Valutare con Riccardo se serve una sezione dedicata. |
