import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  ROLES,
  can,
  capabilitiesOf,
  isRole,
  authorizeMapEdit,
  authorizePublish,
  type Capability,
  type Role,
} from "../src/authz.js";

/**
 * The grid, written out as data rather than assembled from the module under
 * test. A test that derives its expectations from the implementation only
 * proves the implementation is self-consistent; this one fails if a capability
 * silently moves.
 *
 * It is also the thing to diff against migrations/0002_role_aware_rls.sql and
 * migrations/0004 (which adds map:archive for owner and admin) when either
 * side changes.
 */
const EXPECTED: Record<Role, readonly Capability[]> = {
  owner: [
    "map:read",
    "map:create",
    "map:edit",
    "map:archive",
    "map:delete",
    "map:publish",
    "publish:request",
    "publish:decide",
    "member:manage",
    "theme:manage",
    "asset:manage",
    "feed:manage",
  ],
  admin: [
    "map:read",
    "map:create",
    "map:edit",
    "map:archive",
    "map:delete",
    "map:publish",
    "publish:request",
    "publish:decide",
    "member:manage",
    "theme:manage",
    "asset:manage",
    "feed:manage",
  ],
  editor: [
    "map:read",
    "map:create",
    "map:edit",
    "map:publish",
    "publish:request",
    "publish:decide",
    "theme:manage",
    "asset:manage",
  ],
  contributor: ["map:read", "map:create", "map:edit", "publish:request"],
  viewer: ["map:read"],
};

describe("the role grid", () => {
  for (const role of ROLES) {
    test(`${role} holds exactly its documented capabilities`, () => {
      assert.deepEqual(
        [...capabilitiesOf(role)].sort(),
        [...EXPECTED[role]].sort(),
      );
    });
  }
});

describe("unknown roles", () => {
  // Fail closed, exactly as livemap_granted_role() does when no membership
  // matches: an unrecognised role is not an error, it simply has nothing.
  for (const bogus of ["wizard", "", "OWNER", "admin ", "superuser"]) {
    test(`"${bogus}" has no capabilities`, () => {
      assert.equal(isRole(bogus), false);
      assert.deepEqual(capabilitiesOf(bogus), []);
      assert.equal(can(bogus, "map:read"), false);
      assert.equal(can(bogus, "map:publish"), false);
    });
  }
});

describe("authorizeMapEdit", () => {
  const owner = { role: "contributor", userId: "u-1" };

  test("a contributor may edit its own map", () => {
    const d = authorizeMapEdit(owner, { createdBy: "u-1" });
    assert.equal(d.allowed, true);
    assert.equal(d.reason, undefined);
  });

  test("a contributor may not edit another user's map", () => {
    const d = authorizeMapEdit(owner, { createdBy: "u-2" });
    assert.equal(d.allowed, false);
    assert.ok(d.reason, "a refusal carries a reason for the client");
  });

  test("ownership does not restrict the unrestricted roles", () => {
    for (const role of ["owner", "admin", "editor"]) {
      const d = authorizeMapEdit({ role, userId: "u-1" }, { createdBy: "u-2" });
      assert.equal(d.allowed, true, role);
    }
  });

  test("a viewer is refused before ownership is even considered", () => {
    // The viewer created this map, so an ownership check alone would pass it.
    const d = authorizeMapEdit({ role: "viewer", userId: "u-1" }, { createdBy: "u-1" });
    assert.equal(d.allowed, false);
    assert.ok(d.reason);
    // Refused on role, not on ownership: it is not given the ownership refusal.
    const ownership = authorizeMapEdit(owner, { createdBy: "u-2" });
    assert.notEqual(d.reason, ownership.reason);
  });
});

describe("authorizePublish", () => {
  test("publishing roles are allowed", () => {
    for (const role of ["owner", "admin", "editor"]) {
      assert.equal(authorizePublish({ role }).allowed, true, role);
    }
  });

  test("a viewer is refused without being offered review", () => {
    // A viewer cannot request a publish, so its refusal must not point it at
    // review or at asking someone else to publish, as a contributor's does.
    const d = authorizePublish({ role: "viewer" });
    assert.equal(d.allowed, false);
    assert.ok(d.reason);
    assert.doesNotMatch(d.reason!, /review|request|submit|\bask\b/i);
    assert.notEqual(d.reason, authorizePublish({ role: "contributor" }).reason);
  });
});
