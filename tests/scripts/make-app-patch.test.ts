// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { createHash } from 'node:crypto';
import { buildPatchManifest } from '../../scripts/make-app-patch.mjs';

/**
 * Hot-patch packer (Phase A). The packer is a pure-ish builder: given a
 * `dist/` tree it produces the update-patch.json descriptor consumed by
 * Rust (`app_patch.rs`) and by the TS side (`fetchPatchManifest`).
 * Hashes are sha256 hex (64 chars) per manifest contract — Rust re-verifies
 * after every write, so these values must be honest.
 */

async function sha256Of(path: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function makeFixture(): Promise<string> {
  const dist = await mkdtemp(join(tmpdir(), 'app-patch-dist-'));
  await writeFile(join(dist, 'index.html'), '<html><body>patched v2</body></html>\n');
  await mkdir(join(dist, 'assets'), { recursive: true });
  await writeFile(join(dist, 'assets', 'app.css'), 'body { color: red }\n');
  return dist;
}

describe('buildPatchManifest', () => {
  it('builds a manifest whose file table matches the dist tree', async () => {
    const dist = await makeFixture();
    const m = await buildPatchManifest({ baseVersion: '2.31.34', distDir: dist });

    expect(m.magic).toBe('DENTALUPDATE-PATCH');
    expect(m.base_version).toBe('2.31.34');
    expect(m.display_version).toBe('2.31.34'); // operator bumps this by hand per patch
    expect(m.files.length).toBe(2);
    expect(m.files.every((f) => f.sha256.length === 64)).toBe(true);

    const html = m.files.find((f) => f.path === 'index.html')!;
    expect(html.size).toBe('<html><body>patched v2</body></html>\n'.length);
    expect(html.sha256).toBe(await sha256Of(join(dist, 'index.html')));
  });

  it('paths are relative to dist root, posix-style, no "dist/" prefix', async () => {
    const dist = await makeFixture();
    const m = await buildPatchManifest({ baseVersion: '2.31.34', distDir: dist });
    const paths = m.files.map((f) => f.path);
    expect(paths).toContain('index.html');
    expect(paths).toContain('assets/app.css');
    expect(paths.every((p) => !p.startsWith('/') && !p.includes('\\'))).toBe(true);
  });

  it('skips nothing but records every regular file', async () => {
    const dist = await makeFixture();
    await mkdir(join(dist, 'sub'), { recursive: true });
    await writeFile(join(dist, 'sub', 'nested.js'), 'x = 1\n');
    const m = await buildPatchManifest({ baseVersion: '2.31.34', distDir: dist });
    expect(m.files.map((f) => f.path)).toContain('sub/nested.js');
  });
});
