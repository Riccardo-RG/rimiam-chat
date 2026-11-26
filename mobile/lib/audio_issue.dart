import 'api.dart';
import 'attachment_staging.dart';

/// Return only interface wording. SDK exceptions can contain room addresses
/// or local paths, which do not belong in a user-facing status message.
String audioIssue(Object error) {
  if (error is AttachmentProblem) return error.message;
  if (error is ApiError) {
    if (error.status == 401 || error.status == 403) {
      return 'Non puoi accedere a questa operazione nello spazio.';
    }
    if (error.code == 'CALL_RECORDING_CONFIGURATION_REQUIRED') {
      return 'La registrazione non è configurata su questa installazione.';
    }
    if (error.code == 'RECORDING_CONSENT_STALE') {
      return 'Le condizioni della chiamata sono cambiate. Rileggi il consenso.';
    }
    if (error.status == 413)
      return 'La registrazione supera il limite consentito.';
    if (error.status == 429)
      return 'Limite di utilizzo raggiunto. Puoi riprovare più tardi.';
  }
  final detail = error is StateError
      ? error.message
      : error is FormatException
      ? error.message
      : '';
  const known = {
    'Consenti l’accesso al microfono nelle impostazioni del dispositivo.',
    'Autorizzazione audio scaduta. Rientra nella chiamata.',
    'Ricevuta di ingresso incompleta.',
    'Ricevuta non riconosciuta.',
  };
  return known.contains(detail)
      ? detail
      : 'Impossibile completare l’operazione audio. Verifica la connessione e riprova.';
}
