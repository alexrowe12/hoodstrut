import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

interface PackageMetadata {
  name: string;
  version: string;
}

export function loadPackageMetadata(): PackageMetadata {
  const packagePath = new URL('../../package.json', import.meta.url);
  const parsed: unknown = JSON.parse(readFileSync(packagePath, 'utf-8'));

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('name' in parsed) ||
    !('version' in parsed) ||
    typeof parsed.name !== 'string' ||
    typeof parsed.version !== 'string'
  ) {
    throw new Error('Installed package metadata is invalid');
  }

  return { name: parsed.name, version: parsed.version };
}
