// Native token contracts exclude whitespace. Old encrypted credentials therefore
// remain unambiguous and continue to use notifications with a literal body.
const localizedPrefix = "localized-v1 ";

export const storedNativeCredential = (token: string, localized: boolean) =>
  localized ? localizedPrefix + token : token;

export function readNativeCredential(stored: string) {
  const localized = stored.startsWith(localizedPrefix);
  return {
    localized,
    token: localized ? stored.slice(localizedPrefix.length) : stored,
  };
}
