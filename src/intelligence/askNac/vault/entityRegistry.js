/**
 * NAC Brain Entity Registry v0 — durable business-object layer.
 * Documents remain evidence; entities become memory.
 */

import { CANONICAL_BRANCH_IDS } from "../../../dashboard/utils/branchIdentity";
import { VAULT_BRANCH_OPTIONS } from "./vaultConstants";

export const ENTITY_REGISTRY_VERSION = "entity-registry-v0";

export const ENTITY_TYPES = Object.freeze([
  "document",
  "branch",
  "procedure",
  "policy",
  "standard",
  "checklist",
]);

export const ENTITY_RELATIONSHIP_TYPES = Object.freeze([
  "applies_to_branch",
  "evidenced_by",
  "supersedes",
  "related_to",
]);

const BRANCH_LABELS = Object.fromEntries(
  VAULT_BRANCH_OPTIONS.filter((b) => b.value !== "brand").map((b) => [b.value, b.label]),
);

/**
 * Build stable canonical key for an entity.
 * document:{file_id}, branch:{branch_id}, {type}:{scope}:{slug}
 */
export function buildEntityCanonicalKey(entityType, { fileId, branchId, scope, slug } = {}) {
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

function branchDisplayName(branchId) {
  return BRANCH_LABELS[branchId] || String(branchId);
}

function documentDisplayName(fileRecord) {
  return (
    String(fileRecord.title || "").trim()
    || String(fileRecord.original_filename || "").trim()
    || `Document ${fileRecord.id}`
  );
}

async function findEntityByCanonicalKey(supabase, canonicalKey) {
  const { data, error } = await supabase
    .from("ask_nac_entities")
    .select("id, entity_type, canonical_key")
    .eq("canonical_key", canonicalKey)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function recordEntityProvenance(supabase, {
  entityId,
  sourceFileId = null,
  fileVersionId = null,
  compilerJobId = null,
  extractionMethod,
  confidence = null,
  createdBy = null,
}) {
  const { error } = await supabase.from("ask_nac_entity_provenance").insert({
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

/**
 * Upsert a document entity for an ingested vault file.
 */
export async function ensureDocumentEntity(supabase, {
  fileRecord,
  jobId = null,
  fileVersionId = null,
  extractionMethod = "ingestion_registry",
  confidence = null,
  createdBy = null,
}) {
  if (!supabase || !fileRecord?.id) {
    return { ok: false, error: "Missing file record" };
  }

  const canonicalKey = buildEntityCanonicalKey("document", { fileId: fileRecord.id });
  const displayName = documentDisplayName(fileRecord);
  const branchId = fileRecord.primary_branch_id || null;
  const scope = branchId || (fileRecord.brand_wide ? "brand" : "brand");

  const row = {
    entity_type: "document",
    canonical_key: canonicalKey,
    display_name: displayName,
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

  const existing = await findEntityByCanonicalKey(supabase, canonicalKey);
  let entityId = existing?.id;

  if (entityId) {
    const { error } = await supabase.from("ask_nac_entities").update(row).eq("id", entityId);
    if (error) throw error;
  } else {
    const { data, error } = await supabase
      .from("ask_nac_entities")
      .insert(row)
      .select("id")
      .single();
    if (error) throw error;
    entityId = data.id;
  }

  await recordEntityProvenance(supabase, {
    entityId,
    sourceFileId: fileRecord.id,
    fileVersionId,
    compilerJobId: jobId,
    extractionMethod,
    confidence: confidence ?? fileRecord.classification_confidence ?? null,
    createdBy,
  });

  return { ok: true, entityId, canonicalKey, created: !existing };
}

/**
 * Upsert a branch entity for a canonical NAC branch.
 */
export async function ensureBranchEntity(supabase, {
  branchId,
  extractionMethod = "branch_seed",
  createdBy = null,
}) {
  if (!supabase || !branchId) {
    return { ok: false, error: "Missing branchId" };
  }
  if (!CANONICAL_BRANCH_IDS.includes(branchId)) {
    return { ok: false, error: `Unsupported branch: ${branchId}` };
  }

  const canonicalKey = buildEntityCanonicalKey("branch", { branchId });
  const existing = await findEntityByCanonicalKey(supabase, canonicalKey);
  if (existing?.id) {
    return { ok: true, entityId: existing.id, canonicalKey, created: false };
  }

  const row = {
    entity_type: "branch",
    canonical_key: canonicalKey,
    display_name: branchDisplayName(branchId),
    scope: branchId,
    branch_id: branchId,
    brand_wide: false,
    department: "operations",
    sensitivity_level: "internal",
    authority_level: "corporate_manual",
    status: "active",
    metadata: {
      registry_version: ENTITY_REGISTRY_VERSION,
      seeded: false,
    },
  };

  const { data, error } = await supabase
    .from("ask_nac_entities")
    .insert(row)
    .select("id")
    .single();
  if (error) throw error;

  await recordEntityProvenance(supabase, {
    entityId: data.id,
    extractionMethod,
    confidence: 1,
    createdBy,
  });

  return { ok: true, entityId: data.id, canonicalKey, created: true };
}

/**
 * Create or ignore an entity relationship (idempotent).
 */
export async function ensureEntityRelationship(supabase, {
  sourceEntityId,
  targetEntityId,
  relationshipType,
  confidence = null,
  metadata = {},
}) {
  if (!sourceEntityId || !targetEntityId || !relationshipType) {
    return { ok: false, error: "Missing relationship fields" };
  }

  const { error } = await supabase.from("ask_nac_entity_relationships").upsert(
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
  return { ok: true, sourceEntityId, targetEntityId, relationshipType };
}

/**
 * Non-blocking ingestion hook: document entity + branch link when safe.
 */
export async function ensureIngestionEntities(supabase, {
  fileRecord,
  jobId = null,
  fileVersionId = null,
  extractionMethod = "ingestion_registry",
  createdBy = null,
}) {
  const document = await ensureDocumentEntity(supabase, {
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

  const branch = await ensureBranchEntity(supabase, {
    branchId,
    extractionMethod: "branch_seed",
    createdBy,
  });

  let relationship = null;
  if (document.entityId && branch.entityId) {
    relationship = await ensureEntityRelationship(supabase, {
      sourceEntityId: document.entityId,
      targetEntityId: branch.entityId,
      relationshipType: "applies_to_branch",
      confidence: 1,
      metadata: { registry_version: ENTITY_REGISTRY_VERSION },
    });
  }

  return { ok: true, document, branch, relationship };
}
