import{createRequire as y}from"node:module";import{execSync as S}from"node:child_process";import{existsSync as R,unlinkSync as v}from"node:fs";import{tmpdir as f}from"node:os";import{join as p,dirname as L}from"node:path";import{fileURLToPath as N}from"node:url";var l=class{#t;constructor(t){this.#t=t}pragma(t){let s=this.#t.prepare(`PRAGMA ${t}`).all();if(!s||s.length===0)return;if(s.length>1)return s;let i=Object.values(s[0]);return i.length===1?i[0]:s[0]}exec(t){let e="",s=null;for(let o=0;o<t.length;o++){let a=t[o];if(s)e+=a,a===s&&(s=null);else if(a==="'"||a==='"')e+=a,s=a;else if(a===";"){let c=e.trim();c&&this.#t.prepare(c).run(),e=""}else e+=a}let i=e.trim();return i&&this.#t.prepare(i).run(),this}prepare(t){let e=this.#t.prepare(t);return{run:(...s)=>e.run(...s),get:(...s)=>{let i=e.get(...s);return i===null?void 0:i},all:(...s)=>e.all(...s),iterate:(...s)=>e.iterate(...s)}}transaction(t){return this.#t.transaction(t)}close(){this.#t.close()}},d=null;function O(){if(!d){let r=y(import.meta.url);try{d=r("better-sqlite3")}catch(t){if(t?.message?.includes("NODE_MODULE_VERSION")||t?.message?.includes("was compiled against")||t?.code==="ERR_DLOPEN_FAILED"){let e=L(N(import.meta.url)),s=p(e,"..","scripts","patch-doltlite.mjs");process.stderr.write(`[context-mode] ABI mismatch detected, rebuilding better-sqlite3 with doltlite...
`);try{if(!R(s))throw new Error(`patch-doltlite.mjs not found at ${s}`);S(`"${process.execPath}" "${s}"`,{cwd:p(e,".."),stdio:["ignore","pipe","pipe"],timeout:12e4}),delete r.cache[r.resolve("better-sqlite3")],d=r("better-sqlite3"),process.stderr.write(`[context-mode] better-sqlite3 rebuilt successfully
`)}catch(i){throw process.stderr.write(`[context-mode] auto-rebuild failed: ${i?.message??i}
`),t}}else if(globalThis.Bun&&t?.code==="MODULE_NOT_FOUND"){process.stderr.write(`[context-mode] better-sqlite3 not found, falling back to bun:sqlite (no doltlite)
`);let e=r(["bun","sqlite"].join(":")).Database;d=function(i,o){let a=new e(i,{readonly:o?.readonly,create:!0});return new l(a)}}else throw t}}return d}function b(r){try{r.prepare("SELECT doltlite_engine()").get();return}catch{}r.pragma("journal_mode = WAL"),r.pragma("synchronous = NORMAL")}function D(r){for(let t of["","-wal","-shm"])try{v(r+t)}catch{}}function _(r){try{(()=>{try{return r.prepare("SELECT doltlite_engine()").get(),!0}catch{return!1}})()||r.pragma("wal_checkpoint(TRUNCATE)")}catch{}try{r.close()}catch{}}function T(r="context-mode"){return p(f(),`${r}-${process.pid}.db`)}function w(r,t=[100,500,2e3]){let e;for(let s=0;s<=t.length;s++)try{return r()}catch(i){let o=i instanceof Error?i.message:String(i);if(!o.includes("SQLITE_BUSY")&&!o.includes("database is locked"))throw i;if(e=i instanceof Error?i:new Error(o),s<t.length){let a=t[s],c=Date.now();for(;Date.now()-c<a;);}}throw new Error(`SQLITE_BUSY: database is locked after ${t.length} retries. Original error: ${e?.message}`)}var u=Symbol.for("__context_mode_live_dbs__"),m=(()=>{let r=globalThis;return r[u]||(r[u]=new Set,process.on("exit",()=>{for(let t of r[u])try{t.close()}catch{}r[u].clear()})),r[u]})(),E=class{#t;#e;constructor(t){let e=O();this.#t=t,this.#e=new e(t,{timeout:3e4}),m.add(this.#e),b(this.#e),this.initSchema(),this.prepareStatements()}get db(){return this.#e}get dbPath(){return this.#t}close(){m.delete(this.#e),_(this.#e)}withRetry(t){return w(t)}cleanup(){m.delete(this.#e),_(this.#e),D(this.#t)}};import{createHash as h}from"node:crypto";import{execFileSync as I}from"node:child_process";function Y(){let r=process.env.CONTEXT_MODE_SESSION_SUFFIX;if(r!==void 0)return r?`__${r}`:"";try{let t=process.cwd(),e=I("git",["worktree","list","--porcelain"],{encoding:"utf-8",timeout:2e3,stdio:["ignore","pipe","ignore"]}).split(/\r?\n/).find(s=>s.startsWith("worktree "))?.replace("worktree ","")?.trim();if(e&&t!==e)return`__${h("sha256").update(t).digest("hex").slice(0,8)}`}catch{}return""}var C=1e3,A=5,n={insertEvent:"insertEvent",getEvents:"getEvents",getEventsByType:"getEventsByType",getEventsByPriority:"getEventsByPriority",getEventsByTypeAndPriority:"getEventsByTypeAndPriority",getEventCount:"getEventCount",checkDuplicate:"checkDuplicate",evictLowestPriority:"evictLowestPriority",updateMetaLastEvent:"updateMetaLastEvent",ensureSession:"ensureSession",getSessionStats:"getSessionStats",incrementCompactCount:"incrementCompactCount",upsertResume:"upsertResume",getResume:"getResume",markResumeConsumed:"markResumeConsumed",deleteEvents:"deleteEvents",deleteMeta:"deleteMeta",deleteResume:"deleteResume",getOldSessions:"getOldSessions"},g=class extends E{constructor(t){super(t?.dbPath??T("session"))}stmt(t){return this.stmts.get(t)}initSchema(){try{let e=this.db.pragma("table_xinfo(session_events)").find(s=>s.name==="data_hash");e&&e.hidden!==0&&this.db.exec("DROP TABLE session_events")}catch{}this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        category TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 2,
        data TEXT NOT NULL,
        source_hook TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        data_hash TEXT NOT NULL DEFAULT ''
      );

      CREATE INDEX IF NOT EXISTS idx_session_events_session ON session_events(session_id);
      CREATE INDEX IF NOT EXISTS idx_session_events_type ON session_events(session_id, type);
      CREATE INDEX IF NOT EXISTS idx_session_events_priority ON session_events(session_id, priority);

      CREATE TABLE IF NOT EXISTS session_meta (
        session_id TEXT PRIMARY KEY,
        project_dir TEXT NOT NULL,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_event_at TEXT,
        event_count INTEGER NOT NULL DEFAULT 0,
        compact_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS session_resume (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL UNIQUE,
        snapshot TEXT NOT NULL,
        event_count INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        consumed INTEGER NOT NULL DEFAULT 0
      );
    `)}prepareStatements(){this.stmts=new Map;let t=(e,s)=>{this.stmts.set(e,this.db.prepare(s))};t(n.insertEvent,`INSERT INTO session_events (session_id, type, category, priority, data, source_hook, data_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`),t(n.getEvents,`SELECT id, session_id, type, category, priority, data, source_hook, created_at, data_hash
       FROM session_events WHERE session_id = ? ORDER BY id ASC LIMIT ?`),t(n.getEventsByType,`SELECT id, session_id, type, category, priority, data, source_hook, created_at, data_hash
       FROM session_events WHERE session_id = ? AND type = ? ORDER BY id ASC LIMIT ?`),t(n.getEventsByPriority,`SELECT id, session_id, type, category, priority, data, source_hook, created_at, data_hash
       FROM session_events WHERE session_id = ? AND priority >= ? ORDER BY id ASC LIMIT ?`),t(n.getEventsByTypeAndPriority,`SELECT id, session_id, type, category, priority, data, source_hook, created_at, data_hash
       FROM session_events WHERE session_id = ? AND type = ? AND priority >= ? ORDER BY id ASC LIMIT ?`),t(n.getEventCount,"SELECT COUNT(*) AS cnt FROM session_events WHERE session_id = ?"),t(n.checkDuplicate,`SELECT 1 FROM (
         SELECT type, data_hash FROM session_events
         WHERE session_id = ? ORDER BY id DESC LIMIT ?
       ) AS recent
       WHERE recent.type = ? AND recent.data_hash = ?
       LIMIT 1`),t(n.evictLowestPriority,`DELETE FROM session_events WHERE id = (
         SELECT id FROM session_events WHERE session_id = ?
         ORDER BY priority ASC, id ASC LIMIT 1
       )`),t(n.updateMetaLastEvent,`UPDATE session_meta
       SET last_event_at = datetime('now'), event_count = event_count + 1
       WHERE session_id = ?`),t(n.ensureSession,"INSERT OR IGNORE INTO session_meta (session_id, project_dir) VALUES (?, ?)"),t(n.getSessionStats,`SELECT session_id, project_dir, started_at, last_event_at, event_count, compact_count
       FROM session_meta WHERE session_id = ?`),t(n.incrementCompactCount,"UPDATE session_meta SET compact_count = compact_count + 1 WHERE session_id = ?"),t(n.upsertResume,`INSERT INTO session_resume (session_id, snapshot, event_count)
       VALUES (?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         snapshot = excluded.snapshot,
         event_count = excluded.event_count,
         created_at = datetime('now'),
         consumed = 0`),t(n.getResume,"SELECT snapshot, event_count, consumed FROM session_resume WHERE session_id = ?"),t(n.markResumeConsumed,"UPDATE session_resume SET consumed = 1 WHERE session_id = ?"),t(n.deleteEvents,"DELETE FROM session_events WHERE session_id = ?"),t(n.deleteMeta,"DELETE FROM session_meta WHERE session_id = ?"),t(n.deleteResume,"DELETE FROM session_resume WHERE session_id = ?"),t(n.getOldSessions,"SELECT session_id FROM session_meta WHERE started_at < datetime('now', ? || ' days')")}insertEvent(t,e,s="PostToolUse"){let i=h("sha256").update(e.data).digest("hex").slice(0,16).toUpperCase();this.db.transaction(()=>{if(this.stmt(n.checkDuplicate).get(t,A,e.type,i))return;this.stmt(n.getEventCount).get(t).cnt>=C&&this.stmt(n.evictLowestPriority).run(t),this.stmt(n.insertEvent).run(t,e.type,e.category,e.priority,e.data,s,i),this.stmt(n.updateMetaLastEvent).run(t)})()}getEvents(t,e){let s=e?.limit??1e3,i=e?.type,o=e?.minPriority;return i&&o!==void 0?this.stmt(n.getEventsByTypeAndPriority).all(t,i,o,s):i?this.stmt(n.getEventsByType).all(t,i,s):o!==void 0?this.stmt(n.getEventsByPriority).all(t,o,s):this.stmt(n.getEvents).all(t,s)}getEventCount(t){return this.stmt(n.getEventCount).get(t).cnt}ensureSession(t,e){this.stmt(n.ensureSession).run(t,e)}getSessionStats(t){return this.stmt(n.getSessionStats).get(t)??null}incrementCompactCount(t){this.stmt(n.incrementCompactCount).run(t)}upsertResume(t,e,s){this.stmt(n.upsertResume).run(t,e,s??0)}getResume(t){return this.stmt(n.getResume).get(t)??null}markResumeConsumed(t){this.stmt(n.markResumeConsumed).run(t)}deleteSession(t){this.db.transaction(()=>{this.stmt(n.deleteEvents).run(t),this.stmt(n.deleteResume).run(t),this.stmt(n.deleteMeta).run(t)})()}cleanupOldSessions(t=7){let e=`-${t}`,s=this.stmt(n.getOldSessions).all(e);for(let{session_id:i}of s)this.deleteSession(i);return s.length}};export{g as SessionDB,Y as getWorktreeSuffix};
