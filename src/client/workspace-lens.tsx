"use client";

const sections = [
  ["goal", "Goal", "La direzione e le adesioni"],
  ["context", "Context", "Ciò che sappiamo, con le sue fonti"],
  ["work", "Work", "Il lavoro delle persone e di RIMIAM"],
  ["artifacts", "Outputs", "Risultati, bozze e documenti"],
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
      <div className="lens-secondary">
        {[
          ["sources", "Fonti"],
          ["people", "Persone"],
          ["calendar", "Calendario"],
          ["email", "Email"],
          ["attention", "Activity e filoni"],
          ["feedback", "Feedback beta"],
        ].map(([id, label]) => (
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
    </nav>
  );
}
