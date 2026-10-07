"use client";
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

export function assistanceLabel(context: ProductAssistance) {
  const screen = productScreens[context.screen];
  const field = screen.fields.find((field) => field.id === context.field);
  return [
    screen.label,
    field?.label,
    context.issue && issueLabels[context.issue],
  ]
    .filter(Boolean)
    .join(" · ");
}

export function assistanceQuestion(context: ProductAssistance) {
  return `@RIMIAM, aiutami con ${assistanceLabel(context)}. Cosa devo fare?`;
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
  const ask = useContext(HelpContext);
  const id = useId();
  const [field, setField] = useState(initialField ?? "");
  const [issue, setIssue] = useState<ProductAssistance["issue"]>();
  if (!ask) return null;
  const guide = productScreens[screen];
  return (
    <details className={styles.help}>
      <summary>Chiedi a Miriam · {guide.label}</summary>
      <div className={styles.options}>
        <label htmlFor={`${id}-field`}>Su cosa vuoi aiuto?</label>
        <select
          id={`${id}-field`}
          value={field}
          onChange={(event) => setField(event.target.value)}
        >
          <option value="">Questa schermata</option>
          {guide.fields.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label} · {requirements[item.requirement]}
            </option>
          ))}
        </select>
        <label htmlFor={`${id}-issue`}>Situazione da spiegare</label>
        <select
          id={`${id}-issue`}
          value={issue ?? ""}
          onChange={(event) =>
            setIssue((event.target.value || undefined) as typeof issue)
          }
        >
          <option value="">Come funziona</option>
          {Object.entries(issueLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <p className="hint">
          Prepara una domanda modificabile nella conversazione condivisa. Allega
          solo schermata, campo e situazione scelti, senza i valori del modulo.
          La bozza del modulo resta qui.
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
          Prepara domanda a Miriam
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
  return (
    <span className={styles.reference}>
      <span>Aiuto su: {assistanceLabel(context)}</span>
      {remove && (
        <button
          type="button"
          className="quiet"
          onClick={remove}
          aria-label="Rimuovi il riferimento di aiuto dal messaggio"
        >
          Rimuovi
        </button>
      )}
    </span>
  );
}
