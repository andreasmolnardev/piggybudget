import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildDeployCommand } from './deploy.js';
import { parseConfigYaml, validateProjectConfig } from './project-config.js';
import { planRelease } from './release.js';

const projectRoot = path.resolve(import.meta.dirname, '..');

test('project config validates Piggybudget identity and deployment defaults', async () => {
  const source = await fs.readFile(path.join(projectRoot, 'slopstack.yaml'), 'utf8');
  const config = validateProjectConfig(parseConfigYaml(source));
  assert.equal(config.app.name, 'piggybudget');
  assert.equal(config.app.goModule, 'github.com/piggybudget/piggybudget');
  assert.equal(config.app.envPrefix, 'PIGGYBUDGET');
  assert.equal(config.runtime.storagePath, 'pb_data');
  assert.equal(config.image.platforms, 'linux/amd64,linux/arm64');
});

test('project config rejects credentials and unsupported schema versions', () => {
  const base = {
    schemaVersion: 1,
    app: { name: 'app', goModule: 'example.com/app', envPrefix: 'APP' },
    runtime: { port: 8090, storagePath: 'pb_data' },
    development: { webPort: 5173, apiProxyTarget: 'http://127.0.0.1:8090' },
    tools: { go: '1.27.1', node: '22.23.2', pnpm: '11.8.0', air: '1.67.4', dockerBuildx: '0.30.0' },
    image: { repository: 'ghcr.io/example/app', tag: 'latest', platforms: 'linux/amd64,linux/arm64' },
    registry: { host: 'ghcr.io' },
    release: { version: '1.2.3' },
  };
  assert.throws(() => validateProjectConfig({ ...base, schemaVersion: 2 }), /schemaVersion/);
  assert.throws(() => validateProjectConfig({ ...base, registry: { host: 'ghcr.io', token: 'secret' } }), /must not store credentials/);
});

test('deploy plan builds from the app checkout using configured platforms', () => {
  const command = buildDeployCommand({
    image: { platforms: 'linux/amd64,linux/arm64', repository: 'ghcr.io/example/piggybudget', tag: 'latest' },
  });
  assert.equal(command.args.includes('--build-context'), false);
  assert.ok(command.args.includes('--platform'));
  assert.ok(command.args.includes('--push'));
  assert.equal(command.args.at(-1), '.');
});

test('release preparation is a plan and leaves the app config unchanged', async () => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'piggybudget-release-test-'));
  try {
    await fs.copyFile(path.join(projectRoot, 'slopstack.yaml'), path.join(fixture, 'slopstack.yaml'));
    const before = await fs.readFile(path.join(fixture, 'slopstack.yaml'), 'utf8');
    const plan = await planRelease(fixture, '1.2.3');
    assert.equal(plan.targetVersion, '1.2.3');
    assert.match(plan.nextSource, /tag: "1\.2\.3"/);
    assert.equal(await fs.readFile(plan.configPath, 'utf8'), before);
  } finally {
    await fs.rm(fixture, { recursive: true, force: true });
  }
});
