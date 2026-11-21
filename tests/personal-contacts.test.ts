import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { handleAPI } from "../src/server/api";
import { auth } from "../src/server/auth";
import {
  acceptInvitation,
  createWorkspace,
  execute,
} from "../src/server/commands";
import { pool, transaction } from "../src/server/db";
import { resolvePersonalContactEmails } from "../src/server/personal-contacts";

const base = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3000";
async function person(name: string) {
  const email = `${randomUUID()}@example.test`,
    password = "Personal-contacts-test-2026!";
  const { user } = await auth.api.signUpEmail({
    body: { email, password, name },
  });
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [
    user.id,
  ]);
  const login = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  const cookie = login.headers
    .getSetCookie()
    .map((v) => v.split(";")[0])
    .join("; ");
  return { id: user.id, email, name, cookie };
}
const read = (cookie = "", search = "") =>
  handleAPI(
    new Request(`${base}/api/v1/contacts${search}`, { headers: { cookie } }),
  );
afterAll(() => pool.end());

it("returns only eligible personal co-members, across departures and re-entry, without email or Workspace metadata", async () => {
  const [issuer, me, before, during, gap, pending] = await Promise.all(
    ["Owner", "Self", "Early", "Twin", "Gap", "Pending"].map(person),
  );
  const otherTwin = await person("Twin");
  const space = (
    await createWorkspace(issuer.id, "Contacts test", randomUUID())
  ).id;
  async function invite(who: typeof me, accept = true) {
    const invitation = await execute(issuer.id, space, randomUUID(), {
      type: "invitation.create",
      email: who.email,
      fullHistoryDisclosed: true,
    });
    if (accept) await acceptInvitation(who.id, String(invitation.token), true);
  }
  const leave = (who: typeof me) =>
    execute(who.id, space, randomUUID(), {
      type: "member.leave",
      confirmed: true,
    });
  await invite(before);
  await leave(before);
  await invite(me);
  await invite(during);
  await leave(me);
  await invite(gap);
  await leave(gap);
  await invite(me);
  await invite(otherTwin);
  await invite(pending, false);
  await leave(during);
  const response = await read(me.cookie);
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const { contacts, nextOffset } = await response.json();
  expect(nextOffset).toBeNull();
  expect(new Set(contacts)).toEqual(
    new Set([
      { id: issuer.id, name: issuer.name, nameAmbiguous: false },
      ...[during.id, otherTwin.id].map((id) => ({
        id,
        name: "Twin",
        nameAmbiguous: true,
      })),
    ]),
  );
  expect(contacts).toHaveLength(3);
  expect(
    (await (await read(me.cookie, "?q=TWIN")).json()).contacts,
  ).toHaveLength(2);
  expect((await (await read(me.cookie, "?q=%25")).json()).contacts).toEqual([]);
  expect((await read(me.cookie, "?offset=-1")).status).toBe(400);
  expect((await read()).status).toBe(401);
  expect((await (await read(pending.cookie)).json()).contacts).toEqual([]);
  await expect(
    transaction((tx) => resolvePersonalContactEmails(tx, me.id, [during.id])),
  ).resolves.toEqual(new Map([[during.id, during.email]]));
  for (const invalid of [gap, pending, before, me]) {
    await expect(
      transaction((tx) =>
        resolvePersonalContactEmails(tx, me.id, [during.id, invalid.id]),
      ),
    ).rejects.toThrow("PERSONAL_CONTACT_UNAVAILABLE");
  }
  await pool.query('UPDATE "user" SET eligible=false WHERE id=$1', [during.id]);
  expect((await (await read(me.cookie, "?q=Twin")).json()).contacts).toEqual([
    { id: otherTwin.id, name: "Twin", nameAmbiguous: false },
  ]);
  expect((await read(during.cookie)).status).toBe(403);
  await pool.query('DELETE FROM session WHERE "userId"=$1', [me.id]);
  expect((await read(me.cookie)).status).toBe(401);
});

it("uses serialized Workspace revisions when a legacy admission transaction began before the prior occupant left", async () => {
  const [owner, alumni, together, later, ambiguousBefore, ambiguousAfter] =
    await Promise.all(
      [
        "Owner",
        "Alumni",
        "Together",
        "Later",
        "Ambiguous first",
        "Ambiguous second",
      ].map(person),
    );
  const space = (
    await createWorkspace(owner.id, "Legacy chronology", randomUUID())
  ).id;
  // Model the old transaction-start timestamps exactly. The last admission
  // started at 12:00 but waited on the lock. Two other admissions share
  // a timestamp but fall on opposite sides of the departure.
  const stamp = (time: string) => `2010-10-02T${time}:00Z`;
  await transaction(async (tx) => {
    for (const [user, rev, at] of [
      [alumni, 100, "11:00"],
      [together, 101, "11:30"],
      [ambiguousBefore, 102, "12:10"],
      [later, 104, "12:00"],
      [ambiguousAfter, 105, "12:10"],
    ] as const) {
      const id = randomUUID();
      await tx.query(
        "INSERT INTO membership(workspace_id,user_id,active,version) VALUES($1,$2,$3,$4)",
        [space, user.id, user !== alumni, user === alumni ? 2 : 1],
      );
      await tx.query(
        `INSERT INTO invitation(id,workspace_id,recipient_email,token_hash,issuer_id,relationship_id,expires_at,history_disclosed,accepted_at,accepted_by)
        SELECT $1,$2,$3,$4,$5,id,now(),true,$6,$7 FROM access_relationship WHERE workspace_id=$2 AND holder_id=$5`,
        [id, space, user.email, randomUUID(), owner.id, stamp(at), user.id],
      );
      await tx.query(
        `INSERT INTO membership_history(id,workspace_id,user_id,version,active,actor_id,basis,full_history_accepted,created_at)
        VALUES($1,$2,$3,1,true,$3,$4,true,$5)`,
        [randomUUID(), space, user.id, `invitation:${id}`, stamp(at)],
      );
      await tx.query(
        "INSERT INTO workspace_change(workspace_id,revision,kind,created_at) VALUES($1,$2,'member.joined',$3)",
        [space, rev, stamp(at)],
      );
    }
    await tx.query(
      `INSERT INTO membership_history(id,workspace_id,user_id,version,active,actor_id,basis,full_history_accepted,created_at)
      VALUES($1,$2,$3,2,false,$3,'member.leave',false,$4)`,
      [randomUUID(), space, alumni.id, stamp("13:00")],
    );
    await tx.query(
      "INSERT INTO workspace_change(workspace_id,revision,kind,created_at) VALUES($1,103,'member.leave',$2)",
      [space, stamp("13:00")],
    );
    await tx.query(
      "INSERT INTO command_receipt(workspace_id,actor_id,command_id,request_hash,result,created_at) VALUES($1,$2,$3,'historical fixture','{}',$4)",
      [space, alumni.id, randomUUID(), stamp("13:00")],
    );
  });
  expect(
    (await (await read(alumni.cookie, "?q=Later")).json()).contacts,
  ).toEqual([]);
  expect(
    (await (await read(alumni.cookie, "?q=Ambiguous")).json()).contacts,
  ).toEqual([]);
  expect(
    (await (await read(alumni.cookie, "?q=Together")).json()).contacts,
  ).toEqual([{ id: together.id, name: "Together", nameAmbiguous: false }]);
});
