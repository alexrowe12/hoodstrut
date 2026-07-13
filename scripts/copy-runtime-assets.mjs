import { chmod, cp, mkdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const dockerOutput = new URL('dist/docker/', root);

await mkdir(dockerOutput, { recursive: true });
await cp(new URL('src/docker/templates/', root), new URL('templates/', dockerOutput), {
  recursive: true,
});
await cp(new URL('src/docker/scripts/', root), new URL('scripts/', dockerOutput), {
  recursive: true,
});
await chmod(new URL('dist/cli/index.js', root), 0o755);
await chmod(new URL('scripts/run-task.sh', dockerOutput), 0o755);
