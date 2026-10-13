import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

const adminUrl = process.env.M2_TEST_ADMIN_URL;

test("concurrent first login resolves one actor", async (t) => {
  if (!adminUrl) {
    t.skip("M2_TEST_ADMIN_URL is not set");
    return;
  }
  const subject = `concurrent-login-${Date.now()}`;
  const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
  try {
    const [first, second] = await Promise.all([
      admin.query<{ provision_authenticated_actor: string }>(
        "SELECT ops.provision_authenticated_actor($1, $2, $3)",
        ["firebase", subject, "first@monytix.test"],
      ),
      admin.query<{ provision_authenticated_actor: string }>(
        "SELECT ops.provision_authenticated_actor($1, $2, $3)",
        ["firebase", subject, "second@monytix.test"],
      ),
    ]);
    const actorId = first.rows[0].provision_authenticated_actor;
    assert.equal(second.rows[0].provision_authenticated_actor, actorId);
    const count = await admin.query<{ count: string }>(
      "SELECT count(*) FROM core.authenticated_actor WHERE auth_provider = 'firebase' AND auth_subject = $1",
      [subject],
    );
    assert.equal(count.rows[0].count, "1");
  } finally {
    await admin.end();
  }
});