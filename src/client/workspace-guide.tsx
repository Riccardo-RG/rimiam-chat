"use client";
import { useUiLanguage } from "./ui-language";
import {
  availableComposerActions,
  type ComposerActionPermissions,
} from "./composer-actions";
import styles from "./workspace-guide.module.css";

import { workspaceGuideTopics } from "../shared/workspace-guide-topics";

export function WorkspaceGuide({
  permissions,
}: {
  permissions: ComposerActionPermissions;
}) {
  const { t: uiText, locale } = useUiLanguage();
  return (
    <div className={styles.guide}>
      <section>
        <h3>{uiText("Comandi della chat")}</h3>
        <p>
          {uiText("Digita ")}
          <kbd>/</kbd>
          {uiText(
            " nella chat e scegli una voce. Puoi anche usare il pulsante «Azioni». Ogni azione apre lo strumento o prepara una bozza da completare.",
          )}
        </p>
        <dl>
          {availableComposerActions(permissions, "", locale).map((command) => (
            <div key={command.id}>
              <dt>
                <code>{command.shortcuts.join(" · ")}</code>
              </dt>
              <dd>{command.description}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section>
        <h3>{uiText("Come funziona lo spazio")}</h3>
        {workspaceGuideTopics.map(([title, body]) => (
          <details key={title}>
            <summary>{uiText(title)}</summary>
            <p>{uiText(body)}</p>
          </details>
        ))}
      </section>
    </div>
  );
}
