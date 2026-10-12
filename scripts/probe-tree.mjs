import { execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';

const APP_ID = process.env.WIKI_BETA_APP_ID?.trim() || 'app_EXAMPLE0000001';
const SPACE_ID = process.env.WIKI_BETA_WIKI_SPACE_ID?.trim() || 'wikSPACEEXAMPLE0001';
const ROOT_NODE = process.env.WIKI_BETA_WIKI_ROOT_NODE?.trim() || 'wikNODEXAMPLEROOT001';

function resolveLarkCli() {
  if (process.env.LARK_CLI?.trim()) return process.env.LARK_CLI.trim();
  const base = join(os.homedir(), '.workbuddy', 'binaries', 'node');
  try {
    for (const v of readdirSync(join(base, 'versions'))) {
      const p = join(base, 'versions', v, 'lark-cli.cmd');
      if (existsSync(p)) return p;
    }
  } catch {}
  return 'lark-cli';
}
const LARK = resolveLarkCli();
function q(s) { return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`; }
function run(args) {
  return execSync(`"${LARK}" ${args.map(q).join(' ')}`, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}
function pj(out) { const a = out.indexOf('{'), b = out.lastIndexOf('}'); return JSON.parse(out.slice(a, b + 1)); }

async function list(parent) {
  const j = pj(run(['wiki', '+node-list', '--space-id', SPACE_ID, '--parent-node-token', parent, '--as', 'user', '--format', 'json']));
  return j?.data?.nodes ?? [];
}

async function walk(parent, depth, board) {
  const nodes = await list(parent);
  for (const n of nodes) {
    const tag = `${'  '.repeat(depth)}${n.obj_type}${n.has_child ? '(child)' : ''} | ${n.title} | token=${n.node_token}`;
    console.log(tag);
    if (n.has_child) await walk(n.node_token, depth + 1, board || n.title);
  }
}

const root = await list(ROOT_NODE);
console.log('=== ROOT ===');
for (const b of root) {
  console.log(`${b.obj_type}${b.has_child ? '(child)' : ''} | ${b.title} | token=${b.node_token}`);
  if (b.has_child) await walk(b.node_token, 1, b.title);
}
