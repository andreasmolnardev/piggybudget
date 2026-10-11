#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadProjectConfig } from './project-config.js';

export function buildDeployCommand(config, { exportPath } = {}) {
  const command = {
    command: 'docker',
    args: [
      'buildx', 'build',
      '--platform', config.image.platforms.split(',').map((part) => part.trim()).join(','),
      '--tag', `${config.image.repository}:${config.image.tag}`,
    ],
  };
  if (exportPath) command.args.push('--output', `type=oci,dest=${exportPath}`);
  else command.args.push('--push');
  command.args.push('.');
  return command;
}

export function validateBuildxVersion(expected, output, status = 0, error = null) {
  if (error) throw error;
  if (status !== 0) throw new Error(`docker buildx version failed with status ${status}`);
  const match = output.match(/\bv?(\d+\.\d+\.\d+)\b/);
  if (!match) throw new Error(`could not read Docker Buildx version from: ${output.trim()}`);
  if (match[1] !== expected) {
    throw new Error(`Docker Buildx ${match[1]} is installed; slopstack.yaml requires ${expected}`);
  }
}

function display({ command, args }) {
  return [command, ...args].map((part) => (/[\s']/).test(part) ? `'${part.replaceAll("'", "'\\''")}'` : part).join(' ');
}

export async function main(args = process.argv.slice(2)) {
  const dryRun = args.length === 0 || args.includes('--dry-run');
  const push = args.includes('--push');
  const exportIndex = args.indexOf('--export');
  const exportPath = exportIndex >= 0 ? args[exportIndex + 1] : undefined;
  if (args.some((arg, index) => !['--dry-run', '--push', '--export'].includes(arg) && index !== exportIndex + 1) ||
      (dryRun && (push || exportIndex >= 0)) || (push && exportIndex >= 0) ||
      (exportIndex >= 0 && (!exportPath || exportPath.startsWith('--')))) {
    throw new Error('Usage: pnpm deploy [--dry-run | --push | --export PATH]');
  }
  const { config } = await loadProjectConfig();
  const command = buildDeployCommand(config, { exportPath });
  console.log(`${push ? 'Push build' : exportPath ? 'OCI export' : 'Dry run'}: ${display(command)}`);
  if (!push && !exportPath) return 0;
  const version = spawnSync('docker', ['buildx', 'version'], { encoding: 'utf8' });
  validateBuildxVersion(config.tools.dockerBuildx, `${version.stdout ?? ''}\n${version.stderr ?? ''}`, version.status, version.error);
  const result = spawnSync(command.command, command.args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = await main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
