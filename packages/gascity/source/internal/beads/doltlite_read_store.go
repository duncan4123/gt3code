package beads

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

// DoltliteReadStore serves hot read paths in-process for bd/doltlite stores.
// Writes and less common operations delegate to the normal bd CLI store.
type DoltliteReadStore struct {
	*BdStore
	db *sql.DB
}

func (s *DoltliteReadStore) NeedsSessionTypeFallback() bool { return true }

type doltliteMetadata struct {
	Backend      string `json:"backend"`
	Database     string `json:"database"`
	DoltDatabase string `json:"dolt_database"`
}

func NewDoltliteReadStore(dir string, backing *BdStore) (*DoltliteReadStore, error) {
	meta, err := readDoltliteMetadata(dir)
	if err != nil {
		return nil, err
	}
	dbName := strings.TrimSpace(meta.DoltDatabase)
	if dbName == "" || dbName == "doltlite" {
		dbName = strings.TrimSpace(meta.Database)
	}
	if dbName == "" || dbName == "doltlite" {
		dbName = "hq"
	}
	dbPath := filepath.Join(dir, ".beads", "doltlite", dbName+".db")
	if _, err := os.Stat(dbPath); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite3", dbPath+"?_busy_timeout=10000")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(0)
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return &DoltliteReadStore{BdStore: backing, db: db}, nil
}

func readDoltliteMetadata(dir string) (doltliteMetadata, error) {
	var meta doltliteMetadata
	data, err := os.ReadFile(filepath.Join(dir, ".beads", "metadata.json"))
	if err != nil {
		return meta, err
	}
	if err := json.Unmarshal(data, &meta); err != nil {
		return meta, err
	}
	if strings.TrimSpace(meta.Backend) != "doltlite" && strings.TrimSpace(meta.Database) != "doltlite" {
		return meta, fmt.Errorf("not a doltlite beads store")
	}
	return meta, nil
}

func (s *DoltliteReadStore) CloseStore() error {
	if s.db != nil {
		return s.db.Close()
	}
	return nil
}

func (s *DoltliteReadStore) Get(id string) (Bead, error) {
	beads, err := s.queryIssues(ListQuery{AllowScan: true, IncludeClosed: true}, "i.id = ?", []any{id}, 1)
	if err != nil {
		return Bead{}, err
	}
	if len(beads) == 0 {
		return Bead{}, fmt.Errorf("getting bead %q: %w", id, ErrNotFound)
	}
	return beads[0], nil
}

func (s *DoltliteReadStore) List(query ListQuery) ([]Bead, error) {
	if !query.HasFilter() && !query.AllowScan {
		return nil, fmt.Errorf("bd list: %w", ErrQueryRequiresScan)
	}
	return s.queryIssues(query, "", nil, query.Limit)
}

func (s *DoltliteReadStore) ListOpen(status ...string) ([]Bead, error) {
	query := ListQuery{AllowScan: true}
	if len(status) > 0 {
		query.Status = strings.TrimSpace(status[0])
	}
	return s.List(query)
}

func (s *DoltliteReadStore) Children(parentID string, opts ...QueryOpt) ([]Bead, error) {
	return s.List(ListQuery{
		ParentID:      parentID,
		IncludeClosed: HasOpt(opts, IncludeClosed),
		AllowScan:     true,
		Sort:          SortCreatedAsc,
	})
}

func (s *DoltliteReadStore) ListByLabel(label string, limit int, opts ...QueryOpt) ([]Bead, error) {
	return s.List(ListQuery{
		Label:         label,
		Limit:         limit,
		IncludeClosed: HasOpt(opts, IncludeClosed),
	})
}

func (s *DoltliteReadStore) ListByAssignee(assignee, status string, limit int) ([]Bead, error) {
	return s.List(ListQuery{
		Assignee: assignee,
		Status:   status,
		Limit:    limit,
	})
}

func (s *DoltliteReadStore) ListByMetadata(filters map[string]string, limit int, opts ...QueryOpt) ([]Bead, error) {
	return s.List(ListQuery{
		Metadata:      filters,
		Limit:         limit,
		IncludeClosed: HasOpt(opts, IncludeClosed),
	})
}

func (s *DoltliteReadStore) Ready(query ...ReadyQuery) ([]Bead, error) {
	rq := readyQueryFromArgs(query)
	q := ListQuery{Status: "open", AllowScan: true, IncludeClosed: false, Limit: 0}
	if rq.Assignee != "" {
		q.Assignee = rq.Assignee
	}
	if rq.Limit > 0 {
		q.Limit = rq.Limit
	}
	beads, err := s.queryIssues(q, `NOT EXISTS (
		SELECT 1 FROM dependencies d
		JOIN issues blocker ON blocker.id = d.depends_on_id
		WHERE d.issue_id = i.id AND d.type = 'blocks' AND blocker.status != 'closed'
	)`, nil, 0)
	if err != nil {
		return nil, err
	}
	out := beads[:0]
	for _, b := range beads {
		if !IsReadyExcludedType(b.Type) {
			out = append(out, b)
		}
	}
	return out, nil
}

func (s *DoltliteReadStore) PoolDemandCount(template string) (int, error) {
	template = strings.TrimSpace(template)
	if template == "" {
		return 0, nil
	}
	query := `SELECT COUNT(*) FROM issues i
		WHERE json_extract(i.metadata, '$.gc.routed_to') = ?
		AND (i.assignee IS NULL OR i.assignee = '')
		AND (
			(i.status = 'in_progress')
			OR (i.status = 'open' AND i.issue_type = 'molecule')
			OR (
				i.status = 'open'
				AND i.issue_type NOT IN ('merge-request','gate','molecule','message','session','agent','role','rig')
				AND NOT EXISTS (
					SELECT 1 FROM dependencies d
					JOIN issues blocker ON blocker.id = d.depends_on_id
					WHERE d.issue_id = i.id AND d.type = 'blocks' AND blocker.status != 'closed'
				)
			)
		)`
	var count int
	if err := s.db.QueryRow(query, template).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

// DefaultWorkQueryHasReadyWork mirrors config.Agent.EffectiveWorkQuery for the
// built-in bd query without spawning bd. It is intentionally narrow: custom
// work_query commands still execute through the configured shell path.
func (s *DoltliteReadStore) DefaultWorkQueryHasReadyWork(targets []string, identities []string, includeRouted bool) (bool, error) {
	for _, identity := range compactStrings(identities) {
		ok, err := s.existsIssue(`i.status = 'in_progress' AND i.assignee = ?`, identity)
		if ok || err != nil {
			return ok, err
		}
		ok, err = s.existsReadyIssue(`i.assignee = ?`, identity)
		if ok || err != nil {
			return ok, err
		}
	}
	if !includeRouted {
		return false, nil
	}
	for _, target := range compactStrings(targets) {
		ok, err := s.existsReadyIssue(`json_extract(i.metadata, '$.gc.routed_to') = ? AND (i.assignee IS NULL OR i.assignee = '')`, target)
		if ok || err != nil {
			return ok, err
		}
		ok, err = s.existsIssue(`i.status = 'open' AND i.issue_type = 'molecule' AND json_extract(i.metadata, '$.gc.routed_to') = ? AND (i.assignee IS NULL OR i.assignee = '')`, target)
		if ok || err != nil {
			return ok, err
		}
	}
	return false, nil
}

func compactStrings(values []string) []string {
	out := values[:0]
	seen := map[string]bool{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}

func (s *DoltliteReadStore) existsReadyIssue(extraWhere string, args ...any) (bool, error) {
	return s.existsIssue(`i.status = 'open'
		AND i.issue_type NOT IN ('merge-request','gate','molecule','message','session','agent','role','rig')
		AND NOT EXISTS (
			SELECT 1 FROM dependencies d
			JOIN issues blocker ON blocker.id = d.depends_on_id
			WHERE d.issue_id = i.id AND d.type = 'blocks' AND blocker.status != 'closed'
		)
		AND `+extraWhere, args...)
}

func (s *DoltliteReadStore) existsIssue(where string, args ...any) (bool, error) {
	var found int
	err := s.db.QueryRow(`SELECT 1 FROM issues i WHERE `+where+` LIMIT 1`, args...).Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

func (s *DoltliteReadStore) DepList(id, direction string) ([]Dep, error) {
	if direction == "up" {
		return s.queryDeps("depends_on_id = ?", id)
	}
	return s.queryDeps("issue_id = ?", id)
}

func (s *DoltliteReadStore) DepListBatch(ids []string) (map[string][]Dep, error) {
	result := make(map[string][]Dep, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	for start := 0; start < len(ids); start += 500 {
		end := start + 500
		if end > len(ids) {
			end = len(ids)
		}
		placeholders := strings.TrimRight(strings.Repeat("?,", end-start), ",")
		args := make([]any, 0, end-start)
		for _, id := range ids[start:end] {
			args = append(args, id)
		}
		rows, err := s.db.Query(`SELECT issue_id, depends_on_id, type FROM dependencies WHERE issue_id IN (`+placeholders+`)`, args...)
		if err != nil {
			return result, err
		}
		for rows.Next() {
			dep, err := scanDep(rows)
			if err != nil {
				_ = rows.Close()
				return result, err
			}
			result[dep.IssueID] = append(result[dep.IssueID], dep)
		}
		if err := rows.Close(); err != nil {
			return result, err
		}
	}
	return result, nil
}

func (s *DoltliteReadStore) queryDeps(where, value string) ([]Dep, error) {
	rows, err := s.db.Query(`SELECT issue_id, depends_on_id, type FROM dependencies WHERE `+where, value)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var deps []Dep
	for rows.Next() {
		dep, err := scanDep(rows)
		if err != nil {
			return nil, err
		}
		deps = append(deps, dep)
	}
	return deps, rows.Err()
}

func scanDep(rows interface{ Scan(...any) error }) (Dep, error) {
	var dep Dep
	if err := rows.Scan(&dep.IssueID, &dep.DependsOnID, &dep.Type); err != nil {
		return dep, err
	}
	if dep.Type == "" {
		dep.Type = "blocks"
	}
	return dep, nil
}

func (s *DoltliteReadStore) queryIssues(query ListQuery, extraWhere string, extraArgs []any, limit int) ([]Bead, error) {
	where := []string{}
	args := []any{}
	if !query.IncludeClosed && query.Status != "closed" {
		where = append(where, "i.status != 'closed'")
	}
	if query.Status != "" {
		where = append(where, "i.status = ?")
		args = append(args, query.Status)
	}
	if query.Type != "" {
		where = append(where, "i.issue_type = ?")
		args = append(args, query.Type)
	}
	if query.Assignee != "" {
		where = append(where, "i.assignee = ?")
		args = append(args, query.Assignee)
	}
	if query.ParentID != "" {
		where = append(where, "pc.depends_on_id = ?")
		args = append(args, query.ParentID)
	}
	if query.Label != "" {
		where = append(where, "EXISTS (SELECT 1 FROM labels l WHERE l.issue_id = i.id AND l.label = ?)")
		args = append(args, query.Label)
	}
	for k, v := range query.Metadata {
		where = append(where, "json_extract(i.metadata, ?) = ?")
		args = append(args, "$."+k, v)
	}
	if !query.CreatedBefore.IsZero() {
		where = append(where, "i.created_at < ?")
		args = append(args, query.CreatedBefore.Format(time.RFC3339Nano))
	}
	if extraWhere != "" {
		where = append(where, extraWhere)
		args = append(args, extraArgs...)
	}
	sqlText := `SELECT i.id, i.title, i.status, i.issue_type, i.priority, i.created_at,
		COALESCE(i.assignee, ''), i.description, COALESCE(i.metadata, '{}'),
		COALESCE(pc.depends_on_id, '')
		FROM issues i
		LEFT JOIN dependencies pc ON pc.issue_id = i.id AND pc.type = 'parent-child'`
	if len(where) > 0 {
		sqlText += " WHERE " + strings.Join(where, " AND ")
	}
	if query.Sort == SortCreatedAsc {
		sqlText += " ORDER BY i.created_at ASC"
	} else {
		sqlText += " ORDER BY i.created_at DESC"
	}
	if limit > 0 {
		sqlText += fmt.Sprintf(" LIMIT %d", limit)
	}
	rows, err := s.db.Query(sqlText, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var beads []Bead
	for rows.Next() {
		b, err := scanBead(rows)
		if err != nil {
			return nil, err
		}
		beads = append(beads, b)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := s.hydrateLabels(beads); err != nil {
		return nil, err
	}
	return beads, nil
}

func scanBead(rows interface{ Scan(...any) error }) (Bead, error) {
	var (
		b           Bead
		priority    sql.NullInt64
		createdRaw  any
		metadataRaw string
	)
	if err := rows.Scan(&b.ID, &b.Title, &b.Status, &b.Type, &priority, &createdRaw, &b.Assignee, &b.Description, &metadataRaw, &b.ParentID); err != nil {
		return b, err
	}
	if priority.Valid {
		p := int(priority.Int64)
		b.Priority = &p
	}
	b.Status = mapBdStatus(b.Status)
	b.CreatedAt = parseDBTime(createdRaw).Truncate(time.Second)
	b.Metadata = parseMetadata(metadataRaw)
	if b.From == "" {
		b.From = b.Metadata["from"]
	}
	return b, nil
}

func parseDBTime(v any) time.Time {
	switch t := v.(type) {
	case time.Time:
		return t
	case string:
		return parseTimeString(t)
	case []byte:
		return parseTimeString(string(t))
	default:
		return time.Time{}
	}
}

func parseTimeString(s string) time.Time {
	s = strings.TrimSpace(s)
	for _, layout := range []string{
		time.RFC3339Nano,
		"2006-01-02 15:04:05.999999999-07:00",
		"2006-01-02 15:04:05.999999999",
		"2006-01-02 15:04:05",
	} {
		if t, err := time.Parse(layout, s); err == nil {
			return t
		}
	}
	return time.Time{}
}

func parseMetadata(raw string) map[string]string {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "{}" {
		return nil
	}
	var decoded map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
		return nil
	}
	out := make(map[string]string, len(decoded))
	for k, v := range decoded {
		var s string
		if err := json.Unmarshal(v, &s); err == nil {
			out[k] = s
		} else {
			out[k] = strings.TrimSpace(string(v))
		}
	}
	return out
}

func (s *DoltliteReadStore) hydrateLabels(beads []Bead) error {
	if len(beads) == 0 {
		return nil
	}
	byID := make(map[string]*Bead, len(beads))
	args := make([]any, 0, len(beads))
	for i := range beads {
		byID[beads[i].ID] = &beads[i]
		args = append(args, beads[i].ID)
	}
	placeholders := strings.TrimRight(strings.Repeat("?,", len(args)), ",")
	rows, err := s.db.Query(`SELECT issue_id, label FROM labels WHERE issue_id IN (`+placeholders+`)`, args...)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id, label string
		if err := rows.Scan(&id, &label); err != nil {
			return err
		}
		if b := byID[id]; b != nil {
			b.Labels = append(b.Labels, label)
		}
	}
	for i := range beads {
		sort.Strings(beads[i].Labels)
	}
	return rows.Err()
}
