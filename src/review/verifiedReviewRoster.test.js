import { withVerifiedReviewRoster } from "./verifiedReviewRoster";

test("network shows all 15 printed-card identities without changing metrics", () => {
  const rows = withVerifiedReviewRoster([], ["khobar", "riyadh", "jeddah", "hettin"]);
  expect(rows).toHaveLength(15);
  expect(rows.filter((row) => row.branch === "hettin")).toHaveLength(8);
  expect(rows.filter((row) => row.branch === "riyadh")).toHaveLength(7);
  expect(rows.every((row) => row.scans === 0 && row.google === 0)).toBe(true);
});

test("branch view shows only that branch's printed-card identities", () => {
  expect(withVerifiedReviewRoster([], ["riyadh"]).map((row) => row.name).sort())
    .toEqual(["Ali", "Arif", "Joanitah", "Patrick", "Saud", "Sopon", "Suraj"]);
  expect(withVerifiedReviewRoster([], ["hettin"])).toHaveLength(8);
  expect(withVerifiedReviewRoster([], ["khobar"])).toEqual([]);
  expect(withVerifiedReviewRoster([], [])).toEqual([]);
});

test("historical staff activity and record identity win over roster fallback", () => {
  const historical = { name: "sopon", role: "", branch: "riyadh", scans: 23, google: 5, id: "existing-id" };
  const rows = withVerifiedReviewRoster([historical], ["riyadh"]);
  expect(rows).toHaveLength(7);
  expect(rows.filter((row) => row.name.toLowerCase() === "sopon")).toHaveLength(1);
  expect(rows.find((row) => row.name.toLowerCase() === "sopon"))
    .toMatchObject({ id: "existing-id", scans: 23, google: 5, role: "waiter" });
});
