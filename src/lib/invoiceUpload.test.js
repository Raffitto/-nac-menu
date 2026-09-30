const mockApi = {
  maybeSingle: jest.fn(),
  single: jest.fn(),
  upload: jest.fn(),
  remove: jest.fn(),
  getUser: jest.fn(),
};

jest.mock("./supabase", () => ({
  supabase: {
    auth: {
      getUser: (...args) => mockApi.getUser(...args),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => mockApi.maybeSingle(),
        }),
      }),
      insert: () => ({
        select: () => ({
          single: () => mockApi.single(),
        }),
      }),
    }),
    storage: {
      from: () => ({
        upload: (...args) => mockApi.upload(...args),
        remove: (...args) => mockApi.remove(...args),
      }),
    },
  },
}));

const { uploadInvoice } = require("./inventoryApi");

describe("uploadInvoice retry", () => {
  const photo = {
    name: "image.jpg",
    type: "image/jpeg",
    size: 12,
    arrayBuffer: async () => new TextEncoder().encode("iphone-photo").buffer,
  };

  beforeAll(() => {
    const { webcrypto } = require("crypto");
    if (!global.crypto?.subtle) {
      Object.defineProperty(global, "crypto", { value: webcrypto });
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockApi.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mockApi.maybeSingle.mockResolvedValue({ data: null, error: null });
    mockApi.remove.mockResolvedValue({ data: null, error: null });
  });

  test("maps an aborted storage upload to the upload stage and does not create an invoice", async () => {
    mockApi.upload.mockResolvedValue({ data: null, error: { message: "Fetch is aborted" } });

    await expect(uploadInvoice({ branchId: "khobar", file: photo })).rejects.toMatchObject({
      stage: "upload",
      message: "Invoice photo could not be uploaded. Your photo is still selected — tap Retry.",
    });
    expect(mockApi.single).not.toHaveBeenCalled();
    expect(mockApi.remove).not.toHaveBeenCalled();
  });

  test("reuses a storage object that finished after the client aborted and does not upload again", async () => {
    mockApi.upload.mockResolvedValue({
      data: null,
      error: { message: "The resource already exists", statusCode: "409" },
    });
    mockApi.single.mockResolvedValue({
      data: { id: "inv-1", status: "uploaded", ocr_status: "pending" },
      error: null,
    });

    const result = await uploadInvoice({ branchId: "khobar", file: photo });

    expect(result.duplicate).toBe(false);
    expect(result.invoice.id).toBe("inv-1");
    expect(mockApi.upload).toHaveBeenCalledTimes(1);
    expect(mockApi.remove).not.toHaveBeenCalled();
    expect(mockApi.single).toHaveBeenCalledTimes(1);
  });

  test("returns the existing invoice for the same photo without uploading or inserting again", async () => {
    mockApi.maybeSingle.mockResolvedValue({
      data: { id: "inv-existing", status: "needs_review", ocr_status: "completed" },
      error: null,
    });

    const result = await uploadInvoice({ branchId: "khobar", file: photo });

    expect(result).toEqual({
      invoice: { id: "inv-existing", status: "needs_review", ocr_status: "completed" },
      duplicate: true,
    });
    expect(mockApi.upload).not.toHaveBeenCalled();
    expect(mockApi.single).not.toHaveBeenCalled();
  });
});
