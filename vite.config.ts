import { execSync } from 'node:child_process';
import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';

// Build id = commit (Workers Builds sets WORKERS_CI_COMMIT_SHA; locally git) + UTC build time. Published as /version
// (static asset, free) so a deploy can be polled until the new build is live.
function buildInfo(): { sha: string; id: string; builtAt: string } {
  let sha = process.env.WORKERS_CI_COMMIT_SHA || '';
  if (!/^[0-9a-f]{40}$/.test(sha)) sha = ''; // Workers Builds has been seen to set a branch name here
  if (!sha) { try { sha = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { sha = 'unknown'; } }
  const builtAt = new Date().toISOString();
  return { sha, id: `${sha.slice(0, 7)}-${builtAt.replace(/[-:T]/g, '').slice(0, 12)}`, builtAt };
}

function versionFile(info: ReturnType<typeof buildInfo>): Plugin {
  return {
    name: 'vhdc-version',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version', source: JSON.stringify(info) + '\n' });
    },
  };
}

const info = buildInfo();

export default defineConfig({
  root: 'client',
  plugins: [preact(), versionFile(info)],
  define: { __BUILD_ID__: JSON.stringify(info.id) },
  build: { outDir: '../dist', emptyOutDir: true, target: 'es2022' },
  server: {
    port: 5173,
    proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } },
  },
});
