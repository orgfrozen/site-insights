import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ensureD1Database,
  renderDeployConfig,
} from './ensure-cloudflare-d1.mjs';

const DATABASE_ID = '11111111-2222-3333-4444-555555555555';
const CREATED_DATABASE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('reuses an existing D1 database without creating another one', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method ?? 'GET', body: options.body });
    return jsonResponse({
      success: true,
      result: [{ uuid: DATABASE_ID, name: 'site-insights' }],
    });
  };

  const database = await ensureD1Database({
    accountId: 'account-id',
    apiToken: 'secret-token',
    databaseName: 'site-insights',
    fetchImpl,
  });

  assert.equal(database.uuid, DATABASE_ID);
  assert.equal(database.created, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.match(calls[0].url, /\/accounts\/account-id\/d1\/database\?/);
  assert.match(calls[0].url, /name=site-insights/);
});

test('creates D1 only when the named database does not exist', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method ?? 'GET', body: options.body });
    if ((options.method ?? 'GET') === 'GET') {
      return jsonResponse({ success: true, result: [] });
    }
    return jsonResponse({
      success: true,
      result: { uuid: CREATED_DATABASE_ID, name: 'site-insights' },
    });
  };

  const database = await ensureD1Database({
    accountId: 'account-id',
    apiToken: 'secret-token',
    databaseName: 'site-insights',
    fetchImpl,
  });

  assert.deepEqual(database, {
    uuid: CREATED_DATABASE_ID,
    name: 'site-insights',
    created: true,
  });
  assert.deepEqual(calls.map((call) => call.method), ['GET', 'POST']);
  assert.deepEqual(JSON.parse(calls[1].body), { name: 'site-insights' });
});

test('renders a temporary deploy config without changing the committed placeholder', () => {
  const source = `{
    "name": "site-insights",
    "d1_databases": [
      {
        "binding": "DB",
        "database_name": "site-insights",
        "database_id": "00000000-0000-0000-0000-000000000000",
        "migrations_dir": "migrations"
      }
    ]
  }`;

  const rendered = renderDeployConfig({
    source,
    databaseName: 'site-insights',
    databaseId: DATABASE_ID,
  });

  assert.match(rendered, new RegExp(DATABASE_ID));
  assert.doesNotMatch(rendered, /00000000-0000-0000-0000-000000000000/);
  assert.match(source, /00000000-0000-0000-0000-000000000000/);
});

test('GitHub deployment ensures D1 before migrations and Worker deploy', async () => {
  const workflow = await readFile(new URL('../.github/workflows/deploy-cloudflare.yml', import.meta.url), 'utf8');
  const ensureIndex = workflow.indexOf('node scripts/ensure-cloudflare-d1.mjs');
  const migrateIndex = workflow.indexOf('wrangler d1 migrations apply');
  const deployIndex = workflow.indexOf('wrangler deploy');

  assert.ok(ensureIndex >= 0, 'workflow must ensure the D1 database');
  assert.ok(migrateIndex > ensureIndex, 'migrations must run after D1 ensure');
  assert.ok(deployIndex > migrateIndex, 'Worker deploy must run after migrations');
  assert.match(workflow, /CLOUDFLARE_ACCOUNT_ID/);
  assert.match(workflow, /CLOUDFLARE_API_TOKEN/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm test/);
});
