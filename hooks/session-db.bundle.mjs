import{createHash as M}from"node:crypto";import{createRequire as P}from"node:module";import{unlinkSync as F,existsSync as m,mkdirSync as k,copyFileSync as R,readFileSync as C}from"node:fs";import{tmpdir as x}from"node:os";import{join as d,dirname as y}from"node:path";import{fileURLToPath as B}from"node:url";var g=null;function N(r){let t=d(y(r),".doltlite-version");if(!m(t))return null;try{return JSON.parse(C(t,"utf8"))}catch{return null}}function v(r){return M("sha256").update(C(r)).digest("hex")}function j(r,t){return!r||!t?!1:r.commit===t.commit&&r.libBuilt===t.libBuilt&&r.addonBuilt===t.addonBuilt}function X(r,t){if(!m(r)||!m(t))return!0;let e=N(r),n=N(t);if(e||n)return!j(e,n);try{return v(r)!==v(t)}catch{return!0}}function H(){if(!g){let r=P(import.meta.url);if(!globalThis.__DOLTLITE_NATIVE_PATH){let t=y(B(import.meta.url)),e=process.versions.modules,n=d(t,"prebuilds",`${process.platform}-${process.arch}`,`node.abi${e}.node`),i=d(y(n),".doltlite-version"),o=d(t,"vendor","better-sqlite3","build","Release"),u=d(o,"better_sqlite3.node");m(n)&&(X(n,u)&&(k(o,{recursive:!0}),R(n,u),m(i)&&R(i,d(o,".doltlite-version"))),globalThis.__DOLTLITE_NATIVE_PATH=u)}try{g=r("./vendor/better-sqlite3")}catch(t){throw t}}return g}function W(r){try{r.prepare("SELECT doltlite_engine()").get();return}catch{}r.pragma("journal_mode = WAL"),r.pragma("synchronous = NORMAL")}function Y(r){for(let t of["","-wal","-shm"])try{F(r+t)}catch{}}function D(r){try{(()=>{try{return r.prepare("SELECT doltlite_engine()").get(),!0}catch{return!1}})()||r.pragma("wal_checkpoint(TRUNCATE)")}catch{}try{r.close()}catch{}}function O(r="context-mode"){return d(x(),`${r}-${process.pid}.db`)}function V(r,t=[100,500,2e3]){let e;for(let n=0;n<=t.length;n++)try{return r()}catch(i){let o=i instanceof Error?i.message:String(i);if(!o.includes("SQLITE_BUSY")&&!o.includes("database is locked"))throw i;if(e=i instanceof Error?i:new Error(o),n<t.length){let u=t[n],c=Date.now();for(;Date.now()-c<u;);}}throw new Error(`SQLITE_BUSY: database is locked after ${t.length} retries. Original error: ${e?.message}`)}var _=Symbol.for("__context_mode_live_dbs__"),h=(()=>{let r=globalThis;return r[_]||(r[_]=new Set,process.on("exit",()=>{for(let t of r[_])try{t.close()}catch{}r[_].clear()})),r[_]})(),p=class{#e;#t;constructor(t){let e=H();this.#e=t,this.#t=new e(t,{timeout:3e4}),h.add(this.#t),W(this.#t),this.initSchema(),this.prepareStatements()}get db(){return this.#t}get dbPath(){return this.#e}close(){h.delete(this.#t),D(this.#t)}withRetry(t){return V(t)}cleanup(){h.delete(this.#t),D(this.#t),Y(this.#e)}};import{createHash as L}from"node:crypto";import{execFileSync as G}from"node:child_process";var l;function rt(){let r=process.env.CONTEXT_MODE_SESSION_SUFFIX,t=process.cwd();if(l&&l.cwd===t&&l.envSuffix===r)return l.suffix;let e="";if(r!==void 0)e=r?`__${r}`:"";else try{let n=G("git",["worktree","list","--porcelain"],{encoding:"utf-8",timeout:2e3,stdio:["ignore","pipe","ignore"]}).split(/\r?\n/).find(i=>i.startsWith("worktree "))?.replace("worktree ","")?.trim();n&&t!==n&&(e=`__${L("sha256").update(t).digest("hex").slice(0,8)}`)}catch{}return l={cwd:t,envSuffix:r,suffix:e},e}function it(){l=void 0}var A=1e3,I=5,s={insertEvent:"insertEvent",getEvents:"getEvents",getEventsByType:"getEventsByType",getEventsByPriority:"getEventsByPriority",getEventsByTypeAndPriority:"getEventsByTypeAndPriority",getEventCount:"getEventCount",getLatestAttributedProject:"getLatestAttributedProject",checkDuplicate:"checkDuplicate",evictLowestPriority:"evictLowestPriority",updateMetaLastEvent:"updateMetaLastEvent",ensureSession:"ensureSession",getSessionStats:"getSessionStats",incrementCompactCount:"incrementCompactCount",upsertResume:"upsertResume",getResume:"getResume",markResumeConsumed:"markResumeConsumed",deleteEvents:"deleteEvents",deleteMeta:"deleteMeta",deleteResume:"deleteResume",getOldSessions:"getOldSessions",searchEvents:"searchEvents",incrementToolCall:"incrementToolCall",getToolCallTotals:"getToolCallTotals",getToolCallByTool:"getToolCallByTool"},w=class extends p{constructor(t){super(t?.dbPath??O("session"))}stmt(t){return this.stmts.get(t)}initSchema(){try{let e=this.db.pragma("table_xinfo(session_events)").find(n=>n.name==="data_hash");e&&e.hidden!==0&&this.db.exec("DROP TABLE session_events")}catch{}this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        category TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 2,
        data TEXT NOT NULL,
        project_dir TEXT NOT NULL DEFAULT '',
        attribution_source TEXT NOT NULL DEFAULT 'unknown',
        attribution_confidence REAL NOT NULL DEFAULT 0,
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

      CREATE TABLE IF NOT EXISTS tool_calls (
        session_id TEXT NOT NULL,
        tool TEXT NOT NULL,
        calls INTEGER NOT NULL DEFAULT 0,
        bytes_returned INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (session_id, tool)
      );

      CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);
    `);try{let t=this.db.pragma("table_xinfo(session_events)"),e=new Set(t.map(n=>n.name));e.has("project_dir")||this.db.exec("ALTER TABLE session_events ADD COLUMN project_dir TEXT NOT NULL DEFAULT ''"),e.has("attribution_source")||this.db.exec("ALTER TABLE session_events ADD COLUMN attribution_source TEXT NOT NULL DEFAULT 'unknown'"),e.has("attribution_confidence")||this.db.exec("ALTER TABLE session_events ADD COLUMN attribution_confidence REAL NOT NULL DEFAULT 0"),this.db.exec("CREATE INDEX IF NOT EXISTS idx_session_events_project ON session_events(session_id, project_dir)")}catch{}}prepareStatements(){this.stmts=new Map;let t=(e,n)=>{this.stmts.set(e,this.db.prepare(n))};t(s.insertEvent,`INSERT INTO session_events (
         session_id, type, category, priority, data,
         project_dir, attribution_source, attribution_confidence,
         source_hook, data_hash
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),t(s.getEvents,`SELECT id, session_id, type, category, priority, data,
              project_dir, attribution_source, attribution_confidence,
              source_hook, created_at, data_hash
       FROM session_events WHERE session_id = ? ORDER BY id ASC LIMIT ?`),t(s.getEventsByType,`SELECT id, session_id, type, category, priority, data,
              project_dir, attribution_source, attribution_confidence,
              source_hook, created_at, data_hash
       FROM session_events WHERE session_id = ? AND type = ? ORDER BY id ASC LIMIT ?`),t(s.getEventsByPriority,`SELECT id, session_id, type, category, priority, data,
              project_dir, attribution_source, attribution_confidence,
              source_hook, created_at, data_hash
       FROM session_events WHERE session_id = ? AND priority >= ? ORDER BY id ASC LIMIT ?`),t(s.getEventsByTypeAndPriority,`SELECT id, session_id, type, category, priority, data,
              project_dir, attribution_source, attribution_confidence,
              source_hook, created_at, data_hash
       FROM session_events WHERE session_id = ? AND type = ? AND priority >= ? ORDER BY id ASC LIMIT ?`),t(s.getEventCount,"SELECT COUNT(*) AS cnt FROM session_events WHERE session_id = ?"),t(s.getLatestAttributedProject,`SELECT project_dir
       FROM session_events
       WHERE session_id = ? AND project_dir != ''
       ORDER BY id DESC
       LIMIT 1`),t(s.checkDuplicate,`SELECT 1 FROM (
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
         consumed = 0`),t(s.getResume,"SELECT snapshot, event_count, consumed FROM session_resume WHERE session_id = ?"),t(s.markResumeConsumed,"UPDATE session_resume SET consumed = 1 WHERE session_id = ?"),t(s.deleteEvents,"DELETE FROM session_events WHERE session_id = ?"),t(s.deleteMeta,"DELETE FROM session_meta WHERE session_id = ?"),t(s.deleteResume,"DELETE FROM session_resume WHERE session_id = ?"),t(s.searchEvents,`SELECT id, session_id, category, type, data, created_at
       FROM session_events
       WHERE project_dir = ?
         AND (data LIKE '%' || ? || '%' ESCAPE '\\' OR category LIKE '%' || ? || '%' ESCAPE '\\')
         AND (? IS NULL OR category = ?)
       ORDER BY id ASC
       LIMIT ?`),t(s.getOldSessions,"SELECT session_id FROM session_meta WHERE started_at < datetime('now', ? || ' days')"),t(s.incrementToolCall,`INSERT INTO tool_calls (session_id, tool, calls, bytes_returned)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(session_id, tool) DO UPDATE SET
         calls = calls + 1,
         bytes_returned = bytes_returned + excluded.bytes_returned,
         updated_at = datetime('now')`),t(s.getToolCallTotals,`SELECT COALESCE(SUM(calls), 0) AS calls,
              COALESCE(SUM(bytes_returned), 0) AS bytes_returned
       FROM tool_calls WHERE session_id = ?`),t(s.getToolCallByTool,`SELECT tool, calls, bytes_returned
       FROM tool_calls WHERE session_id = ? ORDER BY calls DESC`)}insertEvent(t,e,n="PostToolUse",i){let o=L("sha256").update(e.data).digest("hex").slice(0,16).toUpperCase(),u=String(i?.projectDir??e.project_dir??"").trim(),c=String(i?.source??e.attribution_source??"unknown"),a=Number(i?.confidence??e.attribution_confidence??0),T=Number.isFinite(a)?Math.max(0,Math.min(1,a)):0,E=this.db.transaction(()=>{if(this.stmt(s.checkDuplicate).get(t,I,e.type,o))return;this.stmt(s.getEventCount).get(t).cnt>=A&&this.stmt(s.evictLowestPriority).run(t),this.stmt(s.insertEvent).run(t,e.type,e.category,e.priority,e.data,u,c,T,n,o),this.stmt(s.updateMetaLastEvent).run(t)});this.withRetry(()=>E())}bulkInsertEvents(t,e,n="PostToolUse",i){if(!e||e.length===0)return;if(e.length===1){this.insertEvent(t,e[0],n,i?.[0]);return}let o=e.map((c,a)=>{let T=L("sha256").update(c.data).digest("hex").slice(0,16).toUpperCase(),E=i?.[a],S=String(E?.projectDir??c.project_dir??"").trim(),b=String(E?.source??c.attribution_source??"unknown"),f=Number(E?.confidence??c.attribution_confidence??0),U=Number.isFinite(f)?Math.max(0,Math.min(1,f)):0;return{event:c,dataHash:T,projectDir:S,attributionSource:b,attributionConfidence:U}}),u=this.db.transaction(()=>{let c=this.stmt(s.getEventCount).get(t).cnt;for(let a of o)this.stmt(s.checkDuplicate).get(t,I,a.event.type,a.dataHash)||(c>=A?this.stmt(s.evictLowestPriority).run(t):c++,this.stmt(s.insertEvent).run(t,a.event.type,a.event.category,a.event.priority,a.event.data,a.projectDir,a.attributionSource,a.attributionConfidence,n,a.dataHash));this.stmt(s.updateMetaLastEvent).run(t)});this.withRetry(()=>u())}getEvents(t,e){let n=e?.limit??1e3,i=e?.type,o=e?.minPriority;return i&&o!==void 0?this.stmt(s.getEventsByTypeAndPriority).all(t,i,o,n):i?this.stmt(s.getEventsByType).all(t,i,n):o!==void 0?this.stmt(s.getEventsByPriority).all(t,o,n):this.stmt(s.getEvents).all(t,n)}getEventCount(t){return this.stmt(s.getEventCount).get(t).cnt}getLatestAttributedProjectDir(t){return this.stmt(s.getLatestAttributedProject).get(t)?.project_dir||null}searchEvents(t,e,n,i){try{let o=t.replace(/[%_]/g,c=>"\\"+c),u=i??null;return this.stmt(s.searchEvents).all(n,o,o,u,u,e)}catch{return[]}}ensureSession(t,e){this.stmt(s.ensureSession).run(t,e)}getSessionStats(t){return this.stmt(s.getSessionStats).get(t)??null}incrementCompactCount(t){this.stmt(s.incrementCompactCount).run(t)}upsertResume(t,e,n){this.stmt(s.upsertResume).run(t,e,n??0)}getResume(t){return this.stmt(s.getResume).get(t)??null}markResumeConsumed(t){this.stmt(s.markResumeConsumed).run(t)}getLatestSessionId(){try{return this.db.prepare("SELECT session_id FROM session_meta ORDER BY started_at DESC LIMIT 1").get()?.session_id??null}catch{return null}}incrementToolCall(t,e,n=0){let i=Number.isFinite(n)&&n>0?Math.round(n):0;try{this.stmt(s.incrementToolCall).run(t,e,i)}catch{}}getToolCallStats(t){try{let e=this.stmt(s.getToolCallTotals).get(t),n=this.stmt(s.getToolCallByTool).all(t),i={};for(let o of n)i[o.tool]={calls:o.calls,bytesReturned:o.bytes_returned};return{totalCalls:e?.calls??0,totalBytesReturned:e?.bytes_returned??0,byTool:i}}catch{return{totalCalls:0,totalBytesReturned:0,byTool:{}}}}deleteSession(t){this.db.transaction(()=>{this.stmt(s.deleteEvents).run(t),this.stmt(s.deleteResume).run(t),this.stmt(s.deleteMeta).run(t)})()}cleanupOldSessions(t=7){let e=`-${t}`,n=this.stmt(s.getOldSessions).all(e);for(let{session_id:i}of n)this.deleteSession(i);return n.length}};export{w as SessionDB,it as _resetWorktreeSuffixCacheForTests,rt as getWorktreeSuffix};
