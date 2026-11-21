"use client";
import { translateUi } from "../shared/i18n";
import { useUiLanguage } from "./ui-language";

import {
  createContext,
  useContext,
  useId,
  useState,
  type ReactNode,
} from "react";
import type { ProductAssistance } from "@/contracts/product-assistance";
import { productScreens } from "../shared/product-guide";
import styles from "./product-help.module.css";

const issueLabels: Record<NonNullable<ProductAssistance["issue"]>, string> = {
  required: "Campo obbligatorio",
  invalid: "Valore non valido",
  unavailable: "Operazione non disponibile",
  stale: "Versione cambiata",
};
const requirements = {
  required: "obbligatorio",
  optional: "facoltativo",
  conditional: "richiesto in alcuni casi",
};

type UiText = (source: string, ...values: (string | number)[]) => string;
const italian: UiText = (source, ...values) =>
  translateUi("it", source, ...values);

export function assistanceLabel(
  context: ProductAssistance,
  t: UiText = italian,
) {
  const screen = productScreens[context.screen];
  const field = screen.fields.find((field) => field.id === context.field);
  return [
    screen.label,
    field?.label,
    context.issue && issueLabels[context.issue],
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => t(value))
    .join(" · ");
}

export function assistanceQuestion(
  context: ProductAssistance,
  t: UiText = italian,
) {
  return t(
    "@Emme, aiutami con {0}. Cosa devo fare?",
    assistanceLabel(context, t),
  );
}

const HelpContext = createContext<
  ((context: ProductAssistance) => void) | null
>(null);

export function ProductHelpProvider({
  ask,
  children,
}: {
  ask: ((context: ProductAssistance) => void) | null;
  children?: ReactNode;
}) {
  return <HelpContext.Provider value={ask}>{children}</HelpContext.Provider>;
}

/** Explicitly selected static metadata only: never inspect form or DOM values. */
export function ProductHelp({
  screen,
  field: initialField,
}: {
  screen: ProductAssistance["screen"];
  field?: string;
}) {
  const { t: uiText } = useUiLanguage();
  const ask = useContext(HelpContext);
  const id = useId();
  const [field, setField] = useState(initialField ?? "");
  const [issue, setIssue] = useState<ProductAssistance["issue"]>();
  if (!ask) return null;
  const guide = productScreens[screen];
  return (
    <details className={styles.help}>
      <summary>
        {screen === "conversation" && !initialField ? (
          <>
            {uiText("Aiuto")}
            <span className="sr-only">
              {uiText(" · Chiedi a Emme · ")}
              {uiText(guide.label)}
            </span>
          </>
        ) : (
          <>
            {uiText("Aiuto sul modulo")}
            <span className="sr-only">
              {uiText(" · Chiedi a Emme · ")}
              {uiText(guide.label)}
            </span>
          </>
        )}
      </summary>
      <div className={styles.options}>
        <label htmlFor={`${id}-field`}>{uiText("Su cosa vuoi aiuto?")}</label>
        <select
          id={`${id}-field`}
          value={field}
          onChange={(event) => setField(event.target.value)}
        >
          <option value="">{uiText("Questa schermata")}</option>
          {guide.fields.map((item) => (
            <option key={item.id} value={item.id}>
              {uiText(item.label)} · {uiText(requirements[item.requirement])}
            </option>
          ))}
        </select>
        <label htmlFor={`${id}-issue`}>
          {uiText("Situazione da spiegare")}
        </label>
        <select
          id={`${id}-issue`}
          value={issue ?? ""}
          onChange={(event) =>
            setIssue((event.target.value || undefined) as typeof issue)
          }
        >
          <option value="">{uiText("Come funziona")}</option>
          {Object.entries(issueLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {uiText(label)}
            </option>
          ))}
        </select>
        <p className="hint">
          {uiText(
            "Prepara una domanda modificabile nella conversazione condivisa. Allega solo schermata, campo e situazione scelti, senza i valori del modulo. La bozza del modulo resta qui.",
          )}
        </p>
        <button
          type="button"
          className="quiet"
          onClick={() =>
            ask({
              screen,
              ...(field ? { field } : {}),
              ...(issue ? { issue } : {}),
            })
          }
        >
          {uiText("Prepara domanda a Emme")}
        </button>
      </div>
    </details>
  );
}

export function AssistanceReference({
  context,
  remove,
}: {
  context: ProductAssistance;
  remove?: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  return (
    <span className={styles.reference}>
      <span>
        {uiText("Aiuto su: ")}
        {assistanceLabel(context, uiText)}
      </span>
      {remove && (
        <button
          type="button"
          className="quiet"
          onClick={remove}
          aria-label={uiText("Rimuovi il riferimento di aiuto dal messaggio")}
        >
          {uiText("Rimuovi")}
        </button>
      )}
    </span>
  );
}
