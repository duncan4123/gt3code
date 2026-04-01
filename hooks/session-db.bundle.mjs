import{createRequire as g}from"node:module";import{execSync as h}from"node:child_process";import{existsSync as y,unlinkSync as R}from"node:fs";import{tmpdir as S}from"node:os";import{join as E,dirname as v}from"node:path";import{fileURLToPath as L}from"node:url";var m=class{#t;constructor(t){this.#t=t}pragma(t){let s=this.#t.prepare(`PRAGMA ${t}`).all();if(!s||s.length===0)return;if(s.length>1)return s;let i=Object.values(s[0]);return i.length===1?i[0]:s[0]}exec(t){let e="",s=null;for(let o=0;o<t.length;o++){let a=t[o];if(s)e+=a,a===s&&(s=null);else if(a==="'"||a==='"')e+=a,s=a;else if(a===";"){let u=e.trim();u&&this.#t.prepare(u).run(),e=""}else e+=a}let i=e.trim();return i&&this.#t.prepare(i).run(),this}prepare(t){let e=this.#t.prepare(t);return{run:(...s)=>e.run(...s),get:(...s)=>{let i=e.get(...s);return i===null?void 0:i},all:(...s)=>e.all(...s),iterate:(...s)=>e.iterate(...s)}}transaction(t){return this.#t.transaction(t)}close(){this.#t.close()}},c=null;function f(){if(!c){let r=g(import.meta.url);try{c=r("better-sqlite3")}catch(t){if(t?.message?.includes("NODE_MODULE_VERSION")||t?.message?.includes("was compiled against")||t?.code==="ERR_DLOPEN_FAILED"){let e=v(L(import.meta.url)),s=E(e,"..","scripts","patch-doltlite.mjs");process.stderr.write(`[context-mode] ABI mismatch detected, rebuilding better-sqlite3 with doltlite...
`);try{if(!y(s))throw new Error(`patch-doltlite.mjs not found at ${s}`);h(`node ${s}`,{cwd:E(e,".."),stdio:["ignore","pipe","pipe"],timeout:12e4}),delete r.cache[r.resolve("better-sqlite3")],c=r("better-sqlite3"),process.stderr.write(`[context-mode] better-sqlite3 rebuilt successfully
`)}catch(i){throw process.stderr.write(`[context-mode] auto-rebuild failed: ${i?.message??i}
`),t}}else if(globalThis.Bun&&t?.code==="MODULE_NOT_FOUND"){process.stderr.write(`[context-mode] better-sqlite3 not found, falling back to bun:sqlite (no doltlite)
`);let e=r(["bun","sqlite"].join(":")).Database;c=function(i,o){let a=new e(i,{readonly:o?.readonly,create:!0});return new m(a)}}else throw t}}return c}function N(r){try{r.prepare("SELECT doltlite_engine()").get();return}catch{}r.pragma("journal_mode = WAL"),r.pragma("synchronous = NORMAL")}function O(r){for(let t of["","-wal","-shm"])try{R(r+t)}catch{}}function p(r){try{(()=>{try{return r.prepare("SELECT doltlite_engine()").get(),!0}catch{return!1}})()||r.pragma("wal_checkpoint(TRUNCATE)")}catch{}try{r.close()}catch{}}function l(r="context-mode"){return E(S(),`${r}-${process.pid}.db`)}var d=class{#t;#e;constructor(t){let e=f();this.#t=t,this.#e=new e(t,{timeout:5e3}),N(this.#e),this.initSchema(),this.prepareStatements()}get db(){return this.#e}get dbPath(){return this.#t}close(){p(this.#e)}cleanup(){p(this.#e),O(this.#t)}};import{createHash as T}from"node:crypto";import{execFileSync as D}from"node:child_process";function X(){let r=process.env.CONTEXT_MODE_SESSION_SUFFIX;if(r!==void 0)return r?`__${r}`:"";try{let t=process.cwd(),e=D("git",["worktree","list","--porcelain"],{encoding:"utf-8",timeout:2e3,stdio:["ignore","pipe","ignore"]}).split(/\r?\n/).find(s=>s.startsWith("worktree "))?.replace("worktree ","")?.trim();if(e&&t!==e)return`__${T("sha256").update(t).digest("hex").slice(0,8)}`}catch{}return""}var b=1e3,C=5,n={insertEvent:"insertEvent",getEvents:"getEvents",getEventsByType:"getEventsByType",getEventsByPriority:"getEventsByPriority",getEventsByTypeAndPriority:"getEventsByTypeAndPriority",getEventCount:"getEventCount",checkDuplicate:"checkDuplicate",evictLowestPriority:"evictLowestPriority",updateMetaLastEvent:"updateMetaLastEvent",ensureSession:"ensureSession",getSessionStats:"getSessionStats",incrementCompactCount:"incrementCompactCount",upsertResume:"upsertResume",getResume:"getResume",markResumeConsumed:"markResumeConsumed",deleteEvents:"deleteEvents",deleteMeta:"deleteMeta",deleteResume:"deleteResume",getOldSessions:"getOldSessions"},_=class extends d{constructor(t){super(t?.dbPath??l("session"))}stmt(t){return this.stmts.get(t)}initSchema(){try{let e=this.db.pragma("table_xinfo(session_events)").find(s=>s.name==="data_hash");e&&e.hidden!==0&&this.db.exec("DROP TABLE session_events")}catch{}this.db.exec(`
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
         consumed = 0`),t(n.getResume,"SELECT snapshot, event_count, consumed FROM session_resume WHERE session_id = ?"),t(n.markResumeConsumed,"UPDATE session_resume SET consumed = 1 WHERE session_id = ?"),t(n.deleteEvents,"DELETE FROM session_events WHERE session_id = ?"),t(n.deleteMeta,"DELETE FROM session_meta WHERE session_id = ?"),t(n.deleteResume,"DELETE FROM session_resume WHERE session_id = ?"),t(n.getOldSessions,"SELECT session_id FROM session_meta WHERE started_at < datetime('now', ? || ' days')")}insertEvent(t,e,s="PostToolUse"){let i=T("sha256").update(e.data).digest("hex").slice(0,16).toUpperCase();this.db.transaction(()=>{if(this.stmt(n.checkDuplicate).get(t,C,e.type,i))return;this.stmt(n.getEventCount).get(t).cnt>=b&&this.stmt(n.evictLowestPriority).run(t),this.stmt(n.insertEvent).run(t,e.type,e.category,e.priority,e.data,s,i),this.stmt(n.updateMetaLastEvent).run(t)})()}getEvents(t,e){let s=e?.limit??1e3,i=e?.type,o=e?.minPriority;return i&&o!==void 0?this.stmt(n.getEventsByTypeAndPriority).all(t,i,o,s):i?this.stmt(n.getEventsByType).all(t,i,s):o!==void 0?this.stmt(n.getEventsByPriority).all(t,o,s):this.stmt(n.getEvents).all(t,s)}getEventCount(t){return this.stmt(n.getEventCount).get(t).cnt}ensureSession(t,e){this.stmt(n.ensureSession).run(t,e)}getSessionStats(t){return this.stmt(n.getSessionStats).get(t)??null}incrementCompactCount(t){this.stmt(n.incrementCompactCount).run(t)}upsertResume(t,e,s){this.stmt(n.upsertResume).run(t,e,s??0)}getResume(t){return this.stmt(n.getResume).get(t)??null}markResumeConsumed(t){this.stmt(n.markResumeConsumed).run(t)}deleteSession(t){this.db.transaction(()=>{this.stmt(n.deleteEvents).run(t),this.stmt(n.deleteResume).run(t),this.stmt(n.deleteMeta).run(t)})()}cleanupOldSessions(t=7){let e=`-${t}`,s=this.stmt(n.getOldSessions).all(e);for(let{session_id:i}of s)this.deleteSession(i);return s.length}};export{_ as SessionDB,X as getWorktreeSuffix};
