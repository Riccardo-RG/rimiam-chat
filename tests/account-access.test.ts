import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { AccountAccess, AccountPassword } from "../src/client/account-access";
import {
  accountErrorMessage,
  accountOAuthErrorReturn,
  accountReturnFromSearch,
  workspaceEntryFromSearch,
  socialCallbackError,
} from "../src/shared/account-navigation";

it("resumes the same invitation in an existing session, including a local OAuth return", () => {
  const token = "a".repeat(43);
  const entry = { invitation: token, workspace: "", invalidInvitation: false };
  expect(
    workspaceEntryFromSearch(`?workspace=ignored&invite=${token}`),
  ).toEqual(entry);
  expect(
    workspaceEntryFromSearch(
      `?returnTo=${encodeURIComponent(`/?invite=${token}`)}&error=access_denied`,
    ),
  ).toEqual(entry);
  expect(workspaceEntryFromSearch("?returnTo=https%3A%2F%2Fevil.test")).toEqual(
    { workspace: "", invitation: "", invalidInvitation: false },
  );
  for (const query of ["?invite=", "?invite=truncated", "?invite=../something"])
    expect(workspaceEntryFromSearch(query)).toEqual({
      workspace: "",
      invitation: "",
      invalidInvitation: true,
    });
});

it("keeps an invitation across OAuth cancellation without accepting arbitrary redirects or provider text", () => {
  const returnTo = `/?invite=${"a".repeat(43)}`;
  const errorReturn = accountOAuthErrorReturn(returnTo);
  expect(
    accountReturnFromSearch(
      new URL(`${errorReturn}&error=access_denied`, "https://app.test").search,
    ),
  ).toBe(returnTo);
  expect(accountOAuthErrorReturn("https://untrusted.test/")).toBe(
    "/?returnTo=%2F",
  );
  expect(accountErrorMessage("access_denied")).toContain("annullato");
  expect(accountErrorMessage("account_not_linked")).toContain(
    "verifica l’indirizzo",
  );
  expect(accountErrorMessage("google_email_unverified")).toContain(
    "non ha confermato",
  );
  expect(accountErrorMessage("account_ineligible")).toContain(
    "non può accedere",
  );
  expect(accountErrorMessage("<script>untrusted-token</script>")).not.toContain(
    "untrusted-token",
  );
  expect(accountErrorMessage(undefined, 429)).toContain("Troppi tentativi");
});

it("exposes Google only when configured and keeps invitation acceptance separate from authentication", () => {
  const props = { returnTo: `/?invite=${"a".repeat(43)}`, localMail: false };
  const enabled = renderToStaticMarkup(
    createElement(AccountAccess, { ...props, googleAvailable: true }),
  );
  const disabled = renderToStaticMarkup(
    createElement(AccountAccess, { ...props, googleAvailable: false }),
  );
  expect(enabled).toContain("Continua con Google");
  expect(disabled).toContain("Accedi per aprire l’invito");
  expect(disabled).not.toContain("Continua con Google");
  expect(disabled).toContain(
    "L’accesso con Google e Microsoft non è ancora attivo",
  );
  expect(enabled).toContain("leggere e accettare l’invito");
  expect(enabled).toContain("returnTo=%2F%3Finvite%3D");
  expect(enabled).toContain('href="/beta"');
  expect(disabled).toContain('type="email"');
  expect(disabled).toContain('autoComplete="current-password"');
});

it("explains password creation requirements accessibly without imposing them as a client login gate", () => {
  const signup = renderToStaticMarkup(
    createElement(AccountPassword, { signup: true, disabled: false }),
  );
  const login = renderToStaticMarkup(
    createElement(AccountPassword, { signup: false, disabled: false }),
  );
  expect(signup).toContain("Da 12 a 128 caratteri");
  expect(signup).toContain("aria-describedby=");
  expect(signup).toContain('minLength="12"');
  expect(login).not.toContain("minLength");
  expect(login).toContain('aria-label="Mostra password"');
  expect(login).toContain('type="password"');
});

it("associates a password mismatch with its field while retaining the creation requirements", () => {
  const html = renderToStaticMarkup(
    createElement(AccountPassword, {
      label: "Ripeti la nuova password",
      name: "repeat",
      signup: true,
      disabled: false,
      error: "Le due password non coincidono.",
    }),
  );
  const describedBy = html.match(/aria-describedby="([^"]+)"/)?.[1].split(" ");
  expect(describedBy).toHaveLength(2);
  for (const id of describedBy ?? []) expect(html).toContain(`id="${id}"`);
  expect(html).toContain('aria-invalid="true"');
  expect(html).toContain('name="repeat"');
  expect(html).toContain('role="alert"');
  expect(html).toContain("Le due password non coincidono.");
  expect(html).toContain("Da 12 a 128 caratteri");
});

it("lists only configured sign-in providers and preserves Microsoft invitation recovery", () => {
  const returnTo = `/?invite=${"a".repeat(43)}`;
  for (const googleAvailable of [true, false])
    for (const microsoftAvailable of [true, false]) {
      const html = renderToStaticMarkup(
        createElement(AccountAccess, {
          googleAvailable,
          microsoftAvailable,
          returnTo,
          localMail: false,
        }),
      );
      expect(html.includes("Continua con Microsoft")).toBe(microsoftAvailable);
      expect(html.includes("Continua con Google")).toBe(googleAvailable);
      expect(html.match(/oppure con email/g)?.length ?? 0).toBe(
        googleAvailable || microsoftAvailable ? 1 : 0,
      );
    }
  const search = new URL(
    accountOAuthErrorReturn(returnTo, "microsoft") +
      "&error=account_not_linked",
    "https://app.test",
  ).search;
  expect(accountReturnFromSearch(search)).toBe(returnTo);
  expect(accountErrorMessage(socialCallbackError(search))).toContain(
    "«Metodi di accesso»",
  );
  expect(socialCallbackError("?error=account_not_linked")).toBe(
    "account_not_linked",
  );
});
