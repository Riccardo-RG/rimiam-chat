"use client";

const sections = [
  ["goal", "Goal", "La direzione e le adesioni"],
  ["context", "Contesto", "Ciò che sappiamo, con le sue fonti"],
  ["work", "Lavoro", "Il lavoro delle persone e di RIMIAM"],
  ["artifacts", "Documenti", "Risultati, bozze e materiali prodotti"],
] as const;

const tools = [
  ["sources", "Fonti"],
  ["people", "Persone"],
  ["calendar", "Calendario"],
  ["email", "Email"],
  ["attention", "Attività e filoni"],
  ["feedback", "Feedback beta"],
] as const;

/** Navigation only: each destination keeps its own data and governed commands. */
export function WorkspaceLens({
  selected,
  open,
}: {
  selected: string;
  open: (destination: string) => void;
}) {
  return (
    <nav className="lens-navigation" aria-label="Lo spazio">
      <div className="lens-primary">
        {sections.map(([id, title, description]) => (
          <button
            key={id}
            type="button"
            aria-current={selected === id ? "page" : undefined}
            onClick={() => open(id)}
          >
            <strong>{title}</strong>
            {selected === "lens" && <span>{description}</span>}
          </button>
        ))}
      </div>
      <details
        className="lens-tools"
        open={tools.some(([id]) => id === selected)}
      >
        <summary>Strumenti e persone</summary>
        <div className="lens-secondary">
          {tools.map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-current={selected === id ? "page" : undefined}
              onClick={() => open(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </details>
    </nav>
  );
}
