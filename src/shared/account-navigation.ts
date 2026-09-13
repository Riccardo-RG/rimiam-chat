// Only known application destinations survive an account flow; never redirect to an arbitrary caller URL.
export function safeAccountReturn(raw: string | null | undefined): string {
  if (!raw || !(raw === "/" || raw.startsWith("/?"))) return "/";
  const url = new URL(raw, "https://miriam.invalid");
  if (url.origin !== "https://miriam.invalid" || url.pathname !== "/")
    return "/";
  const invite = url.searchParams.get("invite");
  if (invite && /^[A-Za-z0-9_-]{43}$/.test(invite))
    return `/?invite=${encodeURIComponent(invite)}`;
  const workspace = url.searchParams.get("workspace");
  if (
    workspace &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      workspace,
    )
  )
    return `/?workspace=${workspace}`;
  return "/";
}
export function accountReturnFromSearch(search: string) {
  const params = new URLSearchParams(search);
  return safeAccountReturn(params.get("returnTo") ?? `/${search}`);
}
