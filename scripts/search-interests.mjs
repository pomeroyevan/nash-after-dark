// Private bridge between the owner's synced search list and the daily research job.
// The only network target is the existing project's official Management API.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_REF = 'yoawbugctcghmaaeloqn';
export const API_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;
export const INBOX_PATH = 'private/search-inbox.json';
const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const KINDS = ['anything', 'artist', 'venue', 'event_series', 'activity', 'organizer'];
const STATUSES = ['active', 'needs_details', 'blocked'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new Error(message); };
const text = (value, max, required = false) => typeof value === 'string' && value.length <= max && !value.includes('\0') && (!required || value.trim().length > 0);
const id = value => text(value, 160, true) && /^[a-zA-Z0-9][a-zA-Z0-9:_-]*$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
const referenceId = value => text(value, 160, true) && !/[\u0000-\u001f\u007f]/.test(value);
const timestamp = value => typeof value === 'string' && value.length <= 40 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const url = value => {
  if (value === '') return true;
  if (!text(value, 2048)) return false;
  try { const parsed = new URL(value); return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password; }
  catch { return false; }
};
const onlyKeys = (value, keys) => Object.keys(value).every(key => keys.includes(key));

export function validateResult(value) {
  if (!object(value) || !onlyKeys(value, ['inputUpdatedAt', 'status', 'checkedAt', 'message', 'catalogIds', 'eventIds']) ||
      !timestamp(value.inputUpdatedAt) || !STATUSES.includes(value.status) || !timestamp(value.checkedAt) ||
      !text(value.message, 1000, true) || ['catalogIds', 'eventIds'].some(key => !Array.isArray(value[key]) || value[key].length > 100 || !value[key].every(referenceId))) {
    fail('Invalid search result. Use the documented result fields, timestamps and limits.');
  }
  return {
    inputUpdatedAt: value.inputUpdatedAt, status: value.status, checkedAt: value.checkedAt,
    message: value.message, catalogIds: [...new Set(value.catalogIds)], eventIds: [...new Set(value.eventIds)],
  };
}

export function validateInterests(value) {
  if (value === undefined || value === null) return {};
  if (!object(value) || Object.keys(value).length > 500) fail('The private search list is malformed or exceeds its limit.');
  const clean = {};
  for (const [key, item] of Object.entries(value)) {
    if (!id(key) || !object(item) || item.id !== key || !text(item.name, 200, true) || !KINDS.includes(item.kind) ||
        !url(item.sourceUrl) || !text(item.notes, 2000) || typeof item.enabled !== 'boolean' ||
        !timestamp(item.createdAt) || !timestamp(item.updatedAt)) {
      fail('The private search list contains an invalid record. Repair it in the app before running research.');
    }
    clean[key] = {
      id: item.id, name: item.name, kind: item.kind, sourceUrl: item.sourceUrl, notes: item.notes,
      enabled: item.enabled, createdAt: item.createdAt, updatedAt: item.updatedAt,
      ...(item.result === undefined ? {} : { result: validateResult(item.result) }),
    };
  }
  return clean;
}

export function validatePatch(value) {
  if (!object(value) || !onlyKeys(value, ['id', 'expectedUpdatedAt', 'result']) || !id(value.id) || !timestamp(value.expectedUpdatedAt)) {
    fail('Invalid result patch. Expected id, expectedUpdatedAt and result.');
  }
  const result = validateResult(value.result);
  if (result.inputUpdatedAt !== value.expectedUpdatedAt) fail('Result inputUpdatedAt must match expectedUpdatedAt.');
  return { id: value.id, expectedUpdatedAt: value.expectedUpdatedAt, result };
}

// Matching the private seed identifies the intended owner without a public email.
// Synthetic QA accounts may retain seed rows, so they are never eligible here.
const eligibleOwner = `eligible_owner as (
  select s.user_id, s.revision, s.payload
  from public.nash_private_state s
  join auth.users u on u.id = s.user_id
  join nash_private.owner_seed seed on seed.email = pg_catalog.lower(pg_catalog.btrim(u.email))
  where u.email_confirmed_at is not null
    and (u.banned_until is null or u.banned_until <= now())
    and coalesce(u.raw_user_meta_data->>'purpose', '') <> 'temporary_nash_sync_verification'
)`;

export const READ_QUERY = `with ${eligibleOwner}
select revision, payload->'searchInterests' as search_interests
from eligible_owner;`;

// E strings escape both slashes and quotes independently of PostgreSQL settings.
const sqlLiteral = value => `E'${value.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`;

export function buildApplyQuery(revision, patchValue) {
  if (!Number.isSafeInteger(revision) || revision < 1) fail('Invalid private account revision.');
  const patch = validatePatch(patchValue);
  const key = sqlLiteral(patch.id), updatedAt = sqlLiteral(patch.expectedUpdatedAt);
  const result = sqlLiteral(JSON.stringify(patch.result));
  const nextPayload = `pg_catalog.jsonb_set(s.payload, array['searchInterests', ${key}, 'result'], ${result}::jsonb, true)`;
  return `with ${eligibleOwner}, changed as (
  update public.nash_private_state s
  set payload = ${nextPayload},
      revision = s.revision + 1, updated_at = clock_timestamp()
  from eligible_owner owner
  where (select count(*) from eligible_owner) = 1
    and s.user_id = owner.user_id and s.revision = ${revision}
    and pg_catalog.jsonb_typeof(s.payload->'searchInterests'->${key}) = 'object'
    and s.payload->'searchInterests'->${key}->'enabled' = 'true'::jsonb
    and s.payload->'searchInterests'->${key}->>'updatedAt' = ${updatedAt}
    and pg_catalog.octet_length((${nextPayload})::text) <= 5242880
  returning s.revision
)
select revision from changed;`;
}

export function createManagementClient({ token = process.env.SUPABASE_ACCESS_TOKEN, fetchImpl = fetch } = {}) {
  if (!text(token, 4096, true)) fail('Inject SUPABASE_ACCESS_TOKEN from the local API Key Vault.');
  return async (query, { readOnly = true } = {}) => {
    let response;
    try {
      response = await fetchImpl(API_URL, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, ...(readOnly ? { read_only: true } : {}) }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch { fail('Private search connection failed. No automatic write retry was attempted.'); }
    // Response bodies can contain SQL or private data; never put them in logs.
    if (!response.ok) fail(`Private search API request failed (HTTP ${response.status}).`);
    let rows;
    try { rows = await response.json(); } catch { fail('Private search API returned unreadable data.'); }
    if (!Array.isArray(rows)) fail('Private search API returned an unexpected response.');
    return rows;
  };
}

export async function pullInterests({ query, now = () => new Date().toISOString() }) {
  const rows = await query(READ_QUERY, { readOnly: true });
  if (rows.length === 0) fail('No confirmed, active owner account is available. Sign in and confirm the owner email first.');
  if (rows.length !== 1) fail('More than one eligible owner account exists. No private inbox was selected.');
  if (!Number.isSafeInteger(rows[0].revision) || rows[0].revision < 1) fail('Invalid private account revision.');
  const pulledAt = now();
  if (!timestamp(pulledAt)) fail('Invalid research check time.');
  return { version: 1, pulledAt, revision: rows[0].revision, searchInterests: validateInterests(rows[0].search_interests) };
}

export async function applyResult({ query, patch: value, dryRun = false }) {
  const patch = validatePatch(value);
  const inbox = await pullInterests({ query });
  const current = inbox.searchInterests[patch.id];
  if (!current || !current.enabled) fail('This search was removed or paused. Nothing was changed.');
  if (current.updatedAt !== patch.expectedUpdatedAt) fail('This search was edited after research began. Pull it again; nothing was changed.');
  if (current.result?.inputUpdatedAt === current.updatedAt && Date.parse(current.result.checkedAt) > Date.parse(patch.result.checkedAt)) {
    fail('A newer result already exists. Nothing was changed.');
  }
  if (JSON.stringify(current.result) === JSON.stringify(patch.result)) return { applied: false, unchanged: true, revision: inbox.revision };
  if (dryRun) return { applied: false, dryRun: true, revision: inbox.revision };
  const rows = await query(buildApplyQuery(inbox.revision, patch), { readOnly: false });
  if (rows.length !== 1 || rows[0].revision !== inbox.revision + 1) {
    fail('The private account changed or its backup size limit was reached. Pull again and review; nothing was replaced.');
  }
  return { applied: true, revision: rows[0].revision };
}

export function parseArgs(args) {
  if (args.length === 0 || args[0] === '--help' || args[0] === 'help') return { command: 'help' };
  const [command, ...flags] = args;
  if (!['pull', 'apply'].includes(command)) fail('Use pull or apply. See --help.');
  let dryRun = false, file;
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === '--dry-run' && !dryRun) dryRun = true;
    else if (flags[i] === '--file' && !file && flags[i + 1] && !flags[i + 1].startsWith('--')) file = flags[++i];
    else fail('Unknown, incomplete or duplicate option. See --help.');
  }
  if (command === 'apply' && !file) fail('apply requires --file with a private result patch.');
  if (command === 'pull' && file) fail('pull always writes only private/search-inbox.json.');
  return { command, dryRun, file };
}

export async function runCli(args, { cwd = REPO_ROOT, query, log = console.log, fs = { mkdir, readFile, writeFile } } = {}) {
  const options = parseArgs(args);
  if (options.command === 'help') {
    log('Private search bridge\n  node scripts/search-interests.mjs pull [--dry-run]\n  node scripts/search-interests.mjs apply --file private/search-result.json [--dry-run]\nRequires SUPABASE_ACCESS_TOKEN injected from the local vault. See docs/SEARCH-INTERESTS.md.');
    return;
  }
  query ||= createManagementClient();
  if (options.command === 'pull') {
    const inbox = await pullInterests({ query });
    const items = Object.values(inbox.searchInterests);
    if (!options.dryRun) {
      await fs.mkdir(resolve(cwd, 'private'), { recursive: true });
      await fs.writeFile(resolve(cwd, INBOX_PATH), `${JSON.stringify(inbox, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    }
    log(`${options.dryRun ? 'Dry run: read' : 'Saved private inbox with'} ${items.length} searches; ${items.filter(item => item.enabled).length} enabled. No public files changed.`);
    return;
  }
  let patch;
  try { patch = JSON.parse(await fs.readFile(resolve(cwd, options.file), 'utf8')); }
  catch { fail('Could not read the private result patch JSON.'); }
  const result = await applyResult({ query, patch, dryRun: options.dryRun });
  log(result.dryRun ? 'Dry run: result is valid and current. No writes performed.' : result.unchanged ? 'Result is already current. No writes performed.' : 'Updated one private search result. No public files changed.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).catch(error => {
    // All operational errors are deliberately free of server bodies and records.
    console.error(error instanceof Error ? error.message : 'Private search operation failed.');
    process.exitCode = 1;
  });
}
