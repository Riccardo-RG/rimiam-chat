// These server responses reject the complete workspace creation transaction.
export const workspaceCreationErrors = {
  PERSONAL_CONTACT_UNAVAILABLE:
    "Un contatto selezionato non è più disponibile. Rivedi le persone da invitare.",
  CANNOT_INVITE_SELF:
    "Hai già accesso allo spazio che crei. Rimuovi il tuo indirizzo dagli inviti.",
  ASSISTANT_CONNECTION_CHANGED:
    "È cambiata la configurazione dell’assistente. Verifica la destinazione in Configura Emme prima di riprovare.",
  ASSISTANT_CONNECTION_UNAVAILABLE:
    "La connessione scelta non è più disponibile. Ricarica le connessioni e scegline un’altra.",
} as const;

export function explicitCreationRejection(code: string): string | undefined {
  return Object.hasOwn(workspaceCreationErrors, code)
    ? workspaceCreationErrors[code as keyof typeof workspaceCreationErrors]
    : undefined;
}
