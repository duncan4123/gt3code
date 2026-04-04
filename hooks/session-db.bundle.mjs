import{createRequire as S}from"node:module";import{unlinkSync as R,existsSync as l,mkdirSync as v,copyFileSync as f,statSync as _}from"node:fs";import{tmpdir as L}from"node:os";import{join as d,resolve as N,dirname as O}from"node:path";import{fileURLToPath as b}from"node:url";var E=null;function D(){if(!E){let n=S(import.meta.url);if(!globalThis.__DOLTLITE_NATIVE_PATH){let t=N(O(b(import.meta.url)),".."),s=process.versions.modules,r=d(t,"prebuilds",`${process.platform}-${process.arch}`,`node.abi${s}.node`),i=d(t,"vendor","better-sqlite3","build","Release"),o=d(i,"better_sqlite3.node");if(l(r)){let a=!l(o);if(!a)try{_(r).size!==_(o).size&&(a=!0)}catch{a=!0}a&&(v(i,{recursive:!0}),f(r,o)),globalThis.__DOLTLITE_NATIVE_PATH=o}}try{E=n("./vendor/better-sqlite3")}catch(t){throw t}}return E}function I(n){try{n.prepare("SELECT doltlite_engine()").get();return}catch{}n.pragma("journal_mode = WAL"),n.pragma("synchronous = NORMAL")}function C(n){for(let t of["","-wal","-shm"])try{R(n+t)}catch{}}function T(n){try{(()=>{try{return n.prepare("SELECT doltlite_engine()").get(),!0}catch{return!1}})()||n.pragma("wal_checkpoint(TRUNCATE)")}catch{}try{n.close()}catch{}}function g(n="context-mode"){return d(L(),`${n}-${process.pid}.db`)}function A(n,t=[100,500,2e3]){let s;for(let r=0;r<=t.length;r++)try{return n()}catch(i){let o=i instanceof Error?i.message:String(i);if(!o.includes("SQLITE_BUSY")&&!o.includes("database is locked"))throw i;if(s=i instanceof Error?i:new Error(o),r<t.length){let a=t[r],p=Date.now();for(;Date.now()-p<a;);}}throw new Error(`SQLITE_BUSY: database is locked after ${t.length} retries. Original error: ${s?.message}`)}var c=Symbol.for("__context_mode_live_dbs__"),m=(()=>{let n=globalThis;return n[c]||(n[c]=new Set,process.on("exit",()=>{for(let t of n[c])try{t.close()}catch{}n[c].clear()})),n[c]})(),u=class{#e;#t;constructor(t){let s=D();this.#e=t,this.#t=new s(t,{timeout:3e4}),m.add(this.#t),I(this.#t),this.initSchema(),this.prepareStatements()}get db(){return this.#t}get dbPath(){return this.#e}close(){m.delete(this.#t),T(this.#t)}withRetry(t){return A(t)}cleanup(){m.delete(this.#t),T(this.#t),C(this.#e)}};import{createHash as y}from"node:crypto";import{execFileSync as w}from"node:child_process";function $(){let n=process.env.CONTEXT_MODE_SESSION_SUFFIX;if(n!==void 0)return n?`__${n}`:"";try{let t=process.cwd(),s=w("git",["worktree","list","--porcelain"],{encoding:"utf-8",timeout:2e3,stdio:["ignore","pipe","ignore"]}).split(/\r?\n/).find(r=>r.startsWith("worktree "))?.replace("worktree ","")?.trim();if(s&&t!==s)return`__${y("sha256").update(t).digest("hex").slice(0,8)}`}catch{}return""}var U=1e3,M=5,e={insertEvent:"insertEvent",getEvents:"getEvents",getEventsByType:"getEventsByType",getEventsByPriority:"getEventsByPriority",getEventsByTypeAndPriority:"getEventsByTypeAndPriority",getEventCount:"getEventCount",checkDuplicate:"checkDuplicate",evictLowestPriority:"evictLowestPriority",updateMetaLastEvent:"updateMetaLastEvent",ensureSession:"ensureSession",getSessionStats:"getSessionStats",incrementCompactCount:"incrementCompactCount",upsertResume:"upsertResume",getResume:"getResume",markResumeConsumed:"markResumeConsumed",deleteEvents:"deleteEvents",deleteMeta:"deleteMeta",deleteResume:"deleteResume",getOldSessions:"getOldSessions"},h=class extends u{constructor(t){super(t?.dbPath??g("session"))}stmt(t){return this.stmts.get(t)}initSchema(){try{let s=this.db.pragma("table_xinfo(session_events)").find(r=>r.name==="data_hash");s&&s.hidden!==0&&this.db.exec("DROP TABLE session_events")}catch{}this.db.exec(`
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
    `)}prepareStatements(){this.stmts=new Map;let t=(s,r)=>{this.stmts.set(s,this.db.prepare(r))};t(e.insertEvent,`INSERT INTO session_events (session_id, type, category, priority, data, source_hook, data_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`),t(e.getEvents,`SELECT id, session_id, type, category, priority, data, source_hook, created_at, data_hash
       FROM session_events WHERE session_id = ? ORDER BY id ASC LIMIT ?`),t(e.getEventsByType,`SELECT id, session_id, type, category, priority, data, source_hook, created_at, data_hash
       FROM session_events WHERE session_id = ? AND type = ? ORDER BY id ASC LIMIT ?`),t(e.getEventsByPriority,`SELECT id, session_id, type, category, priority, data, source_hook, created_at, data_hash
       FROM session_events WHERE session_id = ? AND priority >= ? ORDER BY id ASC LIMIT ?`),t(e.getEventsByTypeAndPriority,`SELECT id, session_id, type, category, priority, data, source_hook, created_at, data_hash
       FROM session_events WHERE session_id = ? AND type = ? AND priority >= ? ORDER BY id ASC LIMIT ?`),t(e.getEventCount,"SELECT COUNT(*) AS cnt FROM session_events WHERE session_id = ?"),t(e.checkDuplicate,`SELECT 1 FROM (
         SELECT type, data_hash FROM session_events
         WHERE session_id = ? ORDER BY id DESC LIMIT ?
       ) AS recent
       WHERE recent.type = ? AND recent.data_hash = ?
       LIMIT 1`),t(e.evictLowestPriority,`DELETE FROM session_events WHERE id = (
         SELECT id FROM session_events WHERE session_id = ?
         ORDER BY priority ASC, id ASC LIMIT 1
       )`),t(e.updateMetaLastEvent,`UPDATE session_meta
       SET last_event_at = datetime('now'), event_count = event_count + 1
       WHERE session_id = ?`),t(e.ensureSession,"INSERT OR IGNORE INTO session_meta (session_id, project_dir) VALUES (?, ?)"),t(e.getSessionStats,`SELECT session_id, project_dir, started_at, last_event_at, event_count, compact_count
       FROM session_meta WHERE session_id = ?`),t(e.incrementCompactCount,"UPDATE session_meta SET compact_count = compact_count + 1 WHERE session_id = ?"),t(e.upsertResume,`INSERT INTO session_resume (session_id, snapshot, event_count)
       VALUES (?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         snapshot = excluded.snapshot,
         event_count = excluded.event_count,
         created_at = datetime('now'),
         consumed = 0`),t(e.getResume,"SELECT snapshot, event_count, consumed FROM session_resume WHERE session_id = ?"),t(e.markResumeConsumed,"UPDATE session_resume SET consumed = 1 WHERE session_id = ?"),t(e.deleteEvents,"DELETE FROM session_events WHERE session_id = ?"),t(e.deleteMeta,"DELETE FROM session_meta WHERE session_id = ?"),t(e.deleteResume,"DELETE FROM session_resume WHERE session_id = ?"),t(e.getOldSessions,"SELECT session_id FROM session_meta WHERE started_at < datetime('now', ? || ' days')")}insertEvent(t,s,r="PostToolUse"){let i=y("sha256").update(s.data).digest("hex").slice(0,16).toUpperCase();this.db.transaction(()=>{if(this.stmt(e.checkDuplicate).get(t,M,s.type,i))return;this.stmt(e.getEventCount).get(t).cnt>=U&&this.stmt(e.evictLowestPriority).run(t),this.stmt(e.insertEvent).run(t,s.type,s.category,s.priority,s.data,r,i),this.stmt(e.updateMetaLastEvent).run(t)})()}getEvents(t,s){let r=s?.limit??1e3,i=s?.type,o=s?.minPriority;return i&&o!==void 0?this.stmt(e.getEventsByTypeAndPriority).all(t,i,o,r):i?this.stmt(e.getEventsByType).all(t,i,r):o!==void 0?this.stmt(e.getEventsByPriority).all(t,o,r):this.stmt(e.getEvents).all(t,r)}getEventCount(t){return this.stmt(e.getEventCount).get(t).cnt}ensureSession(t,s){this.stmt(e.ensureSession).run(t,s)}getSessionStats(t){return this.stmt(e.getSessionStats).get(t)??null}incrementCompactCount(t){this.stmt(e.incrementCompactCount).run(t)}upsertResume(t,s,r){this.stmt(e.upsertResume).run(t,s,r??0)}getResume(t){return this.stmt(e.getResume).get(t)??null}markResumeConsumed(t){this.stmt(e.markResumeConsumed).run(t)}deleteSession(t){this.db.transaction(()=>{this.stmt(e.deleteEvents).run(t),this.stmt(e.deleteResume).run(t),this.stmt(e.deleteMeta).run(t)})()}cleanupOldSessions(t=7){let s=`-${t}`,r=this.stmt(e.getOldSessions).all(s);for(let{session_id:i}of r)this.deleteSession(i);return r.length}};export{h as SessionDB,$ as getWorktreeSuffix};
