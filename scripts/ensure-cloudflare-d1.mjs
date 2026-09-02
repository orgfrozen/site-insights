import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CLOUDFLARE_API_BASE_URL = 'https://api.cloudflare.com/client/v4';
const DEFAULT_DATABASE_NAME = 'site-insights';
const DEFAULT_CONFIG_PATH = 'wrangler.jsonc';
const DEFAULT_OUTPUT_PATH = 'wrangler.deploy.jsonc';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function apiErrorMessage(payload, status) {
  const messages = Array.isArray(payload?.errors)
    ? payload.errors.map((entry) => entry?.message).filter(Boolean)
    : [];
  return messages.length > 0
    ? messages.join('; ')
    : `Cloudflare API request failed with HTTP ${status}`;
}

async function readJsonResponse(response) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Cloudflare API returned non-JSON HTTP ${response.status}`);
  }
  return payload;
}

async function listD1Databases({ accountId, apiToken, databaseName, fetchImpl }) {
  const url = new URL(`${CLOUDFLARE_API_BASE_URL}/accounts/${encodeURIComponent(accountId)}/d1/database`);
  url.searchParams.set('name', databaseName);
  url.searchParams.set('per_page', '100');

  const response = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      Accept: 'application/json',
    },
  });
  const payload = await readJsonResponse(response);
  if (!response.ok || payload?.success !== true || !Array.isArray(payload?.result)) {
    throw new Error(apiErrorMessage(payload, response.status));
  }

  return payload.result.filter((database) => database?.name === databaseName);
}

function normalizeDatabase(database, created) {
  const uuid = String(database?.uuid ?? '').trim();
  const name = String(database?.name ?? '').trim();
  if (!UUID_PATTERN.test(uuid)) {
    throw new Error('Cloudflare D1 response did not include a valid database UUID');
  }
  if (!name) {
    throw new Error('Cloudflare D1 response did not include a database name');
  }
  return { uuid, name, created };
}

async function createD1Database({ accountId, apiToken, databaseName, fetchImpl }) {
  const response = await fetchImpl(
    `${CLOUDFLARE_API_BASE_URL}/accounts/${encodeURIComponent(accountId)}/d1/database`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: databaseName }),
    },
  );
  const payload = await readJsonResponse(response);
  if (!response.ok || payload?.success !== true || !payload?.result) {
    throw new Error(apiErrorMessage(payload, response.status));
  }
  return normalizeDatabase(payload.result, true);
}

export async function ensureD1Database({
  accountId,
  apiToken,
  databaseName = DEFAULT_DATABASE_NAME,
  fetchImpl = globalThis.fetch,
}) {
  if (!accountId) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID is required');
  }
  if (!apiToken) {
    throw new Error('CLOUDFLARE_API_TOKEN is required');
  }
  if (!databaseName) {
    throw new Error('D1 database name is required');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required');
  }

  const existing = await listD1Databases({ accountId, apiToken, databaseName, fetchImpl });
  if (existing.length > 1) {
    throw new Error(`Multiple D1 databases named ${databaseName} were returned; refusing to choose one`);
  }
  if (existing.length === 1) {
    return normalizeDatabase(existing[0], false);
  }

  try {
    return await createD1Database({ accountId, apiToken, databaseName, fetchImpl });
  } catch (createError) {
    // A concurrent bootstrap can win the create race after our initial list.
    const reconciled = await listD1Databases({ accountId, apiToken, databaseName, fetchImpl });
    if (reconciled.length === 1) {
      return normalizeDatabase(reconciled[0], false);
    }
    throw createError;
  }
}

export function renderDeployConfig({ source, databaseName = DEFAULT_DATABASE_NAME, databaseId }) {
  if (typeof source !== 'string' || source.length === 0) {
    throw new Error('Wrangler config source is required');
  }
  if (!UUID_PATTERN.test(String(databaseId ?? ''))) {
    throw new Error('A valid D1 database UUID is required to render the deploy config');
  }

  const escapedName = databaseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const namePattern = new RegExp(`"database_name"\\s*:\\s*"${escapedName}"`, 'g');
  const matches = [...source.matchAll(namePattern)];
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one D1 binding for database_name=${databaseName}, found ${matches.length}`);
  }

  const nameIndex = matches[0].index;
  const objectStart = source.lastIndexOf('{', nameIndex);
  const objectEnd = source.indexOf('}', nameIndex);
  if (objectStart < 0 || objectEnd < 0) {
    throw new Error(`Unable to locate D1 binding object for ${databaseName}`);
  }

  const objectSource = source.slice(objectStart, objectEnd + 1);
  const databaseIdPattern = /("database_id"\s*:\s*")[^"]+("\s*[,}])/g;
  const idMatches = [...objectSource.matchAll(databaseIdPattern)];
  if (idMatches.length !== 1) {
    throw new Error(`Expected exactly one database_id in the ${databaseName} D1 binding`);
  }

  const renderedObject = objectSource.replace(databaseIdPattern, `$1${databaseId}$2`);
  return `${source.slice(0, objectStart)}${renderedObject}${source.slice(objectEnd + 1)}`;
}

function parseArgs(argv) {
  const values = {
    databaseName: DEFAULT_DATABASE_NAME,
    configPath: DEFAULT_CONFIG_PATH,
    outputPath: DEFAULT_OUTPUT_PATH,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = argv[index + 1];
    if (argument === '--database-name' && next) {
      values.databaseName = next;
      index += 1;
    } else if (argument === '--config' && next) {
      values.configPath = next;
      index += 1;
    } else if (argument === '--output' && next) {
      values.outputPath = next;
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
  }

  return values;
}

async function appendGitHubOutput(values) {
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (!githubOutput) return;
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n');
  await writeFile(githubOutput, `${lines}\n`, { flag: 'a' });
}

export async function main(argv = process.argv.slice(2)) {
  const { databaseName, configPath, outputPath } = parseArgs(argv);
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();

  const database = await ensureD1Database({ accountId, apiToken, databaseName });
  const source = await readFile(resolve(configPath), 'utf8');
  const rendered = renderDeployConfig({
    source,
    databaseName,
    databaseId: database.uuid,
  });

  const resolvedOutput = resolve(outputPath);
  await mkdir(dirname(resolvedOutput), { recursive: true });
  await writeFile(resolvedOutput, rendered, 'utf8');
  await appendGitHubOutput({
    database_id: database.uuid,
    database_created: String(database.created),
    deploy_config: outputPath,
  });

  const disposition = database.created ? 'created' : 'reused';
  console.log(`D1 database ready: ${database.name} (${database.uuid}) [${disposition}]`);
  console.log(`Rendered deploy config: ${outputPath}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
