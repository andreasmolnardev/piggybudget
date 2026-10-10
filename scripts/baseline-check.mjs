// Compares the current source tree against docs/baseline.json.
//
// Phase 0 of the migration: this reports drift rather than blocking on it. Set
// BASELINE_STRICT=1 to fail the job on any difference, which is what you want
// once the migration is finished and the surface should be frozen.
//
// What it compares:
//   - collection names declared in the Go source (not ids, which PocketBase
//     generates at creation time and which cannot be derived from source)
//   - the HTTP route surface registered via e.Router.* / event.Router.*
//   - the web module graph reachable from apps/web/src/main.tsx
//
// What it cannot compare:
//   - access rules and field lists without booting PocketBase, because those live
//     in pb_data, not in source
//   - collection ids, for the same reason
//
// Usage:
//   node scripts/baseline-check.mjs           report, exit 0
//   BASELINE_STRICT=1 node scripts/baseline-check.mjs   report, exit 1 on drift

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const baselinePath = join(repoRoot, 'docs', 'baseline.json');
const strict = process.env.BASELINE_STRICT === '1';

const read = (path) => readFileSync(path, 'utf8');
const failures = [];

function listFiles(dir, ext, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) listFiles(full, ext, out);
    else if (full.endsWith(ext)) out.push(full);
  }
  return out;
}

// --- collections declared in Go source -------------------------------------
// Each Ensure* function contains one or more NewBaseCollection(name) /
// NewAuthCollection(name) calls, plus the struct-literal name fields that name a
// collection without constructing it. Matching on both catches the definitions
// that are built from tables (schema.go, finance_schema.go, asset_groups.go).
function collectionsFromSource() {
  const appDir = join(repoRoot, 'apps', 'server', 'internal', 'app');
  const found = new Set();

  for (const file of listFiles(appDir, '.go')) {
    if (file.endsWith('_test.go')) continue;
    const src = read(file);

    for (const m of src.matchAll(/New(?:Base|Auth)Collection\(\s*"([^"]+)"/g)) {
      found.add(m[1]);
    }
    // Struct-literal table entries: {"name", false, ...} or name: "x",
    for (const m of src.matchAll(/\{"([a-z_]+)",\s*(?:true|false),/g)) {
      found.add(m[1]);
    }
    for (const m of src.matchAll(/^\s*name:\s*"([a-z_]+)",\s*$/gm)) {
      found.add(m[1]);
    }
    // Schema table row keyed by the Go field name, e.g.
    // {"users", true, []map[string]any{...}}
    for (const m of src.matchAll(/\{"([a-z_]+)",\s*(?:true|false),\s*\[\]map\[string\]any/g)) {
      found.add(m[1]);
    }
    for (const m of src.matchAll(/name:\s*"([a-z_]+)",\s*fields:/g)) {
      found.add(m[1]);
    }
    // Collections named via a package-level const, e.g.
    // const calDAVChangeCollection = "caldav_changes"
    for (const m of src.matchAll(/Collection\s*=\s*"([a-z_]+)"/g)) {
      found.add(m[1]);
    }
    for (const m of src.matchAll(/collection\s*=\s*"([a-z_]+)"/g)) {
      found.add(m[1]);
    }
  }

  // names that are field names, not collections, picked up by the loose patterns
  const notCollections = new Set(['name', 'name2']);
  return [...found].filter((n) => !notCollections.has(n)).sort();
}

// --- HTTP routes registered in Go source ------------------------------------
const PREFIXES = ['/api/finance', '/api'];
const FINANCE_COLLECTIONS = ['accounts', 'transactions', 'checkpoints', 'budgets', 'assets', 'goals'];
const ASSET_GROUP_RESOURCES = ['asset-groups', 'asset-positions'];

function routesFromSource() {
  const appDir = join(repoRoot, 'apps', 'server', 'internal', 'app');
  const routes = new Set();

  for (const file of listFiles(appDir, '.go')) {
    if (file.endsWith('_test.go')) continue;
    const src = read(file);
    const rel = relative(repoRoot, file);

    // literal routes. PocketBase's `Any` is normalised to `ANY` so it compares
    // against the method casing used in docs/baseline.json.
    for (const m of src.matchAll(/e\.Router\.(GET|POST|PUT|PATCH|DELETE|Any)\("([^"]+)"/g)) {
      routes.add(`${m[1].toUpperCase()} ${m[2]}`);
    }
    for (const m of src.matchAll(/event\.Router\.(GET|POST|PUT|PATCH|DELETE|Any)\("([^"]+)"/g)) {
      routes.add(`${m[1].toUpperCase()} ${m[2]}`);
    }

    // finance dual-prefix CRUD loop
    if (rel.endsWith('finance.go')) {
      for (const prefix of PREFIXES) {
        for (const collection of FINANCE_COLLECTIONS) {
          const base = `${prefix}/${collection}`;
          for (const [method, suffix] of [
            ['GET', ''], ['POST', ''], ['GET', '/{id}'],
            ['PATCH', '/{id}'], ['PUT', '/{id}'], ['DELETE', '/{id}'],
          ]) {
            routes.add(`${method} ${base}${suffix}`);
          }
        }
        routes.add(`GET ${prefix}/accounts/{id}/summary`);
        routes.add(`POST ${prefix}/accounts/{id}/reconcile`);
      }
    }

    // asset group dual-prefix CRUD loop
    if (rel.endsWith('asset_groups.go')) {
      for (const prefix of PREFIXES) {
        for (const resource of ASSET_GROUP_RESOURCES) {
          const base = `${prefix}/${resource}`;
          for (const [method, suffix] of [
            ['GET', ''], ['POST', ''], ['GET', '/{id}'],
            ['PATCH', '/{id}'], ['PUT', '/{id}'], ['DELETE', '/{id}'],
          ]) {
            routes.add(`${method} ${base}${suffix}`);
          }
        }
        routes.add(`PATCH ${prefix}/assets/{id}/group`);
        routes.add(`PUT ${prefix}/assets/{id}/group`);
      }
    }
  }

  return [...routes].sort();
}

// --- web module graph reachable from the production entrypoint -------------
function webReachability() {
  const srcRoot = join(repoRoot, 'apps', 'web', 'src');
  const files = listFiles(srcRoot, '.ts').concat(listFiles(srcRoot, '.tsx'));
  const fileSet = new Set(files.map((f) => resolve(f)));

  const resolveSpecifier = (specifier, from) => {
    let base;
    if (specifier.startsWith('.')) base = resolve(dirname(from), specifier);
    else if (specifier.startsWith('@/')) base = join(srcRoot, specifier.slice(2));
    else return null;
    const candidates = [
      `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx'),
    ];
    return candidates.find((c) => fileSet.has(resolve(c))) ?? null;
  };

  const isTest = (f) => /\.(test|spec)\.[tj]sx?$/.test(f);
  const entry = resolve(join(srcRoot, 'main.tsx'));
  const reachable = new Set();
  const queue = [entry];

  while (queue.length) {
    const file = queue.pop();
    if (reachable.has(file)) continue;
    reachable.add(file);
    const src = read(file);
    for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const next = resolveSpecifier(m[1], file);
      if (next) queue.push(next);
    }
  }

  const unreachable = files
    .filter((f) => !isTest(f) && !reachable.has(resolve(f)))
    .map((f) => relative(repoRoot, f).replace(/\\/g, '/'))
    .sort();

  return { reachableCount: reachable.size, unreachable };
}

// --- diff ------------------------------------------------------------------
function diffSets(label, expected, actual) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const added = actual.filter((v) => !expectedSet.has(v));
  const removed = expected.filter((v) => !actualSet.has(v));
  return { label, added, removed, unchanged: added.length === 0 && removed.length === 0 };
}

const baseline = JSON.parse(read(baselinePath));

const actualRoutes = routesFromSource();
const routeDiff = diffSets(
  'routes',
  baseline.routes.map((r) => `${r.method} ${r.path}`),
  actualRoutes,
);

const collectionDiff = diffSets(
  'collections',
  baseline.collections.map((c) => c.name),
  collectionsFromSource(),
);

const reach = webReachability();

// baseline.json records these paths relative to apps/web/src; the walk produces
// repo-relative paths. Normalise both to repo-relative so the sets are comparable.
const toRepoRelative = (p) => (p.startsWith('apps/web/src/') ? p : `apps/web/src/${p}`);
// baseline entries may be a directory ("api/generated/ (16 files)"), so match
// either exactly or as a path prefix.
const expectedUnreachable = new Set(
  baseline.inherited_unused_taskboard.web_files_unreachable_from_main_tsx.map(toRepoRelative),
);
const isExpected = (f) => {
  for (const entry of expectedUnreachable) {
    const dir = entry.replace(/\s*\(.*\)\s*$/, '').replace(/\/$/, '');
    if (f === entry || f.startsWith(`${dir}/`)) return true;
  }
  return false;
};
const stillUnreachable = reach.unreachable.filter(isExpected);
// components/ui/* is a vendored shadcn library that baseline.json does not track.
// Reported, but not treated as migration drift.
const untrackedUnreachable = reach.unreachable.filter(
  (f) => !isExpected(f) && f.startsWith('apps/web/src/components/ui/'),
);
const newlyUnreachable = reach.unreachable.filter(
  (f) => !isExpected(f) && !f.startsWith('apps/web/src/components/ui/'),
);

const report = {
  checked_at: new Date().toISOString(),
  baseline_git_commit: baseline.git_commit,
  strict,
  routes: { ...routeDiff, count: actualRoutes.length, baseline_count: baseline.routes.length },
  collections: {
    ...collectionDiff,
    count: collectionDiff.added.length + collectionDiff.unchanged + collectionDiff.removed,
  },
  web_reachability: {
    reachable_modules: reach.reachableCount,
    baseline_expected_unreachable: [...expectedUnreachable].sort(),
    still_unreachable: stillUnreachable.sort(),
    newly_unreachable: newlyUnreachable.sort(),
    untracked_vendored: untrackedUnreachable.sort(),
    note: 'newly_unreachable = modules no longer imported by anything that baseline.json does not already list as dead; a strong signal of newly orphaned code. untracked_vendored = components/ui/* shadcn primitives, a vendored library that baseline.json deliberately does not track.',
  },
};

if (!routeDiff.unchanged) failures.push('routes');
if (!collectionDiff.unchanged) failures.push('collections');
if (newlyUnreachable.length) failures.push('web reachability');

writeFileSync(join(repoRoot, 'baseline-report.json'), `${JSON.stringify(report, null, 2)}\n`);

const lines = [];
lines.push('# Baseline drift report', '');
lines.push(`- checked: ${report.checked_at}`);
lines.push(`- baseline commit: ${report.baseline_git_commit}`);
lines.push(`- routes: ${actualRoutes.length} registered now, ${baseline.routes.length} in baseline`);
lines.push(`- collections: ${collectionDiff.added.length + collectionDiff.removed.length} changed`);
lines.push(`- web reachable modules: ${reach.reachableCount}`);
lines.push(`- web newly unreachable: ${newlyUnreachable.length} (vendored ui primitives excluded: ${untrackedUnreachable.length})`);
if (failures.length) lines.push(`- DRIFT: ${failures.join(', ')}`);
else lines.push('- no drift');
for (const d of [routeDiff, collectionDiff]) {
  if (d.added.length) lines.push('', `## Added ${d.label}`, '', ...d.added.map((v) => `- \`${v}\``));
  if (d.removed.length) lines.push('', `## Removed ${d.label}`, '', ...d.removed.map((v) => `- \`${v}\``));
}
if (newlyUnreachable.length) {
  lines.push('', '## Newly unreachable web modules', '', ...newlyUnreachable.map((v) => `- \`${v}\``));
}
writeFileSync(join(repoRoot, 'baseline-report.md'), `${lines.join('\n')}\n`);

if (failures.length) {
  console.error(`baseline drift in: ${failures.join(', ')}`);
  console.error('see baseline-report.md');
  if (strict) process.exit(1);
} else {
  console.log('no drift from docs/baseline.json');
}

if (!existsSync(join(repoRoot, 'docs', 'baseline.json'))) {
  console.error('docs/baseline.json missing');
  process.exit(1);
}