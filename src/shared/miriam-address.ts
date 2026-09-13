// Explicit addressing is visible in the retained human message, not hidden requester authority.
export function directlyAddressesMiriam(content: string) {
  return (
    /^\s*@?(?:miriam|rimiam)\b/iu.test(content) ||
    /^\s*(?:analizza|analyze|prepara un brief)[: ]\s*\S/iu.test(content)
  );
}
export function addressMiriam(content: string) {
  return directlyAddressesMiriam(content) ? content : `@Miriam ${content}`;
}
