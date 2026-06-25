import { readFileSync } from "fs";
import path from "path";
import {
  buildEntityCanonicalKey,
  ensureBranchEntity,
  ensureDocumentEntity,
  ensureEntityRelationship,
  ensureIngestionEntities,
  ENTITY_TYPES,
} from "./entityRegistry";

const MIGRATION_PATH = path.resolve(
  __dirname,
  "../../../../supabase/migrations/20260626120000_ask_nac_entity_registry_foundation.sql",
);
const FOUNDATION_MIGRATION_PATH = path.resolve(
  __dirname,
  "../../../../supabase/migrations/20260606120000_ask_nac_data_vault_foundation.sql",
);

function createMockSupabase() {
  const entities = new Map();
  const provenance = [];
  const relationships = [];

  const from = (table) => {
    if (table === "ask_nac_entities") {
      return {
        select() {
          return {
            eq(_col, canonicalKey) {
              return {
                maybeSingle: async () => {
                  const row = [...entities.values()].find((e) => e.canonical_key === canonicalKey);
                  return { data: row || null, error: null };
                },
              };
            },
          };
        },
        insert(row) {
          return {
            select() {
              return {
                single: async () => {
                  const id = row.id || `entity-${entities.size + 1}`;
                  const record = { id, ...row };
                  entities.set(id, record);
                  return { data: { id }, error: null };
                },
              };
            },
          };
        },
        update(patch) {
          return {
            eq(_col, id) {
              const existing = entities.get(id);
              if (existing) entities.set(id, { ...existing, ...patch });
              return Promise.resolve({ error: null });
            },
          };
        },
        upsert(row, _opts) {
          const key = `${row.source_entity_id}:${row.target_entity_id}:${row.relationship_type}`;
          const existing = relationships.find(
            (r) =>
              r.source_entity_id === row.source_entity_id
              && r.target_entity_id === row.target_entity_id
              && r.relationship_type === row.relationship_type,
          );
          if (!existing) relationships.push({ ...row, _key: key });
          return Promise.resolve({ error: null });
        },
      };
    }

    if (table === "ask_nac_entity_provenance") {
      return {
        insert(row) {
          provenance.push(row);
          return Promise.resolve({ error: null });
        },
      };
    }

    if (table === "ask_nac_entity_relationships") {
      return {
        upsert(row, _opts) {
          const existing = relationships.find(
            (r) =>
              r.source_entity_id === row.source_entity_id
              && r.target_entity_id === row.target_entity_id
              && r.relationship_type === row.relationship_type,
          );
          if (!existing) relationships.push(row);
          return Promise.resolve({ error: null });
        },
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  };

  return {
    from,
    _entities: entities,
    _provenance: provenance,
    _relationships: relationships,
  };
}

describe("entity registry migration (static checks)", () => {
  let migrationSql;
  let foundationSql;

  beforeAll(() => {
    migrationSql = readFileSync(MIGRATION_PATH, "utf8");
    foundationSql = readFileSync(FOUNDATION_MIGRATION_PATH, "utf8");
  });

  test("defines core entity registry tables", () => {
    for (const table of [
      "ask_nac_entities",
      "ask_nac_entity_provenance",
      "ask_nac_entity_relationships",
    ]) {
      expect(migrationSql).toMatch(new RegExp(`create table if not exists public\\.${table}`));
    }
  });

  test("supports initial entity types", () => {
    for (const type of ENTITY_TYPES) {
      expect(migrationSql).toMatch(new RegExp(`'${type}'`));
    }
  });

  test("enforces canonical key uniqueness", () => {
    expect(migrationSql).toMatch(/idx_ask_nac_entities_canonical_key/);
    expect(migrationSql).toMatch(/canonical_key text not null/);
  });

  test("uses vault scope and branch RLS helpers", () => {
    expect(migrationSql).toMatch(/ask_nac_vault_can_read_scope/);
    expect(migrationSql).toMatch(/ask_nac_vault_branch_allowed/);
    expect(migrationSql).toMatch(/ask_nac_vault_can_read_file/);
  });

  test("seeds canonical branch entities", () => {
    expect(migrationSql).toMatch(/'branch:' \|\| v\.branch_id/);
    for (const branch of ["khobar", "riyadh", "jeddah"]) {
      expect(migrationSql).toMatch(new RegExp(`'${branch}'`));
    }
  });

  test("provenance links to source file, version, and compiler job", () => {
    expect(migrationSql).toMatch(/source_file_id uuid references public\.ask_nac_files/);
    expect(migrationSql).toMatch(/file_version_id uuid references public\.ask_nac_file_versions/);
    expect(migrationSql).toMatch(/compiler_job_id uuid references public\.ask_nac_ingestion_jobs/);
    expect(migrationSql).toMatch(/extraction_method text not null/);
    expect(migrationSql).toMatch(/confidence numeric/);
  });

  test("does not alter existing vault foundation tables", () => {
    expect(migrationSql).not.toMatch(/alter table public\.ask_nac_files/);
    expect(migrationSql).not.toMatch(/alter table public\.ask_nac_structured_facts/);
    expect(foundationSql).toMatch(/create table if not exists public\.ask_nac_files/);
  });
});

describe("entityRegistry helpers", () => {
  test("buildEntityCanonicalKey for document and branch", () => {
    expect(buildEntityCanonicalKey("document", { fileId: "abc-123" })).toBe("document:abc-123");
    expect(buildEntityCanonicalKey("branch", { branchId: "khobar" })).toBe("branch:khobar");
  });

  test("buildEntityCanonicalKey for scoped business entities", () => {
    expect(
      buildEntityCanonicalKey("procedure", { scope: "khobar", slug: "Opening Checklist" }),
    ).toBe("procedure:khobar:opening_checklist");
    expect(buildEntityCanonicalKey("policy", { scope: "brand", slug: "food_safety" })).toBe(
      "policy:brand:food_safety",
    );
  });

  test("ensureDocumentEntity creates document entity with provenance", async () => {
    const supabase = createMockSupabase();
    const fileRecord = {
      id: "file-1",
      title: "Khobar Daily Logbook",
      original_filename: "logbook.txt",
      primary_branch_id: "khobar",
      brand_wide: false,
      department: "operations",
      sensitivity_level: "internal",
      report_type: "daily_logbook",
      classification_confidence: 0.92,
    };

    const result = await ensureDocumentEntity(supabase, {
      fileRecord,
      jobId: "job-1",
      fileVersionId: "ver-1",
      extractionMethod: "test_ingest",
      createdBy: "test@nac.sa",
    });

    expect(result.ok).toBe(true);
    expect(result.canonicalKey).toBe("document:file-1");
    expect(result.created).toBe(true);
    expect(supabase._provenance).toHaveLength(1);
    expect(supabase._provenance[0]).toMatchObject({
      source_file_id: "file-1",
      file_version_id: "ver-1",
      compiler_job_id: "job-1",
      extraction_method: "test_ingest",
      confidence: 0.92,
      created_by: "test@nac.sa",
    });
  });

  test("ensureBranchEntity rejects unknown branches", async () => {
    const supabase = createMockSupabase();
    const result = await ensureBranchEntity(supabase, { branchId: "dubai" });
    expect(result.ok).toBe(false);
  });

  test("ensureBranchEntity uses canonical branch key", async () => {
    const supabase = createMockSupabase();
    const result = await ensureBranchEntity(supabase, { branchId: "riyadh" });
    expect(result.ok).toBe(true);
    expect(result.canonicalKey).toBe("branch:riyadh");
    expect(result.created).toBe(true);
  });

  test("ensureIngestionEntities links document to branch", async () => {
    const supabase = createMockSupabase();
    const fileRecord = {
      id: "file-2",
      original_filename: "cash_up.xlsx",
      primary_branch_id: "jeddah",
      brand_wide: false,
      department: "finance",
      sensitivity_level: "finance",
      report_type: "cash_up",
    };

    const result = await ensureIngestionEntities(supabase, {
      fileRecord,
      jobId: "job-2",
      extractionMethod: "compiler_link",
    });

    expect(result.ok).toBe(true);
    expect(result.document.canonicalKey).toBe("document:file-2");
    expect(result.branch.canonicalKey).toBe("branch:jeddah");
    expect(result.relationship).toMatchObject({ ok: true, relationshipType: "applies_to_branch" });
    expect(supabase._relationships).toHaveLength(1);
  });

  test("ensureEntityRelationship is idempotent", async () => {
    const supabase = createMockSupabase();
    await ensureEntityRelationship(supabase, {
      sourceEntityId: "doc-1",
      targetEntityId: "branch-1",
      relationshipType: "applies_to_branch",
    });
    await ensureEntityRelationship(supabase, {
      sourceEntityId: "doc-1",
      targetEntityId: "branch-1",
      relationshipType: "applies_to_branch",
    });
    expect(supabase._relationships).toHaveLength(1);
  });
});
