import { randomUUID } from "node:crypto";
import { afterAll, describe, it, expect } from "vitest";
import { pool } from "../src/server/db";
import {
  execute,
  createWorkspace,
  acceptInvitation,
} from "../src/server/commands";
import { snapshot } from "../src/server/queries";
afterAll(() => pool.end());
async function person() {
  const id = randomUUID();
  await pool.query(
    'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt",eligible) VALUES($1,$1,$2,true,now(),now(),true)',
    [id, `${id}@example.test`],
  );
  return id;
}
async function join(a: string, b: string, w: string) {
  const r = await execute(a, w, randomUUID(), {
    type: "invitation.create",
    email: `${b}@example.test`,
    fullHistoryDisclosed: true,
  });
  await acceptInvitation(b, r.token as string, true);
}
describe("Related Workspace navigation, not inheritance", () => {
  it("independently checks both endpoints and reveals no link, name or history to a single-space member", async () => {
    const a = await person(),
      b = await person(),
      c = await person();
    const w = (await createWorkspace(a, "Shared space", randomUUID())).id,
      other = (await createWorkspace(a, "Private other space", randomUUID()))
        .id;
    await join(a, b, w);
    await join(a, c, w);
    await join(a, c, other);
    await expect(
      execute(b, w, randomUUID(), {
        type: "workspace.link",
        otherWorkspaceId: other,
        expectedVersion: 0,
        linked: true,
      }),
    ).rejects.toThrow("WORKSPACE_ACCESS_DENIED");
    const before = await snapshot(a, w);
    await execute(a, w, randomUUID(), {
      type: "workspace.link",
      otherWorkspaceId: other,
      expectedVersion: 0,
      linked: true,
    });
    const state = await snapshot(a, w);
    expect(state.links[0]).toMatchObject({
      id: other,
      name: "Private other space",
      version: 1,
      active: true,
    });
    expect(state.links[0].history[0].actor_id).toBe(a);
    expect((await snapshot(b, w)).links).toEqual([]);
    expect(JSON.stringify(await snapshot(b, w))).not.toContain(other);
    expect((await snapshot(c, w)).links).toHaveLength(1);
    expect(state.workspace.context_revision).toBe(
      before.workspace.context_revision,
    );
    expect(state.goals).toEqual(before.goals);
    expect(state.information).toEqual(before.information);
    expect(state.access).toEqual(before.access);
    expect(state.messages).toEqual(before.messages);
    await execute(c, other, randomUUID(), {
      type: "member.leave",
      confirmed: true,
    });
    expect((await snapshot(c, w)).links).toEqual([]);
    await expect(
      execute(c, w, randomUUID(), {
        type: "workspace.link",
        otherWorkspaceId: other,
        expectedVersion: 1,
        linked: false,
      }),
    ).rejects.toThrow("WORKSPACE_ACCESS_DENIED");
  });
  it("uses stable lock ordering, version-bound changes and immutable attributable history without duplicating links", async () => {
    const a = await person(),
      w = (await createWorkspace(a, "A", randomUUID())).id,
      other = (await createWorkspace(a, "B", randomUUID())).id;
    const results = await Promise.allSettled([
      execute(a, w, randomUUID(), {
        type: "workspace.link",
        otherWorkspaceId: other,
        expectedVersion: 0,
        linked: true,
      }),
      execute(a, other, randomUUID(), {
        type: "workspace.link",
        otherWorkspaceId: w,
        expectedVersion: 0,
        linked: true,
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const commandId = randomUUID(),
      command = {
        type: "workspace.link",
        otherWorkspaceId: other,
        expectedVersion: 1,
        linked: false,
      };
    await execute(a, w, commandId, command);
    await execute(a, w, commandId, command);
    let link = (await snapshot(a, w)).links[0];
    expect(link.active).toBe(false);
    expect(link.history).toHaveLength(2);
    await execute(a, w, randomUUID(), {
      ...command,
      expectedVersion: 2,
      linked: true,
    });
    link = (await snapshot(a, w)).links[0];
    expect(link.version).toBe(3);
    const [first, second] = [w, other].sort();
    await expect(
      pool.query(
        "UPDATE workspace_link_version SET active=false WHERE first_workspace=$1 AND second_workspace=$2",
        [first, second],
      ),
    ).rejects.toThrow("immutable");
    await expect(
      execute(a, w, randomUUID(), {
        type: "workspace.link",
        otherWorkspaceId: w,
        expectedVersion: 0,
        linked: true,
      }),
    ).rejects.toThrow("WORKSPACE_LINK_INVALID");
    await pool.query('UPDATE "user" SET eligible=false WHERE id=$1', [a]);
    await expect(snapshot(a, w)).rejects.toThrow("ACCOUNT_INELIGIBLE");
  });
});
