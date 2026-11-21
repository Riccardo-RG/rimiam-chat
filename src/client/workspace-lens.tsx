"use client";
import { useUiLanguage } from "./ui-language";

import { useEffect, useRef } from "react";
import { WorkspaceIcon } from "./workspace-icon";
import styles from "./workspace-lens.module.css";

import {
  destinations,
  index,
  tools,
  type Destination,
} from "../shared/workspace-navigation";
type OpenPanel = (destination: string) => void;

export function WorkspaceMenu({
  selected,
  open,
}: {
  selected: string;
  open: (destination: string, trigger: HTMLButtonElement) => void;
}) {
  const { t: uiText } = useUiLanguage();
  const disclosure = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (disclosure.current && tools.some((id) => id === selected))
      disclosure.current.open = true;
  }, [selected]);
  function item(id: Destination) {
    const [label, icon] = destinations[id];
    const current = selected === id;
    return (
      <button
        type="button"
        key={id}
        className="rail-link"
        aria-current={current ? "page" : undefined}
        onClick={(event) => open(id, event.currentTarget)}
      >
        <WorkspaceIcon name={icon} />
        {uiText(label)}
      </button>
    );
  }
  return (
    <details className="sidebar-tools" ref={disclosure}>
      <summary className="rail-link">
        <WorkspaceIcon name="settings" />
        {uiText(" Strumenti")}
      </summary>
      <nav aria-label={uiText("Strumenti dello spazio")}>{tools.map(item)}</nav>
    </details>
  );
}

export function WorkspaceLens({ open }: { open: OpenPanel }) {
  const { t: uiText } = useUiLanguage();
  return (
    <nav
      className={styles.directory}
      aria-label={uiText("Indice dello spazio")}
    >
      <button type="button" className={styles.lead} onClick={() => open("")}>
        {uiText(destinations[""][0])}
        <WorkspaceIcon name="arrow" />
      </button>
      {index.map(({ title, views }) => (
        <section key={title} className={styles.group}>
          <h3>{uiText(title)}</h3>
          <ul>
            {views.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  className={styles.row}
                  onClick={() => open(id)}
                >
                  {uiText(destinations[id][0])}
                  <WorkspaceIcon name="chevron" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}
