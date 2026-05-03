import{createHash as F}from"node:crypto";import{createRequire as k}from"node:module";import{unlinkSync as x,existsSync as l,mkdirSync as B,copyFileSync as R,readFileSync as A}from"node:fs";import{tmpdir as j}from"node:os";import{join as d,dirname as m}from"node:path";import{fileURLToPath as v}from"node:url";var h=null;function N(n){let t=d(m(n),".doltlite-version");if(!l(t))return null;try{return JSON.parse(A(t,"utf8"))}catch{return null}}function O(n){return F("sha256").update(A(n)).digest("hex")}function X(n,t){return!n||!t?!1:n.commit===t.commit&&n.libBuilt===t.libBuilt&&n.addonBuilt===t.addonBuilt}function H(n,t){if(!l(n)||!l(t))return!0;let e=N(n),r=N(t);if(e||r)return!X(e,r);try{return O(n)!==O(t)}catch{return!0}}function D(n){let t=[process.env.CONTEXT_MODE_PLUGIN_ROOT,n,m(n)].filter(e=>!!e);for(let e of t)if(l(d(e,"vendor","better-sqlite3")))return e;return n}function W(){if(!h){let n=k(import.meta.url);if(!globalThis.__DOLTLITE_NATIVE_PATH){let t=m(v(import.meta.url)),e=D(t),r=process.versions.modules,i=d(e,"prebuilds",`${process.platform}-${process.arch}`,`node.abi${r}.node`),o=d(m(i),".doltlite-version"),u=d(e,"vendor","better-sqlite3","build","Release"),a=d(u,"better_sqlite3.node");l(i)&&(H(i,a)&&(B(u,{recursive:!0}),R(i,a),l(o)&&R(o,d(u,".doltlite-version"))),globalThis.__DOLTLITE_NATIVE_PATH=a)}try{let t=m(v(import.meta.url)),e=D(t);h=n(d(e,"vendor","better-sqlite3"))}catch(t){throw t}}return h}function Y(n){try{n.prepare("SELECT doltlite_engine()").get();return}catch{}n.pragma("journal_mode = WAL"),n.pragma("synchronous = NORMAL")}function V(n){for(let t of["","-wal","-shm"])try{x(n+t)}catch{}}function C(n){try{(()=>{try{return n.prepare("SELECT doltlite_engine()").get(),!0}catch{return!1}})()||n.pragma("wal_checkpoint(TRUNCATE)")}catch{}try{n.close()}catch{}}function I(n="context-mode"){return d(j(),`${n}-${process.pid}.db`)}function G(n,t=[100,500,2e3]){let e;for(let r=0;r<=t.length;r++)try{return n()}catch(i){let o=i instanceof Error?i.message:String(i);if(!o.includes("SQLITE_BUSY")&&!o.includes("database is locked"))throw i;if(e=i instanceof Error?i:new Error(o),r<t.length){let u=t[r],a=Date.now();for(;Date.now()-a<u;);}}throw new Error(`SQLITE_BUSY: database is locked after ${t.length} retries. Original error: ${e?.message}`)}var T=Symbol.for("__context_mode_live_dbs__"),y=(()=>{let n=globalThis;return n[T]||(n[T]=new Set,process.on("exit",()=>{for(let t of n[T])try{t.close()}catch{}n[T].clear()})),n[T]})(),g=class{#e;#t;constructor(t){let e=W();this.#e=t,this.#t=new e(t,{timeout:3e4}),y.add(this.#t),Y(this.#t),this.initSchema(),this.prepareStatements()}get db(){return this.#t}get dbPath(){return this.#e}close(){y.delete(this.#t),C(this.#t)}withRetry(t){return G(t)}cleanup(){y.delete(this.#t),C(this.#t),V(this.#e)}};import{createHash as L}from"node:crypto";import{execFileSync as $}from"node:child_process";var E;function it(){let n=process.env.CONTEXT_MODE_SESSION_SUFFIX,t=process.cwd();if(E&&E.cwd===t&&E.envSuffix===n)return E.suffix;let e="";if(n!==void 0)e=n?`__${n}`:"";else try{let r=$("git",["worktree","list","--porcelain"],{encoding:"utf-8",timeout:2e3,stdio:["ignore","pipe","ignore"]}).split(/\r?\n/).find(i=>i.startsWith("worktree "))?.replace("worktree ","")?.trim();r&&t!==r&&(e=`__${L("sha256").update(t).digest("hex").slice(0,8)}`)}catch{}return E={cwd:t,envSuffix:n,suffix:e},e}function ot(){E=void 0}var w=1e3,U=5,s={insertEvent:"insertEvent",getEvents:"getEvents",getEventsByType:"getEventsByType",getEventsByPriority:"getEventsByPriority",getEventsByTypeAndPriority:"getEventsByTypeAndPriority",getEventCount:"getEventCount",getLatestAttributedProject:"getLatestAttributedProject",checkDuplicate:"checkDuplicate",evictLowestPriority:"evictLowestPriority",updateMetaLastEvent:"updateMetaLastEvent",ensureSession:"ensureSession",getSessionStats:"getSessionStats",incrementCompactCount:"incrementCompactCount",upsertResume:"upsertResume",getResume:"getResume",markResumeConsumed:"markResumeConsumed",deleteEvents:"deleteEvents",deleteMeta:"deleteMeta",deleteResume:"deleteResume",getOldSessions:"getOldSessions",searchEvents:"searchEvents",incrementToolCall:"incrementToolCall",getToolCallTotals:"getToolCallTotals",getToolCallByTool:"getToolCallByTool"},M=class extends g{constructor(t){super(t?.dbPath??I("session"))}stmt(t){return this.stmts.get(t)}initSchema(){try{let e=this.db.pragma("table_xinfo(session_events)").find(r=>r.name==="data_hash");e&&e.hidden!==0&&this.db.exec("DROP TABLE session_events")}catch{}this.db.exec(`
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
    `);try{let t=this.db.pragma("table_xinfo(session_events)"),e=new Set(t.map(r=>r.name));e.has("project_dir")||this.db.exec("ALTER TABLE session_events ADD COLUMN project_dir TEXT NOT NULL DEFAULT ''"),e.has("attribution_source")||this.db.exec("ALTER TABLE session_events ADD COLUMN attribution_source TEXT NOT NULL DEFAULT 'unknown'"),e.has("attribution_confidence")||this.db.exec("ALTER TABLE session_events ADD COLUMN attribution_confidence REAL NOT NULL DEFAULT 0"),this.db.exec("CREATE INDEX IF NOT EXISTS idx_session_events_project ON session_events(session_id, project_dir)")}catch{}}prepareStatements(){this.stmts=new Map;let t=(e,r)=>{this.stmts.set(e,this.db.prepare(r))};t(s.insertEvent,`INSERT INTO session_events (
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
       FROM tool_calls WHERE session_id = ? ORDER BY calls DESC`)}insertEvent(t,e,r="PostToolUse",i){let o=L("sha256").update(e.data).digest("hex").slice(0,16).toUpperCase(),u=String(i?.projectDir??e.project_dir??"").trim(),a=String(i?.source??e.attribution_source??"unknown"),c=Number(i?.confidence??e.attribution_confidence??0),p=Number.isFinite(c)?Math.max(0,Math.min(1,c)):0,_=this.db.transaction(()=>{if(this.stmt(s.checkDuplicate).get(t,U,e.type,o))return;this.stmt(s.getEventCount).get(t).cnt>=w&&this.stmt(s.evictLowestPriority).run(t),this.stmt(s.insertEvent).run(t,e.type,e.category,e.priority,e.data,u,a,p,r,o),this.stmt(s.updateMetaLastEvent).run(t)});this.withRetry(()=>_())}bulkInsertEvents(t,e,r="PostToolUse",i){if(!e||e.length===0)return;if(e.length===1){this.insertEvent(t,e[0],r,i?.[0]);return}let o=e.map((a,c)=>{let p=L("sha256").update(a.data).digest("hex").slice(0,16).toUpperCase(),_=i?.[c],f=String(_?.projectDir??a.project_dir??"").trim(),S=String(_?.source??a.attribution_source??"unknown"),b=Number(_?.confidence??a.attribution_confidence??0),P=Number.isFinite(b)?Math.max(0,Math.min(1,b)):0;return{event:a,dataHash:p,projectDir:f,attributionSource:S,attributionConfidence:P}}),u=this.db.transaction(()=>{let a=this.stmt(s.getEventCount).get(t).cnt;for(let c of o)this.stmt(s.checkDuplicate).get(t,U,c.event.type,c.dataHash)||(a>=w?this.stmt(s.evictLowestPriority).run(t):a++,this.stmt(s.insertEvent).run(t,c.event.type,c.event.category,c.event.priority,c.event.data,c.projectDir,c.attributionSource,c.attributionConfidence,r,c.dataHash));this.stmt(s.updateMetaLastEvent).run(t)});this.withRetry(()=>u())}getEvents(t,e){let r=e?.limit??1e3,i=e?.type,o=e?.minPriority;return i&&o!==void 0?this.stmt(s.getEventsByTypeAndPriority).all(t,i,o,r):i?this.stmt(s.getEventsByType).all(t,i,r):o!==void 0?this.stmt(s.getEventsByPriority).all(t,o,r):this.stmt(s.getEvents).all(t,r)}getEventCount(t){return this.stmt(s.getEventCount).get(t).cnt}getLatestAttributedProjectDir(t){return this.stmt(s.getLatestAttributedProject).get(t)?.project_dir||null}searchEvents(t,e,r,i){try{let o=t.replace(/[%_]/g,a=>"\\"+a),u=i??null;return this.stmt(s.searchEvents).all(r,o,o,u,u,e)}catch{return[]}}ensureSession(t,e){this.stmt(s.ensureSession).run(t,e)}getSessionStats(t){return this.stmt(s.getSessionStats).get(t)??null}incrementCompactCount(t){this.stmt(s.incrementCompactCount).run(t)}upsertResume(t,e,r){this.stmt(s.upsertResume).run(t,e,r??0)}getResume(t){return this.stmt(s.getResume).get(t)??null}markResumeConsumed(t){this.stmt(s.markResumeConsumed).run(t)}getLatestSessionId(){try{return this.db.prepare("SELECT session_id FROM session_meta ORDER BY started_at DESC LIMIT 1").get()?.session_id??null}catch{return null}}incrementToolCall(t,e,r=0){let i=Number.isFinite(r)&&r>0?Math.round(r):0;try{this.stmt(s.incrementToolCall).run(t,e,i)}catch{}}getToolCallStats(t){try{let e=this.stmt(s.getToolCallTotals).get(t),r=this.stmt(s.getToolCallByTool).all(t),i={};for(let o of r)i[o.tool]={calls:o.calls,bytesReturned:o.bytes_returned};return{totalCalls:e?.calls??0,totalBytesReturned:e?.bytes_returned??0,byTool:i}}catch{return{totalCalls:0,totalBytesReturned:0,byTool:{}}}}deleteSession(t){this.db.transaction(()=>{this.stmt(s.deleteEvents).run(t),this.stmt(s.deleteResume).run(t),this.stmt(s.deleteMeta).run(t)})()}cleanupOldSessions(t=7){let e=`-${t}`,r=this.stmt(s.getOldSessions).all(e);for(let{session_id:i}of r)this.deleteSession(i);return r.length}};export{M as SessionDB,ot as _resetWorktreeSuffixCacheForTests,it as getWorktreeSuffix};
