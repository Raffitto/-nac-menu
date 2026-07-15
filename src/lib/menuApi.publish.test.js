jest.mock("./supabase", () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
    auth: {
      getSession: jest.fn().mockResolvedValue({
        data: { session: { user: { id: "test-user" } } },
        error: null,
      }),
    },
  },
}));

jest.mock("./menuVisibility", () => ({
  filterPublicMenuData: (data) => data,
}));

import { supabase } from "./supabase";
import { publishAndVerifyMenuBranch } from "./menuApi";

const guestMenu = {
  menuData: {
    breakfast: [{ items: [{ id: "item-1", en: "Shakshuka", featured: false }] }],
  },
};

function mockPublishRpc(sequence) {
  let call = 0;
  supabase.rpc.mockImplementation((fn) => {
    if (fn === "publish_menu_branch") {
      const payload = sequence[Math.min(call, sequence.length - 1)];
      call += 1;
      if (payload.error) return Promise.resolve({ data: null, error: payload.error });
      return Promise.resolve({ data: payload.data, error: null });
    }
    if (fn === "verify_menu_publication") {
      return Promise.resolve({
        data: {
          status: "live",
          verification_result: { verified: true },
        },
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  });
}

function createQuery() {
  const result = Promise.resolve({ data: [], error: null });
  result.eq = jest.fn(() => result);
  result.select = jest.fn(() => result);
  result.order = jest.fn(() => result);
  result.in = jest.fn(() => result);
  return result;
}

beforeEach(() => {
  jest.clearAllMocks();
  supabase.auth.getSession.mockResolvedValue({
    data: { session: { user: { id: "test-user" } } },
    error: null,
  });
  supabase.from.mockImplementation(() => createQuery());
});

describe("publishAndVerifyMenuBranch idempotency", () => {
  test("repeated publish with the same idempotency key succeeds", async () => {
    const publication = {
      id: "pub-1",
      version: 12,
      status: "publishing",
    };
    mockPublishRpc([{ data: publication }, { data: { ...publication, idempotent: true } }]);

    const options = {
      branchId: "khobar",
      changeSummary: { action: "update_item" },
      idempotencyKey: "khobar:update_item:fixed-key",
    };

    const first = await publishAndVerifyMenuBranch(options);
    const second = await publishAndVerifyMenuBranch(options);

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(supabase.rpc).toHaveBeenCalledWith(
      "publish_menu_branch",
      expect.objectContaining({ p_idempotency_key: "khobar:update_item:fixed-key" }),
    );
  });

  test("already-live publication skips duplicate verification work and succeeds", async () => {
    mockPublishRpc([
      {
        data: {
          id: "pub-live",
          version: 20,
          status: "live",
          already_live: true,
          verification_result: { verified: true },
        },
      },
    ]);

    const result = await publishAndVerifyMenuBranch({
      branchId: "khobar",
      changeSummary: { action: "publish" },
      idempotencyKey: "khobar:publish:live",
    });

    expect(result.error).toBeNull();
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      "verify_menu_publication",
      expect.anything(),
    );
  });

  test("duplicate key errors return an actionable message instead of raw SQL", async () => {
    mockPublishRpc([
      {
        error: {
          message:
            'duplicate key value violates unique constraint "menu_publications_branch_id_version_key"',
        },
      },
    ]);

    const result = await publishAndVerifyMenuBranch({
      branchId: "khobar",
      changeSummary: { action: "publish" },
      idempotencyKey: "khobar:publish:dup",
    });

    expect(result.error?.message).toContain("Publish is already in progress");
    expect(result.error?.message).not.toContain("menu_publications_branch_id_version_key");
  });

  test("rapid consecutive publishes can reuse an in-flight publication row", async () => {
    const publication = { id: "pub-reused", version: 15, status: "publishing" };
    mockPublishRpc([
      { data: publication },
      { data: { ...publication, reused: true } },
    ]);

    const first = await publishAndVerifyMenuBranch({
      branchId: "khobar",
      changeSummary: { action: "update_item" },
      idempotencyKey: "khobar:update_item:one",
    });
    const second = await publishAndVerifyMenuBranch({
      branchId: "khobar",
      changeSummary: { action: "update_item" },
      idempotencyKey: "khobar:update_item:two",
    });

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
  });
});
