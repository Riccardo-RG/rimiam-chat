import { pageLanguage } from "../../ui-language-server";
import { notFound } from "next/navigation";
import { NativeSocialStart } from "@/client/native-social-start";
import { nativeSocialProviders } from "@/server/native-social";
import { BrandSignature } from "@/client/brand-signature";
import styles from "../../beta/page.module.css";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Accesso all’app RIMIAM",
  referrer: "no-referrer" as const,
};
export default async function NativeSignIn({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { t: uiText } = await pageLanguage();
  const { provider, state, challenge } = await searchParams;
  if (
    (provider !== "google" && provider !== "microsoft") ||
    typeof state !== "string" ||
    !/^[a-f0-9]{64}$/.test(state) ||
    typeof challenge !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(challenge)
  )
    notFound();
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <BrandSignature />
      </header>
      <article>
        <h1>{uiText("Accedi all’app RIMIAM")}</h1>
        <p>
          {uiText(
            "Dopo aver scelto l’account tornerai all’app su questo dispositivo.",
          )}
        </p>
        {nativeSocialProviders()[provider] ? (
          <NativeSocialStart
            provider={provider}
            state={state}
            challenge={challenge}
          />
        ) : (
          <p>
            {uiText(
              "Questo servizio di accesso non è abilitato su questa installazione.",
            )}
          </p>
        )}
      </article>
    </main>
  );
}
