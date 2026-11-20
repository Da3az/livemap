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
 * It is also the thing to diff against migrations/0002_role_aware_rls.sql when
 * either side changes.
 */
const EXPECTED: Record<Role, readonly Capability[]> = {
  owner: [
    "map:read",
    "map:create",
    "map:edit",
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

  test("every role can read; nothing else is universal", () => {
    for (const role of ROLES) assert.ok(can(role, "map:read"), role);
  });

  test("viewer holds exactly one capability", () => {
    assert.equal(capabilitiesOf("viewer").length, 1);
  });

  // The difference that defines the role: a contributor authors, someone else
  // publishes. This is the pairing publish.ts used to encode on its own.
  test("contributor may request a publish but not perform one", () => {
    assert.equal(can("contributor", "publish:request"), true);
    assert.equal(can("contributor", "map:publish"), false);
    assert.equal(can("contributor", "publish:decide"), false);
  });

  test("editor runs the desk but not the account", () => {
    assert.equal(can("editor", "map:publish"), true);
    assert.equal(can("editor", "member:manage"), false);
    assert.equal(can("editor", "feed:manage"), false);
    assert.equal(can("editor", "map:delete"), false);
  });
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
    assert.match(d.reason!, /only maps it created/);
  });

  test("ownership does not restrict the unrestricted roles", () => {
    for (const role of ["owner", "admin", "editor"]) {
      const d = authorizeMapEdit({ role, userId: "u-1" }, { createdBy: "u-2" });
      assert.equal(d.allowed, true, role);
    }
  });

  test("a viewer is refused before ownership is even considered", () => {
    const d = authorizeMapEdit({ role: "viewer", userId: "u-1" }, { createdBy: "u-1" });
    assert.equal(d.allowed, false);
    assert.match(d.reason!, /cannot edit maps/);
  });
});

describe("authorizePublish", () => {
  test("publishing roles are allowed", () => {
    for (const role of ["owner", "admin", "editor"]) {
      assert.equal(authorizePublish({ role }).allowed, true, role);
    }
  });

  // The reason is user-facing copy, and it has to route rather than just refuse.
  test("a contributor is told to submit for review", () => {
    const d = authorizePublish({ role: "contributor" });
    assert.equal(d.allowed, false);
    assert.match(d.reason!, /submit for review/);
  });

  test("a viewer is refused without being offered review", () => {
    const d = authorizePublish({ role: "viewer" });
    assert.equal(d.allowed, false);
    assert.doesNotMatch(d.reason!, /submit for review/);
  });
});
