import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { AccountAccess, AccountPassword } from "../src/client/account-access";
import {
  accountErrorMessage,
  accountOAuthErrorReturn,
  accountReturnFromSearch,
} from "../src/shared/account-navigation";

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
  expect(disabled).not.toContain("Continua con Google");
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
