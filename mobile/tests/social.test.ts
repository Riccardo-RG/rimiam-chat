import assert from "node:assert/strict";
import test from "node:test";
import {
  authReturn,
  nativeSocialCallback,
} from "../src/account/social-callback.ts";

test("only the expected native sign-in return can finish the pending device attempt", () => {
  const state = "a".repeat(64),
    code = "b".repeat(43);
  const url = nativeSocialCallback + "?" + new URLSearchParams({ state, code });
  assert.equal(authReturn(url, state), code);
  for (const other of [
    url.replace("com.rimiam.chat:", "not-our-app:"),
    url.replace(":/oauth", "://other/oauth"),
    url.replace("complete", "another"),
    url.replace(state, "c".repeat(64)),
    url + "#secret",
    url + "&state=" + state,
    url + "&code=" + code,
    url + "&error=cancelled",
    url.replace(code, "bad"),
  ]) {
    assert.throws(() => authReturn(other, state));
  }
});
