export function invitationDeliveryLabel(status?: string | null) {
  switch (status) {
    case "queued":
      return "Email in coda";
    case "needs_configuration":
      return "Invio email da configurare; puoi condividere il link";
    case "running":
      return "Invio email in corso";
    case "submitted":
      return "Email affidata al servizio di invio; recapito non ancora verificato";
    case "unknown":
      return "Esito email incerto; non creare un nuovo invio senza verifica";
    case "cancelled":
      return "Invio annullato: invito non più valido";
    case "expired":
      return "Invio scaduto";
    default:
      return "Solo link, nessuna email richiesta";
  }
}
