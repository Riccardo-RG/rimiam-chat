import { pageLanguage } from "../ui-language-server";
import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { AppearanceControl } from "@/client/appearance-control";
import { BrandSignature } from "@/client/brand-signature";
import styles from "../beta/page.module.css";

export const metadata: Metadata = {
  title: "Account, calendari e dati · RIMIAM",
  description:
    "Come accedere con Google o Microsoft, collegare una casella email o un calendario e gestire i dati condivisi.",
};
export const dynamic = "force-dynamic";

export default async function ConnectionDataPage() {
  const { t: uiText } = await pageLanguage();
  const contact = z
    .email()
    .safeParse(process.env.RIMIAM_PRIVACY_CONTACT_EMAIL?.trim());
  const notice = URL.parse(process.env.RIMIAM_PRIVACY_NOTICE_URL?.trim() ?? "");
  const publicNotice =
    notice?.protocol === "https:" && !notice.username && !notice.password
      ? notice.href
      : null;
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link
          className="wordmark"
          href="/"
          aria-label={uiText("RIMIAM — Home")}
        >
          <BrandSignature />
        </Link>
        <AppearanceControl />
      </header>
      <article>
        <h1>{uiText("Account, calendari e dati")}</h1>
        <p>
          {uiText(
            "Puoi usare RIMIAM con email e password. L’accesso con Google o Microsoft, il calendario e la posta richiedono autorizzazioni separate.",
          )}
        </p>
        <h2>{uiText("Quando accedi")}</h2>
        <p>
          {uiText(
            "Google o Microsoft confermano la tua identità. RIMIAM usa l’identificativo del tuo account presso il servizio, il nome e l’email per riconoscerti. I token ricevuti per il solo accesso vengono scartati prima di salvare il collegamento. Per controllare i tuoi metodi di accesso, apri il menu del profilo.",
          )}
        </p>
        <h2>{uiText("Quando colleghi un calendario")}</h2>
        <p>
          {uiText("Dalla Home scegli ")}
          <strong>{uiText("Collega calendario")}</strong>
          {uiText(", oppure")} <strong>{uiText("Calendari collegati")}</strong>
          {uiText(
            " se ne usi già uno. Scegli un account Google o Microsoft con lo stesso indirizzo email verificato in RIMIAM, anche se di solito accedi con la password.",
          )}
        </p>
        <p>
          {uiText(
            "Prima di collegarlo puoi controllare i permessi sul sito del servizio. RIMIAM conserva sul server le credenziali di autorizzazione cifrate per recuperare i dati che scegli di sincronizzare. Per una prova, scegli un calendario privo di dati sensibili.",
          )}
        </p>
        <p>
          {uiText(
            "La sincronizzazione legge gli eventi del calendario e del periodo selezionati. RIMIAM salva dati come titolo, orari e identificativo dell’evento. Queste informazioni sono visibili a te. Se decidi di condividere un appuntamento nello spazio, i membri che hanno accesso allo spazio possono vedere il contenuto condiviso.",
          )}
        </p>
        <p>
          {uiText(
            "Il calendario personale e Outlook sono in sola lettura. In uno spazio, Google Calendar può chiedere anche il permesso di scrivere nei calendari di tua proprietà. Ogni pubblicazione esterna richiede una tua autorizzazione sull’operazione nell’app. La posta richiede un collegamento a parte.",
          )}
        </p>
        <h2 id="posta">{uiText("Come collegare la posta")}</h2>
        <p>
          {uiText("Nello spazio apri ")}
          <strong>{uiText("Strumenti → Email → Le tue caselle")}</strong>
          {uiText(". Scegli Gmail o Outlook e premi ")}
          <strong>{uiText("Collega")}</strong>
          {uiText(
            ". Accedi al servizio con lo stesso indirizzo verificato in RIMIAM. Solo tu puoi autorizzare l’accesso alla tua casella.",
          )}
        </p>
        <p>
          {uiText(
            "Se il servizio risulta disattivato o da configurare, contatta chi gestisce questa installazione. Nel frattempo puoi salvare una bozza. Dopo il collegamento le letture e le bozze restano private. Scegli tu quali estratti o allegati condividere con lo spazio. Per inviare un’email controlla testo, destinatari e allegati e premi",
          )}{" "}
          <strong>{uiText("Autorizza e invia")}</strong>.
        </p>
        <details>
          <summary>{uiText("Gestisci tu l’installazione?")}</summary>
          <p>
            {uiText(
              "Per Gmail abilita la Gmail API nel tuo progetto Google Cloud e registra un client OAuth Web per le integrazioni. Usa il callback del tuo dominio ",
            )}
            <code>/api/v1/integrations/google/callback</code>
            {uiText(
              ". Se hai già installato Google Calendar puoi usare lo stesso client delle integrazioni. Configura sul Web e sul worker",
            )}{" "}
            <code>GOOGLE_OAUTH_CLIENT_ID</code>,{" "}
            <code>GOOGLE_OAUTH_CLIENT_SECRET</code>
            {uiText(" e")} <code>GOOGLE_OAUTH_CAPABILITIES</code>:{" "}
            <code>email</code>
            {uiText(" per Gmail, ")}
            <code>calendar,email</code>
            {uiText(
              " per entrambi. Riavvia i due servizi. Google richiede i permessi di lettura e di invio della posta; in modalità test, aggiungi gli indirizzi di prova al pubblico dell’app.",
            )}{" "}
            <a href="https://developers.google.com/workspace/gmail/api/auth/scopes">
              {uiText("Permessi e verifica Google")}
            </a>
          </p>
          <p>
            {uiText(
              "Per Outlook registra un’app Web in Microsoft Entra con il callback",
            )}{" "}
            <code>/api/v1/integrations/microsoft/callback</code>
            {uiText(". Configura sul Web e sul worker le credenziali")}{" "}
            <code>MICROSOFT_MAIL_CLIENT_ID</code>
            {uiText(" e")} <code>MICROSOFT_MAIL_CLIENT_SECRET</code>
            {uiText(". La connessione usa i permessi delegati ")}
            <code>User.Read</code>, <code>Mail.Read</code>,{" "}
            <code>Mail.Send</code>
            {uiText(" e ")}
            <code>offline_access</code>.
          </p>
        </details>
        <h2>{uiText("Se vuoi interrompere il collegamento")}</h2>
        <p>
          {uiText("Apri il calendario collegato e scegli")}{" "}
          <strong>{uiText("Scollega calendario")}</strong>
          {uiText(
            " per interromperne l’uso in RIMIAM. Le letture già salvate e la cronologia degli appuntamenti condivisi restano conservate. Per la posta, apri",
          )}{" "}
          <strong>{uiText("Email")}</strong>
          {uiText(" nello spazio e scegli")}{" "}
          <strong>{uiText("Scollega casella")}</strong>
          {uiText(
            " sotto la tua casella. Le letture salvate e i contenuti già condivisi restano nella loro cronologia. Per revocare i permessi anche all’origine, usa le impostazioni delle app collegate del tuo account Google o Microsoft. Per gli account aziendali, alcuni permessi sono gestiti dall’organizzazione.",
          )}
        </p>
        <h2>{uiText("Contatti e richieste sui dati")}</h2>
        {contact.success ? (
          <p>
            {uiText(
              "Per informazioni, correzioni o richieste di cancellazione scrivi a",
            )}{" "}
            <a href={`mailto:${contact.data}`}>{contact.data}</a>.
          </p>
        ) : (
          <p>
            {uiText(
              "Per informazioni, correzioni o richieste di cancellazione rivolgiti a chi gestisce questa installazione di RIMIAM. Se hai ricevuto un invito, puoi usare anche quel canale.",
            )}
          </p>
        )}
        {publicNotice && (
          <p>
            <a href={publicNotice}>
              {uiText("Informativa privacy del gestore")}
            </a>
          </p>
        )}
      </article>
      <Link href="/">{uiText("Torna a RIMIAM")}</Link>
    </main>
  );
}
