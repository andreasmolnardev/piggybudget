import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadProjectConfig } from './project-config.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function checkProjectIdentity(root = projectRoot) {
  const { config } = await loadProjectConfig(root);
  const [rootPackage, webPackage, goMod, appConfig, ciConfig, devCompose, dockerfile] = await Promise.all([
    fs.readFile(path.join(root, 'package.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(root, 'apps/web/package.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(root, 'go.mod'), 'utf8'),
    fs.readFile(path.join(root, 'apps/server/internal/app/config.go'), 'utf8'),
    fs.readFile(path.join(root, '.github/workflows/ci.yml'), 'utf8'),
    fs.readFile(path.join(root, 'docker-compose.dev.yaml'), 'utf8'),
    fs.readFile(path.join(root, 'Dockerfile'), 'utf8'),
  ]);

  const expectedWebName = `@${config.app.name}/web`;
  if (rootPackage.name !== config.app.name) {
    throw new Error(`package.json name must match app.name (${config.app.name})`);
  }
  if (webPackage.name !== expectedWebName) {
    throw new Error(`apps/web/package.json name must be ${expectedWebName}`);
  }
  const goModule = goMod.match(/^module\s+([^\s]+)\s*$/m)?.[1];
  if (goModule !== config.app.goModule) {
    throw new Error(`go.mod module must match app.goModule (${config.app.goModule})`);
  }
  if (!appConfig.includes(`${config.app.envPrefix}_`) || config.app.envPrefix !== 'PIGGYBUDGET') {
    throw new Error('app.envPrefix must remain PIGGYBUDGET for the current runtime contract');
  }
  if (rootPackage.packageManager !== `pnpm@${config.tools.pnpm}`) {
    throw new Error(`package.json packageManager must match tools.pnpm (${config.tools.pnpm})`);
  }
  if (!rootPackage.scripts['dev:server']?.includes(`air@v${config.tools.air}`)) {
    throw new Error(`dev:server must use the pinned air version ${config.tools.air}`);
  }
  for (const [label, value] of [
    ['Go', config.tools.go],
    ['Node', config.tools.node],
    ['pnpm', config.tools.pnpm],
  ]) {
    if (!ciConfig.includes(value)) throw new Error(`CI workflow must pin ${label} ${value}`);
  }
  if (!devCompose.includes(`golang:${config.tools.go}-alpine3.24`)
    || !devCompose.includes(`node:${config.tools.node}-alpine3.24`)
    || !devCompose.includes(`air@v${config.tools.air}`)) {
    throw new Error('docker-compose.dev.yaml must use the tool versions declared in slopstack.yaml');
  }
  if (!dockerfile.includes(`FROM node:${config.tools.node}-alpine3.24 AS web-build`)
    || !dockerfile.includes(`FROM golang:${config.tools.go}-alpine3.24 AS server-build`)
    || !dockerfile.includes('FROM alpine:3.24.2')) {
    throw new Error('Dockerfile base images must use the pinned versions validated for Piggybudget');
  }
  return config;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const config = await checkProjectIdentity();
    console.log(`slopstack.yaml is valid for ${config.app.name}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
