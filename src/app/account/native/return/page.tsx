import { pageLanguage } from "../../../ui-language-server";
export const metadata = {
  title: "Ritorna a RIMIAM",
  referrer: "no-referrer" as const,
};
export default async function NativeReturn() {
  const { t: uiText } = await pageLanguage();
  return (
    <main>
      <h1>{uiText("Riapri l’app RIMIAM")}</h1>
      <p>{uiText("Avvia un nuovo accesso dall’app su questo dispositivo.")}</p>
    </main>
  );
}
