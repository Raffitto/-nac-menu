/**
 * Production document-search investigation (read-only diagnostics).
 *
 * Compares admin vs scoped-user visibility for vault document search / FTS.
 * No uploads, mutations, deletes, or sync.
 *
 * Run:
 *   node tmp-vault-verify/doc-search-prod-investigate.mjs
 *
 * Environment:
 *   SUPABASE_URL                 Supabase project URL
 *   SUPABASE_ANON_KEY            Anon key (falls back to REACT_APP_* in .env.local)
 *   ASK_NAC_ACCESS_TOKEN         Bearer token — skips magic-link auth when set
 *   ASK_NAC_VERIFY_EMAIL         Scoped user email (required when token unset)
 *   SUPABASE_PROJECT_REF         Project ref for `supabase projects api-keys` (when token unset)
 *   ASK_NAC_VERIFY_REDIRECT      Magic-link redirect URL (required when token unset)
 */
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");

function readEnvLocalValue(key) {
  const envPath = path.join(REPO_ROOT, ".env.local");
  if (!fs.existsSync(envPath)) return null;
  return fs.readFileSync(envPath, "utf8").match(new RegExp(`^${key}=(.+)$`, "m"))?.[1]?.trim() || null;
}

function loadConfig() {
  const supabaseUrl = process.env.SUPABASE_URL
    || process.env.REACT_APP_SUPABASE_URL
    || readEnvLocalValue("REACT_APP_SUPABASE_URL");
  const anonKey = process.env.SUPABASE_ANON_KEY
    || process.env.REACT_APP_SUPABASE_ANON_KEY
    || readEnvLocalValue("REACT_APP_SUPABASE_ANON_KEY");
  const accessToken = process.env.ASK_NAC_ACCESS_TOKEN?.trim() || null;
  const email = process.env.ASK_NAC_VERIFY_EMAIL?.trim() || null;
  const projectRef = process.env.SUPABASE_PROJECT_REF
    || (supabaseUrl && supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1])
    || null;
  const redirectTo = process.env.ASK_NAC_VERIFY_REDIRECT?.trim() || null;

  if (!supabaseUrl) {
    throw new Error("Missing Supabase URL. Set SUPABASE_URL or REACT_APP_SUPABASE_URL.");
  }
  if (!anonKey) {
    throw new Error("Missing anon key. Set SUPABASE_ANON_KEY or REACT_APP_SUPABASE_ANON_KEY in .env.local.");
  }
  if (!accessToken && !email) {
    throw new Error("Set ASK_NAC_ACCESS_TOKEN or ASK_NAC_VERIFY_EMAIL for scoped auth.");
  }
  if (!accessToken && !projectRef) {
    throw new Error("Set SUPABASE_PROJECT_REF or SUPABASE_URL with a valid project ref.");
  }
  if (!accessToken && !redirectTo) {
    throw new Error("Set ASK_NAC_VERIFY_REDIRECT for magic-link auth.");
  }

  return { supabaseUrl, anonKey, email, projectRef, redirectTo, accessToken };
}

function getServiceRole(projectRef) {
  const out = execSync(`supabase projects api-keys --project-ref ${projectRef} -o json`, {
    encoding: "utf8",
    cwd: REPO_ROOT,
  });
  const keys = JSON.parse(out);
  const service = keys.find((k) => k.name === "service_role" || k.id === "service_role");
  if (!service?.api_key) throw new Error("service_role key not found via Supabase CLI");
  return service.api_key;
}

async function resolveScopedUserClient(config) {
  if (config.accessToken) {
    return createClient(config.supabaseUrl, config.anonKey, {
      global: { headers: { Authorization: `Bearer ${config.accessToken}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  const serviceRole = getServiceRole(config.projectRef);
  const admin = createClient(config.supabaseUrl, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: config.email,
    options: { redirectTo: config.redirectTo },
  });
  if (error) throw error;

  const bootstrap = createClient(config.supabaseUrl, config.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: sessionData, error: verifyError } = await bootstrap.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyError) throw verifyError;

  return createClient(config.supabaseUrl, config.anonKey, {
    global: { headers: { Authorization: `Bearer ${sessionData.session.access_token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function extractDocumentSearchTerms(question = "") {
  let q = String(question || "").trim();
  q = q.replace(/^search company knowledge for\s+/i, "");
  q = q.replace(/^search uploaded documents for\s+/i, "");
  q = q.replace(/^search uploaded reports for\s+/i, "");
  q = q.replace(/^summarize (the )?(uploaded )?(document|report|logbook)\s+/i, "");
  q = q.replace(/^summarize (the )?/i, "");
  q = q.replace(/^(please\s+)?(find|search|look up|show references? to)\s+(mentions?\s+of\s+)?/i, "");
  q = q.replace(
    /\b(in uploaded (files|documents|reports)|from (the )?vault|in company knowledge|from company knowledge|in (the )?data vault)\b/gi,
    "",
  );
  return q.replace(/\?$/, "").trim();
}

const TEST_QUERIES = [
  "Search company knowledge for Google Review",
  "Find mentions of Google Review",
  "Summarize the June 14 Khobar logbook",
  "Search uploaded documents for dinner operation",
];

async function main() {
  const config = loadConfig();
  const verifyEmail = config.email || "(token auth)";

  const admin = createClient(config.supabaseUrl, getServiceRole(config.projectRef), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const user = await resolveScopedUserClient(config);

  const { data: authUser } = await user.auth.getUser();
  const jwtEmail = authUser?.user?.email;

  const { data: staffRows } = await admin
    .from("ask_nac_staff")
    .select("email, role, branch_scope, department_scope")
    .ilike("email", verifyEmail);
  const { data: menuStaff } = await admin
    .from("menu_staff_scope")
    .select("email, role, branch_id")
    .ilike("email", verifyEmail);

  const { data: allFilesAdmin } = await admin
    .from("ask_nac_files")
    .select(
      "id,original_filename,primary_branch_id,report_type,search_status,chunk_count,created_at,sensitivity_level,department,status",
    )
    .order("created_at", { ascending: false })
    .limit(20);

  const khobarLogbook = (allFilesAdmin || []).find(
    (f) =>
      /khobar/i.test(f.original_filename || "") &&
      (/june|14|logbook/i.test(f.original_filename || "") || f.report_type === "daily_logbook"),
  );

  const targetFileId = khobarLogbook?.id || allFilesAdmin?.[0]?.id;

  const { data: filesUser, error: filesUserErr } = await user
    .from("ask_nac_files")
    .select(
      "id,original_filename,primary_branch_id,report_type,search_status,chunk_count,created_at,sensitivity_level,department,status",
    )
    .order("created_at", { ascending: false })
    .limit(20);

  const { data: chunksAdmin } = await admin
    .from("ask_nac_document_chunks")
    .select("id,file_id,branch_id,chunk_text,page_no,section_label,search_vector")
    .eq("file_id", targetFileId)
    .order("chunk_index");

  const { data: chunksUser, error: chunksUserErr } = await user
    .from("ask_nac_document_chunks")
    .select("id,file_id,branch_id,chunk_text,page_no,section_label")
    .eq("file_id", targetFileId)
    .order("chunk_index");

  const { data: canReadFile } = targetFileId
    ? await user.rpc("ask_nac_vault_can_read_file", { p_file_id: targetFileId })
    : { data: null };
  const { data: vaultRole } = await user.rpc("ask_nac_vault_role");
  const { data: authEmail } = await user.rpc("ask_nac_vault_auth_email");

  const rlsChecks = [];
  if (khobarLogbook) {
    const { data: canReadScope } = await user.rpc("ask_nac_vault_can_read_scope", {
      p_branch_id: khobarLogbook.primary_branch_id,
      p_brand_wide: false,
      p_department: khobarLogbook.department,
      p_sensitivity: khobarLogbook.sensitivity_level,
    });
    rlsChecks.push({
      fileId: khobarLogbook.id,
      can_read_file: canReadFile,
      can_read_scope: canReadScope,
      branch: khobarLogbook.primary_branch_id,
      department: khobarLogbook.department,
      sensitivity: khobarLogbook.sensitivity_level,
    });
  }

  const searchResults = [];
  for (const question of TEST_QUERIES) {
    const searchTerms = extractDocumentSearchTerms(question);
    const { data, error } = await user
      .from("ask_nac_document_chunks")
      .select(
        "id,file_id,chunk_index,chunk_text,page_no,section_label,branch_id,file:ask_nac_files(id,title,original_filename,report_type,sensitivity_level)",
      )
      .textSearch("search_vector", searchTerms, { type: "websearch", config: "english" })
      .limit(20);
    searchResults.push({
      question,
      searchTerms,
      matchCount: data?.length || 0,
      error: error?.message || null,
      firstMatchExcerpt: data?.[0]?.chunk_text?.slice(0, 120) || null,
    });
  }

  let rawSql = null;
  const sampleTerms = extractDocumentSearchTerms("Find mentions of Google Review");
  try {
    const sql = `
      select c.id, c.file_id, c.branch_id, left(c.chunk_text, 200) as chunk_preview,
             c.page_no, c.section_label,
             f.original_filename, f.search_status, f.chunk_count
      from ask_nac_document_chunks c
      join ask_nac_files f on f.id = c.file_id
      where c.search_vector @@ websearch_to_tsquery('english', '${sampleTerms.replace(/'/g, "''")}')
      order by c.chunk_index
      limit 20;
    `;
    rawSql = { sql: sql.trim(), note: "Equivalent PostgREST: .textSearch('search_vector', terms, { type: 'websearch', config: 'english' })" };
  } catch (e) {
    rawSql = { error: String(e) };
  }

  const { data: sqlViaRest } = await admin
    .from("ask_nac_document_chunks")
    .select("id,file_id,branch_id,chunk_text,page_no,section_label,file:ask_nac_files(original_filename,search_status,chunk_count)")
    .textSearch("search_vector", sampleTerms, { type: "websearch", config: "english" })
    .limit(20);

  console.log(
    JSON.stringify(
      {
        user: { email: verifyEmail, jwtEmail, vaultRole, authEmailRpc: authEmail },
        staff: staffRows,
        menuStaff,
        ask_nac_files_admin: (allFilesAdmin || []).map((f) => ({
          original_filename: f.original_filename,
          branch_id: f.primary_branch_id,
          report_type: f.report_type,
          search_status: f.search_status,
          chunk_count: f.chunk_count,
          created_at: f.created_at,
          status: f.status,
          sensitivity: f.sensitivity_level,
          department: f.department,
        })),
        ask_nac_files_user_visible_count: filesUser?.length ?? 0,
        ask_nac_files_user_error: filesUserErr?.message || null,
        ask_nac_files_user: (filesUser || []).map((f) => ({
          original_filename: f.original_filename,
          branch_id: f.primary_branch_id,
          report_type: f.report_type,
          search_status: f.search_status,
          chunk_count: f.chunk_count,
          created_at: f.created_at,
        })),
        targetFileId,
        ask_nac_document_chunks_admin_count: chunksAdmin?.length ?? 0,
        ask_nac_document_chunks_admin: (chunksAdmin || []).map((c) => ({
          file_id: c.file_id,
          branch_id: c.branch_id,
          chunk_text_preview: String(c.chunk_text || "").slice(0, 200),
          page_no: c.page_no,
          section_label: c.section_label,
          search_vector_preview: String(c.search_vector || "").slice(0, 120),
        })),
        ask_nac_document_chunks_user_count: chunksUser?.length ?? 0,
        ask_nac_document_chunks_user_error: chunksUserErr?.message || null,
        ask_nac_document_chunks_user: (chunksUser || []).map((c) => ({
          file_id: c.file_id,
          branch_id: c.branch_id,
          chunk_text_preview: String(c.chunk_text || "").slice(0, 200),
          page_no: c.page_no,
          section_label: c.section_label,
        })),
        rlsChecks,
        exactSqlUsedByVaultDocumentSearch: rawSql,
        serviceRoleFtsProbe: {
          searchTerms: sampleTerms,
          matchCount: sqlViaRest?.length || 0,
          matches: (sqlViaRest || []).slice(0, 3).map((r) => ({
            file_id: r.file_id,
            branch_id: r.branch_id,
            preview: String(r.chunk_text || "").slice(0, 120),
            file: r.file,
          })),
        },
        userJwtSearchResults: searchResults,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
