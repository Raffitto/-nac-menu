/**
 * Edge mirror of Entity Registry v0 helpers.
 */

const CANONICAL_BRANCH_IDS = ["khobar", "riyadh", "jeddah"] as const;

export const ENTITY_REGISTRY_VERSION = "entity-registry-v0";

export const ENTITY_TYPES = [
  "document",
  "branch",
  "procedure",
  "policy",
  "standard",
  "checklist",
] as const;

const BRANCH_LABELS: Record<string, string> = {
  khobar: "Khobar",
  riyadh: "Riyadh",
  jeddah: "Jeddah",
};

type SupabaseLike = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{ data: { id: string } | null; error: { message: string } | null }>;
      };
    };
    insert: (row: Record<string, unknown>) => {
      select: (cols: string) => {
        single: () => Promise<{ data: { id: string }; error: { message: string } | null }>;
      };
    };
    update: (row: Record<string, unknown>) => {
      eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
    };
    upsert: (
      row: Record<string, unknown>,
      opts: { onConflict: string; ignoreDuplicates: boolean },
    ) => Promise<{ error: { message: string } | null }>;
  };
};

type FileRow = {
  id: string;
  title?: string | null;
  original_filename?: string | null;
  primary_branch_id?: string | null;
  branch_id?: string | null;
  brand_wide?: boolean;
  department?: string | null;
  sensitivity_level?: string | null;
  report_type?: string | null;
  classification_confidence?: number | null;
};

export function buildEntityCanonicalKey(
  entityType: string,
  { fileId, branchId, scope, slug }: { fileId?: string; branchId?: string; scope?: string; slug?: string } = {},
): string {
  switch (entityType) {
    case "document":
      if (!fileId) throw new Error("fileId required for document entity");
      return `document:${fileId}`;
    case "branch":
      if (!branchId) throw new Error("branchId required for branch entity");
      return `branch:${branchId}`;
    case "procedure":
    case "policy":
    case "standard":
    case "checklist": {
      if (!scope || !slug) throw new Error("scope and slug required for scoped entity");
      const normalizedSlug = String(slug).trim().toLowerCase().replace(/\s+/g, "_");
      return `${entityType}:${scope}:${normalizedSlug}`;
    }
    default:
      throw new Error(`Unknown entity type: ${entityType}`);
  }
}

function documentDisplayName(fileRecord: FileRow): string {
  return (
    String(fileRecord.title || "").trim()
    || String(fileRecord.original_filename || "").trim()
    || `Document ${fileRecord.id}`
  );
}

async function findEntityByCanonicalKey(admin: SupabaseLike, canonicalKey: string) {
  const { data, error } = await admin
    .from("ask_nac_entities")
    .select("id, entity_type, canonical_key")
    .eq("canonical_key", canonicalKey)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function recordEntityProvenance(
  admin: SupabaseLike,
  {
    entityId,
    sourceFileId = null,
    fileVersionId = null,
    compilerJobId = null,
    extractionMethod,
    confidence = null,
    createdBy = null,
  }: {
    entityId: string;
    sourceFileId?: string | null;
    fileVersionId?: string | null;
    compilerJobId?: string | null;
    extractionMethod: string;
    confidence?: number | null;
    createdBy?: string | null;
  },
) {
  const { error } = await admin.from("ask_nac_entity_provenance").insert({
    entity_id: entityId,
    source_file_id: sourceFileId,
    file_version_id: fileVersionId,
    compiler_job_id: compilerJobId,
    extraction_method: extractionMethod,
    confidence,
    created_by: createdBy,
  });
  if (error) throw error;
}

export async function ensureDocumentEntity(
  admin: SupabaseLike,
  {
    fileRecord,
    jobId = null,
    fileVersionId = null,
    extractionMethod = "ingestion_registry",
    createdBy = null,
  }: {
    fileRecord: FileRow;
    jobId?: string | null;
    fileVersionId?: string | null;
    extractionMethod?: string;
    createdBy?: string | null;
  },
) {
  if (!fileRecord?.id) return { ok: false, error: "Missing file record" };

  const canonicalKey = buildEntityCanonicalKey("document", { fileId: fileRecord.id });
  const branchId = fileRecord.primary_branch_id || null;
  const scope = branchId || "brand";

  const row = {
    entity_type: "document",
    canonical_key: canonicalKey,
    display_name: documentDisplayName(fileRecord),
    scope,
    branch_id: branchId,
    brand_wide: Boolean(fileRecord.brand_wide),
    department: fileRecord.department || "operations",
    sensitivity_level: fileRecord.sensitivity_level || "internal",
    authority_level: "uploaded_report",
    status: "active",
    metadata: {
      registry_version: ENTITY_REGISTRY_VERSION,
      report_type: fileRecord.report_type || null,
      file_id: fileRecord.id,
    },
    updated_at: new Date().toISOString(),
  };

  const existing = await findEntityByCanonicalKey(admin, canonicalKey);
  let entityId = existing?.id;

  if (entityId) {
    const { error } = await admin.from("ask_nac_entities").update(row).eq("id", entityId);
    if (error) throw error;
  } else {
    const { data, error } = await admin.from("ask_nac_entities").insert(row).select("id").single();
    if (error) throw error;
    entityId = data.id;
  }

  await recordEntityProvenance(admin, {
    entityId,
    sourceFileId: fileRecord.id,
    fileVersionId,
    compilerJobId: jobId,
    extractionMethod,
    confidence: fileRecord.classification_confidence ?? null,
    createdBy,
  });

  return { ok: true, entityId, canonicalKey, created: !existing };
}

export async function ensureBranchEntity(
  admin: SupabaseLike,
  { branchId, extractionMethod = "branch_seed", createdBy = null }: {
    branchId: string;
    extractionMethod?: string;
    createdBy?: string | null;
  },
) {
  if (!branchId || !CANONICAL_BRANCH_IDS.includes(branchId)) {
    return { ok: false, error: `Unsupported branch: ${branchId}` };
  }

  const canonicalKey = buildEntityCanonicalKey("branch", { branchId });
  const existing = await findEntityByCanonicalKey(admin, canonicalKey);
  if (existing?.id) {
    return { ok: true, entityId: existing.id, canonicalKey, created: false };
  }

  const { data, error } = await admin
    .from("ask_nac_entities")
    .insert({
      entity_type: "branch",
      canonical_key: canonicalKey,
      display_name: BRANCH_LABELS[branchId] || branchId,
      scope: branchId,
      branch_id: branchId,
      brand_wide: false,
      department: "operations",
      sensitivity_level: "internal",
      authority_level: "corporate_manual",
      status: "active",
      metadata: { registry_version: ENTITY_REGISTRY_VERSION, seeded: false },
    })
    .select("id")
    .single();
  if (error) throw error;

  await recordEntityProvenance(admin, {
    entityId: data.id,
    extractionMethod,
    confidence: 1,
    createdBy,
  });

  return { ok: true, entityId: data.id, canonicalKey, created: true };
}

export async function ensureEntityRelationship(
  admin: SupabaseLike,
  {
    sourceEntityId,
    targetEntityId,
    relationshipType,
    confidence = null,
    metadata = {},
  }: {
    sourceEntityId: string;
    targetEntityId: string;
    relationshipType: string;
    confidence?: number | null;
    metadata?: Record<string, unknown>;
  },
) {
  const { error } = await admin.from("ask_nac_entity_relationships").upsert(
    {
      source_entity_id: sourceEntityId,
      target_entity_id: targetEntityId,
      relationship_type: relationshipType,
      confidence,
      metadata,
    },
    { onConflict: "source_entity_id,target_entity_id,relationship_type", ignoreDuplicates: true },
  );
  if (error) throw error;
  return { ok: true };
}

export async function ensureIngestionEntities(
  admin: SupabaseLike,
  {
    fileRecord,
    jobId = null,
    fileVersionId = null,
    extractionMethod = "ingestion_registry",
    createdBy = null,
  }: {
    fileRecord: FileRow;
    jobId?: string | null;
    fileVersionId?: string | null;
    extractionMethod?: string;
    createdBy?: string | null;
  },
) {
  const document = await ensureDocumentEntity(admin, {
    fileRecord,
    jobId,
    fileVersionId,
    extractionMethod,
    createdBy,
  });

  const branchId = fileRecord.primary_branch_id || fileRecord.branch_id || null;
  if (!branchId || !CANONICAL_BRANCH_IDS.includes(branchId)) {
    return { ok: true, document, branch: null, relationship: null };
  }

  const branch = await ensureBranchEntity(admin, { branchId, createdBy });
  let relationship = null;
  if (document.entityId && branch.entityId) {
    relationship = await ensureEntityRelationship(admin, {
      sourceEntityId: document.entityId,
      targetEntityId: branch.entityId,
      relationshipType: "applies_to_branch",
      confidence: 1,
      metadata: { registry_version: ENTITY_REGISTRY_VERSION },
    });
  }

  return { ok: true, document, branch, relationship };
}
