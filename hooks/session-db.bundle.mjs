import{createRequire as g}from"node:module";import{execSync as h}from"node:child_process";import{unlinkSync as y}from"node:fs";import{tmpdir as R}from"node:os";import{join as p,dirname as S}from"node:path";var E=class{#e;constructor(e){this.#e=e}pragma(e){let s=this.#e.prepare(`PRAGMA ${e}`).all();if(!s||s.length===0)return;if(s.length>1)return s;let i=Object.values(s[0]);return i.length===1?i[0]:s[0]}exec(e){let t="",s=null;for(let o=0;o<e.length;o++){let a=e[o];if(s)t+=a,a===s&&(s=null);else if(a==="'"||a==='"')t+=a,s=a;else if(a===";"){let u=t.trim();u&&this.#e.prepare(u).run(),t=""}else t+=a}let i=t.trim();return i&&this.#e.prepare(i).run(),this}prepare(e){let t=this.#e.prepare(e);return{run:(...s)=>t.run(...s),get:(...s)=>{let i=t.get(...s);return i===null?void 0:i},all:(...s)=>t.all(...s),iterate:(...s)=>t.iterate(...s)}}transaction(e){return this.#e.transaction(e)}close(){this.#e.close()}},c=null;function v(){if(!c){let r=g(import.meta.url);if(globalThis.Bun){let e=r(["bun","sqlite"].join(":")).Database;c=function(s,i){let o=new e(s,{readonly:i?.readonly,create:!0});return new E(o)}}else try{c=r("better-sqlite3")}catch(e){if(e?.message?.includes("NODE_MODULE_VERSION")||e?.message?.includes("was compiled against")||e?.code==="ERR_DLOPEN_FAILED"){let t=S(r.resolve("better-sqlite3/package.json"));process.stderr.write(`[context-mode] ABI mismatch detected (Node ${process.version}), rebuilding better-sqlite3...
`);try{h("npm rebuild better-sqlite3",{cwd:p(t,"..",".."),stdio:["ignore","pipe","pipe"],timeout:6e4}),delete r.cache[r.resolve("better-sqlite3")],c=r("better-sqlite3"),process.stderr.write(`[context-mode] better-sqlite3 rebuilt successfully
`)}catch(s){throw process.stderr.write(`[context-mode] auto-rebuild failed: ${s?.message??s}
`),e}}else throw e}}return c}function L(r){try{r.prepare("SELECT doltlite_engine()").get();return}catch{}r.pragma("journal_mode = WAL"),r.pragma("synchronous = NORMAL")}function N(r){for(let e of["","-wal","-shm"])try{y(r+e)}catch{}}function m(r){try{(()=>{try{return r.prepare("SELECT doltlite_engine()").get(),!0}catch{return!1}})()||r.pragma("wal_checkpoint(TRUNCATE)")}catch{}try{r.close()}catch{}}function l(r="context-mode"){return p(R(),`${r}-${process.pid}.db`)}var d=class{#e;#t;constructor(e){let t=v();this.#e=e,this.#t=new t(e,{timeout:5e3}),L(this.#t),this.initSchema(),this.prepareStatements()}get db(){return this.#t}get dbPath(){return this.#e}close(){m(this.#t)}cleanup(){m(this.#t),N(this.#e)}};import{createHash as T}from"node:crypto";import{execFileSync as f}from"node:child_process";function x(){let r=process.env.CONTEXT_MODE_SESSION_SUFFIX;if(r!==void 0)return r?`__${r}`:"";try{let e=process.cwd(),t=f("git",["worktree","list","--porcelain"],{encoding:"utf-8",timeout:2e3,stdio:["ignore","pipe","ignore"]}).split(/\r?\n/).find(s=>s.startsWith("worktree "))?.replace("worktree ","")?.trim();if(t&&e!==t)return`__${T("sha256").update(e).digest("hex").slice(0,8)}`}catch{}return""}var O=1e3,D=5,n={insertEvent:"insertEvent",getEvents:"getEvents",getEventsByType:"getEventsByType",getEventsByPriority:"getEventsByPriority",getEventsByTypeAndPriority:"getEventsByTypeAndPriority",getEventCount:"getEventCount",checkDuplicate:"checkDuplicate",evictLowestPriority:"evictLowestPriority",updateMetaLastEvent:"updateMetaLastEvent",ensureSession:"ensureSession",getSessionStats:"getSessionStats",incrementCompactCount:"incrementCompactCount",upsertResume:"upsertResume",getResume:"getResume",markResumeConsumed:"markResumeConsumed",deleteEvents:"deleteEvents",deleteMeta:"deleteMeta",deleteResume:"deleteResume",getOldSessions:"getOldSessions"},_=class extends d{constructor(e){super(e?.dbPath??l("session"))}stmt(e){return this.stmts.get(e)}initSchema(){try{let t=this.db.pragma("table_xinfo(session_events)").find(s=>s.name==="data_hash");t&&t.hidden!==0&&this.db.exec("DROP TABLE session_events")}catch{}this.db.exec(`
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
    `)}prepareStatements(){this.stmts=new Map;let e=(t,s)=>{this.stmts.set(t,this.db.prepare(s))};e(n.insertEvent,`INSERT INTO session_events (session_id, type, category, priority, data, source_hook, data_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`),e(n.getEvents,`SELECT id, session_id, type, category, priority, data, source_hook, created_at, data_hash
       FROM session_events WHERE session_id = ? ORDER BY id ASC LIMIT ?`),e(n.getEventsByType,`SELECT id, session_id, type, category, priority, data, source_hook, created_at, data_hash
       FROM session_events WHERE session_id = ? AND type = ? ORDER BY id ASC LIMIT ?`),e(n.getEventsByPriority,`SELECT id, session_id, type, category, priority, data, source_hook, created_at, data_hash
       FROM session_events WHERE session_id = ? AND priority >= ? ORDER BY id ASC LIMIT ?`),e(n.getEventsByTypeAndPriority,`SELECT id, session_id, type, category, priority, data, source_hook, created_at, data_hash
       FROM session_events WHERE session_id = ? AND type = ? AND priority >= ? ORDER BY id ASC LIMIT ?`),e(n.getEventCount,"SELECT COUNT(*) AS cnt FROM session_events WHERE session_id = ?"),e(n.checkDuplicate,`SELECT 1 FROM (
         SELECT type, data_hash FROM session_events
         WHERE session_id = ? ORDER BY id DESC LIMIT ?
       ) AS recent
       WHERE recent.type = ? AND recent.data_hash = ?
       LIMIT 1`),e(n.evictLowestPriority,`DELETE FROM session_events WHERE id = (
         SELECT id FROM session_events WHERE session_id = ?
         ORDER BY priority ASC, id ASC LIMIT 1
       )`),e(n.updateMetaLastEvent,`UPDATE session_meta
       SET last_event_at = datetime('now'), event_count = event_count + 1
       WHERE session_id = ?`),e(n.ensureSession,"INSERT OR IGNORE INTO session_meta (session_id, project_dir) VALUES (?, ?)"),e(n.getSessionStats,`SELECT session_id, project_dir, started_at, last_event_at, event_count, compact_count
       FROM session_meta WHERE session_id = ?`),e(n.incrementCompactCount,"UPDATE session_meta SET compact_count = compact_count + 1 WHERE session_id = ?"),e(n.upsertResume,`INSERT INTO session_resume (session_id, snapshot, event_count)
       VALUES (?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         snapshot = excluded.snapshot,
         event_count = excluded.event_count,
         created_at = datetime('now'),
         consumed = 0`),e(n.getResume,"SELECT snapshot, event_count, consumed FROM session_resume WHERE session_id = ?"),e(n.markResumeConsumed,"UPDATE session_resume SET consumed = 1 WHERE session_id = ?"),e(n.deleteEvents,"DELETE FROM session_events WHERE session_id = ?"),e(n.deleteMeta,"DELETE FROM session_meta WHERE session_id = ?"),e(n.deleteResume,"DELETE FROM session_resume WHERE session_id = ?"),e(n.getOldSessions,"SELECT session_id FROM session_meta WHERE started_at < datetime('now', ? || ' days')")}insertEvent(e,t,s="PostToolUse"){let i=T("sha256").update(t.data).digest("hex").slice(0,16).toUpperCase();this.db.transaction(()=>{if(this.stmt(n.checkDuplicate).get(e,D,t.type,i))return;this.stmt(n.getEventCount).get(e).cnt>=O&&this.stmt(n.evictLowestPriority).run(e),this.stmt(n.insertEvent).run(e,t.type,t.category,t.priority,t.data,s,i),this.stmt(n.updateMetaLastEvent).run(e)})()}getEvents(e,t){let s=t?.limit??1e3,i=t?.type,o=t?.minPriority;return i&&o!==void 0?this.stmt(n.getEventsByTypeAndPriority).all(e,i,o,s):i?this.stmt(n.getEventsByType).all(e,i,s):o!==void 0?this.stmt(n.getEventsByPriority).all(e,o,s):this.stmt(n.getEvents).all(e,s)}getEventCount(e){return this.stmt(n.getEventCount).get(e).cnt}ensureSession(e,t){this.stmt(n.ensureSession).run(e,t)}getSessionStats(e){return this.stmt(n.getSessionStats).get(e)??null}incrementCompactCount(e){this.stmt(n.incrementCompactCount).run(e)}upsertResume(e,t,s){this.stmt(n.upsertResume).run(e,t,s??0)}getResume(e){return this.stmt(n.getResume).get(e)??null}markResumeConsumed(e){this.stmt(n.markResumeConsumed).run(e)}deleteSession(e){this.db.transaction(()=>{this.stmt(n.deleteEvents).run(e),this.stmt(n.deleteResume).run(e),this.stmt(n.deleteMeta).run(e)})()}cleanupOldSessions(e=7){let t=`-${e}`,s=this.stmt(n.getOldSessions).all(t);for(let{session_id:i}of s)this.deleteSession(i);return s.length}};export{_ as SessionDB,x as getWorktreeSuffix};
