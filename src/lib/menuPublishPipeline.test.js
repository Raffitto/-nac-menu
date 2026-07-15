import fs from "fs";
import path from "path";
import {
  buildPublishFailureMessage,
  isPublishDuplicateKeyError,
  publicationNeedsVerification,
} from "./menuPublishPipeline";

const migrationSource = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../supabase/migrations/20260715230000_menu_publish_idempotent.sql",
  ),
  "utf8",
);

describe("menu publish idempotency migration", () => {
  test("serializes branch publishes and allocates versions from max(version)", () => {
    expect(migrationSource).toMatch(/pg_advisory_xact_lock\(hashtext\('nac_menu_publish:'/);
    expect(migrationSource).toMatch(/coalesce\(max\(version\), 0\)/);
    expect(migrationSource).toMatch(/when unique_violation then/);
    expect(migrationSource).toMatch(/status = 'publishing'/);
    expect(migrationSource).toMatch(/already_live', true\)/);
  });
});

describe("menuPublishPipeline helpers", () => {
  test("detects duplicate publication version errors", () => {
    expect(
      isPublishDuplicateKeyError({
        message: 'duplicate key value violates unique constraint "menu_publications_branch_id_version_key"',
      }),
    ).toBe(true);
  });

  test("maps duplicate key errors to an actionable retry message", () => {
    expect(
      buildPublishFailureMessage({
        message: 'duplicate key value violates unique constraint "menu_publications_branch_id_version_key"',
      }),
    ).toBe(
      "Publish is already in progress for this branch. Wait a moment, then use Retry publish if the guest menu has not updated.",
    );
  });

  test("skips re-verification when publication is already live with the same snapshot", () => {
    expect(
      publicationNeedsVerification({
        id: "pub-1",
        status: "live",
        already_live: true,
      }),
    ).toBe(false);
    expect(
      publicationNeedsVerification({
        id: "pub-2",
        status: "publishing",
      }),
    ).toBe(true);
  });
});
