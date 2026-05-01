import{createHash as L}from"node:crypto";import{createRequire as N}from"node:module";import{unlinkSync as D,existsSync as d,mkdirSync as b,copyFileSync as T,readFileSync as S}from"node:fs";import{tmpdir as O}from"node:os";import{join as a,dirname as p}from"node:path";import{fileURLToPath as I}from"node:url";var l=null;function g(e){let t=a(p(e),".doltlite-version");if(!d(t))return null;try{return JSON.parse(S(t,"utf8"))}catch{return null}}function h(e){return L("sha256").update(S(e)).digest("hex")}function A(e,t){return!e||!t?!1:e.commit===t.commit&&e.libBuilt===t.libBuilt&&e.addonBuilt===t.addonBuilt}function C(e,t){if(!d(e)||!d(t))return!0;let n=g(e),r=g(t);if(n||r)return!A(n,r);try{return h(e)!==h(t)}catch{return!0}}function w(){if(!l){let e=N(import.meta.url);if(!globalThis.__DOLTLITE_NATIVE_PATH){let t=p(I(import.meta.url)),n=process.versions.modules,r=a(t,"prebuilds",`${process.platform}-${process.arch}`,`node.abi${n}.node`),i=a(p(r),".doltlite-version"),o=a(t,"vendor","better-sqlite3","build","Release"),c=a(o,"better_sqlite3.node");d(r)&&(C(r,c)&&(b(o,{recursive:!0}),T(r,c),d(i)&&T(i,a(o,".doltlite-version"))),globalThis.__DOLTLITE_NATIVE_PATH=c)}try{l=e("./vendor/better-sqlite3")}catch(t){throw t}}return l}function M(e){try{e.prepare("SELECT doltlite_engine()").get();return}catch{}e.pragma("journal_mode = WAL"),e.pragma("synchronous = NORMAL")}function k(e){for(let t of["","-wal","-shm"])try{D(e+t)}catch{}}function y(e){try{(()=>{try{return e.prepare("SELECT doltlite_engine()").get(),!0}catch{return!1}})()||e.pragma("wal_checkpoint(TRUNCATE)")}catch{}try{e.close()}catch{}}function v(e="context-mode"){return a(O(),`${e}-${process.pid}.db`)}function P(e,t=[100,500,2e3]){let n;for(let r=0;r<=t.length;r++)try{return e()}catch(i){let o=i instanceof Error?i.message:String(i);if(!o.includes("SQLITE_BUSY")&&!o.includes("database is locked"))throw i;if(n=i instanceof Error?i:new Error(o),r<t.length){let c=t[r],_=Date.now();for(;Date.now()-_<c;);}}throw new Error(`SQLITE_BUSY: database is locked after ${t.length} retries. Original error: ${n?.message}`)}var u=Symbol.for("__context_mode_live_dbs__"),m=(()=>{let e=globalThis;return e[u]||(e[u]=new Set,process.on("exit",()=>{for(let t of e[u])try{t.close()}catch{}e[u].clear()})),e[u]})(),E=class{#e;#t;constructor(t){let n=w();this.#e=t,this.#t=new n(t,{timeout:3e4}),m.add(this.#t),M(this.#t),this.initSchema(),this.prepareStatements()}get db(){return this.#t}get dbPath(){return this.#e}close(){m.delete(this.#t),y(this.#t)}withRetry(t){return P(t)}cleanup(){m.delete(this.#t),y(this.#t),k(this.#e)}};import{createHash as f}from"node:crypto";import{execFileSync as U}from"node:child_process";function Q(){let e=process.env.CONTEXT_MODE_SESSION_SUFFIX;if(e!==void 0)return e?`__${e}`:"";try{let t=process.cwd(),n=U("git",["worktree","list","--porcelain"],{encoding:"utf-8",timeout:2e3,stdio:["ignore","pipe","ignore"]}).split(/\r?\n/).find(r=>r.startsWith("worktree "))?.replace("worktree ","")?.trim();if(n&&t!==n)return`__${f("sha256").update(t).digest("hex").slice(0,8)}`}catch{}return""}var x=1e3,F=5,s={insertEvent:"insertEvent",getEvents:"getEvents",getEventsByType:"getEventsByType",getEventsByPriority:"getEventsByPriority",getEventsByTypeAndPriority:"getEventsByTypeAndPriority",getEventCount:"getEventCount",checkDuplicate:"checkDuplicate",evictLowestPriority:"evictLowestPriority",updateMetaLastEvent:"updateMetaLastEvent",ensureSession:"ensureSession",getSessionStats:"getSessionStats",incrementCompactCount:"incrementCompactCount",upsertResume:"upsertResume",getResume:"getResume",markResumeConsumed:"markResumeConsumed",deleteEvents:"deleteEvents",deleteMeta:"deleteMeta",deleteResume:"deleteResume",getOldSessions:"getOldSessions"},R=class extends E{constructor(t){super(t?.dbPath??v("session"))}stmt(t){return this.stmts.get(t)}initSchema(){try{let n=this.db.pragma("table_xinfo(session_events)").find(r=>r.name==="data_hash");n&&n.hidden!==0&&this.db.exec("DROP TABLE session_events")}catch{}this.db.exec(`
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
    `)}prepareStatements(){this.stmts=new Map;let t=(n,r)=>{this.stmts.set(n,this.db.prepare(r))};t(s.insertEvent,`INSERT INTO session_events (session_id, type, category, priority, data, source_hook, data_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`),t(s.getEvents,`SELECT id, session_id, type, category, priority, data, source_hook, created_at, data_hash
       FROM session_events WHERE session_id = ? ORDER BY id ASC LIMIT ?`),t(s.getEventsByType,`SELECT id, session_id, type, category, priority, data, source_hook, created_at, data_hash
       FROM session_events WHERE session_id = ? AND type = ? ORDER BY id ASC LIMIT ?`),t(s.getEventsByPriority,`SELECT id, session_id, type, category, priority, data, source_hook, created_at, data_hash
       FROM session_events WHERE session_id = ? AND priority >= ? ORDER BY id ASC LIMIT ?`),t(s.getEventsByTypeAndPriority,`SELECT id, session_id, type, category, priority, data, source_hook, created_at, data_hash
       FROM session_events WHERE session_id = ? AND type = ? AND priority >= ? ORDER BY id ASC LIMIT ?`),t(s.getEventCount,"SELECT COUNT(*) AS cnt FROM session_events WHERE session_id = ?"),t(s.checkDuplicate,`SELECT 1 FROM (
         SELECT type, data_hash FROM session_events
         WHERE session_id = ? ORDER BY id DESC LIMIT ?
       ) AS recent
       WHERE recent.type = ? AND recent.data_hash = ?
       LIMIT 1`),t(s.evictLowestPriority,`DELETE FROM session_events WHERE id = (
         SELECT id FROM session_events WHERE session_id = ?
         ORDER BY priority ASC, id ASC LIMIT 1
       )`),t(s.updateMetaLastEvent,`UPDATE session_meta
       SET last_event_at = datetime('now'), event_count = event_count + 1
       WHERE session_id = ?`),t(s.ensureSession,"INSERT OR IGNORE INTO session_meta (session_id, project_dir) VALUES (?, ?)"),t(s.getSessionStats,`SELECT session_id, project_dir, started_at, last_event_at, event_count, compact_count
       FROM session_meta WHERE session_id = ?`),t(s.incrementCompactCount,"UPDATE session_meta SET compact_count = compact_count + 1 WHERE session_id = ?"),t(s.upsertResume,`INSERT INTO session_resume (session_id, snapshot, event_count)
       VALUES (?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         snapshot = excluded.snapshot,
         event_count = excluded.event_count,
         created_at = datetime('now'),
         consumed = 0`),t(s.getResume,"SELECT snapshot, event_count, consumed FROM session_resume WHERE session_id = ?"),t(s.markResumeConsumed,"UPDATE session_resume SET consumed = 1 WHERE session_id = ?"),t(s.deleteEvents,"DELETE FROM session_events WHERE session_id = ?"),t(s.deleteMeta,"DELETE FROM session_meta WHERE session_id = ?"),t(s.deleteResume,"DELETE FROM session_resume WHERE session_id = ?"),t(s.getOldSessions,"SELECT session_id FROM session_meta WHERE started_at < datetime('now', ? || ' days')")}insertEvent(t,n,r="PostToolUse"){let i=f("sha256").update(n.data).digest("hex").slice(0,16).toUpperCase();this.db.transaction(()=>{if(this.stmt(s.checkDuplicate).get(t,F,n.type,i))return;this.stmt(s.getEventCount).get(t).cnt>=x&&this.stmt(s.evictLowestPriority).run(t),this.stmt(s.insertEvent).run(t,n.type,n.category,n.priority,n.data,r,i),this.stmt(s.updateMetaLastEvent).run(t)})()}getEvents(t,n){let r=n?.limit??1e3,i=n?.type,o=n?.minPriority;return i&&o!==void 0?this.stmt(s.getEventsByTypeAndPriority).all(t,i,o,r):i?this.stmt(s.getEventsByType).all(t,i,r):o!==void 0?this.stmt(s.getEventsByPriority).all(t,o,r):this.stmt(s.getEvents).all(t,r)}getEventCount(t){return this.stmt(s.getEventCount).get(t).cnt}ensureSession(t,n){this.stmt(s.ensureSession).run(t,n)}getSessionStats(t){return this.stmt(s.getSessionStats).get(t)??null}incrementCompactCount(t){this.stmt(s.incrementCompactCount).run(t)}upsertResume(t,n,r){this.stmt(s.upsertResume).run(t,n,r??0)}getResume(t){return this.stmt(s.getResume).get(t)??null}markResumeConsumed(t){this.stmt(s.markResumeConsumed).run(t)}deleteSession(t){this.db.transaction(()=>{this.stmt(s.deleteEvents).run(t),this.stmt(s.deleteResume).run(t),this.stmt(s.deleteMeta).run(t)})()}cleanupOldSessions(t=7){let n=`-${t}`,r=this.stmt(s.getOldSessions).all(n);for(let{session_id:i}of r)this.deleteSession(i);return r.length}};export{R as SessionDB,Q as getWorktreeSuffix};
