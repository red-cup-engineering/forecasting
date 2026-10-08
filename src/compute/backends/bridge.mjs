// A request/response bridge to a child process over the frame protocol (frame.mjs).
// WSL interop cannot hand a Windows .exe a Unix-domain-socket stdio (node's 'pipe' type): the launch dies with
// "UtilAcceptVsock: accept4 failed 110". The .exe is therefore run inside a shell pipeline
// (`cat | exe | cat`), where its stdin/stdout are anonymous pipes, which interop does pass. stderr goes to a file.
// Interop launches also fail intermittently under load; a bridge that has never answered is respawned (3 tries),
// a bridge that has not yet answered gets a 20 s deadline (relaunched on expiry), and every later call has a deadline, after which the child is killed and the bridge is dead (the planner then falls back).
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeFrame, frameReader } from './frame.mjs';

const killGroup = (c) => { try { process.kill(-c.pid); } catch { /* gone */ } };
const q = (s) => `'${String(s).replace(/'/gu, `'\\''`)}'`;

export function bridge(cmd, args = [], { cwd, launches = 4, timeoutMs = 120_000, startupMs = 20_000 } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'bridge-')); const errFile = join(tmp, 'stderr');
  let child = null; let pending = new Map(); let nextId = 1; let dead = null; let everAnswered = false; let launched = 0; let closed = false;

  const fail = (why) => {
    let err = ''; try { err = readFileSync(errFile, 'utf8').trim().split('\n').slice(-3).join(' | '); } catch { /* none */ }
    dead = `${why}${err ? `: ${err}` : ''}`;
    const p = pending; pending = new Map(); for (const w of p.values()) w({ ok: false, error: dead }, {});
  };
  const launch = () => {
    launched += 1; dead = null;
    const c = spawn('sh', ['-c', `cat | ${[cmd, ...args].map(q).join(' ')} 2>${q(errFile)} | cat`], { cwd, stdio: ['pipe', 'pipe', 'ignore'], detached: true });
    child = c;
    c.stdout.on('data', frameReader((h, p) => { everAnswered = true; const w = pending.get(h.id); if (w) { pending.delete(h.id); w(h, p); } }));
    c.stdin.on('error', () => {}); c.on('error', (e) => { if (child === c) fail(String(e)); });
    c.on('exit', (code) => { if (child === c && !closed) fail(`bridge exited ${code}`); });
  };
  launch();

  return {
    async call(header, bufs = []) {
      if (dead && !everAnswered && launched < launches) launch();
      if (dead) throw new Error(dead);
      if (!everAnswered && header.op !== 'hello') await this.call({ op: 'hello' }); // interop launches sometimes hang: prove liveness on a short deadline first
      const id = nextId++; const c = child;
      const answer = new Promise((resolve, reject) => {
        pending.set(id, (h, p) => (h.ok ? resolve([h, p]) : reject(new Error(h.error))));
        c.stdin.write(encodeFrame({ ...header, id }, bufs));
      });
      let timer; const deadline = new Promise((_, reject) => { const limit = everAnswered ? timeoutMs : startupMs; timer = setTimeout(() => { fail(`no answer to ${header.op} within ${limit} ms`); killGroup(c); reject(new Error(dead)); }, limit); });
      try { return await Promise.race([answer, deadline]); } catch (e) {
        if (!everAnswered && launched < launches && /exited|accept4|ENOENT|no answer/u.test(e.message)) return this.call(header, bufs); // interop launch failed: relaunch
        throw e;
      } finally { clearTimeout(timer); }
    },
    close() { closed = true; child?.stdin.end(); setTimeout(() => { if (child) killGroup(child); rmSync(tmp, { recursive: true, force: true }); }, 1500).unref(); },
  };
}
