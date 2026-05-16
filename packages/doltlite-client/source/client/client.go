package client

import (
	"context"
	"database/sql"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/mattn/go-sqlite3"
)

const driverName = "t3_doltlite"

func init() {
	sql.Register(driverName, &sqlite3.SQLiteDriver{})
}

type DB struct {
	sql *sql.DB
}

type Commit struct {
	Hash      string    `json:"hash"`
	Committer string    `json:"committer"`
	Email     string    `json:"email"`
	Date      time.Time `json:"date"`
	Message   string    `json:"message"`
}

type ExecResult struct {
	RowsAffected int64 `json:"rowsAffected"`
}

func Open(ctx context.Context, path string) (*DB, error) {
	if path == "" {
		return nil, fmt.Errorf("empty database path")
	}
	db, err := sql.Open(driverName, path+"?_busy_timeout=10000")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return &DB{sql: db}, nil
}

func (db *DB) Close() error {
	return db.sql.Close()
}

func (db *DB) Log(ctx context.Context, limit int) ([]Commit, error) {
	query := "SELECT commit_hash, committer, email, date, message FROM dolt_log ORDER BY date DESC"
	var args []any
	if limit > 0 {
		query += " LIMIT ?"
		args = append(args, limit)
	}
	rows, err := db.sql.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var commits []Commit
	for rows.Next() {
		var commit Commit
		var date any
		if err := rows.Scan(&commit.Hash, &commit.Committer, &commit.Email, &date, &commit.Message); err != nil {
			return nil, err
		}
		commit.Date = parseTime(date)
		commits = append(commits, commit)
	}
	return commits, rows.Err()
}

func (db *DB) Tables(ctx context.Context) ([]string, error) {
	rows, err := db.sql.QueryContext(ctx, "SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tables []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		tables = append(tables, name)
	}
	return tables, rows.Err()
}

func (db *DB) Exec(ctx context.Context, statement string) (ExecResult, error) {
	result, err := db.sql.ExecContext(ctx, statement)
	if err != nil {
		return ExecResult{}, err
	}
	rowsAffected, _ := result.RowsAffected()
	return ExecResult{RowsAffected: rowsAffected}, nil
}

func (db *DB) Query(ctx context.Context, query string) ([]map[string]any, error) {
	if !isReadOnlyQuery(query) {
		return nil, fmt.Errorf("only read-only SELECT/WITH/PRAGMA queries are allowed")
	}
	return db.QueryAny(ctx, query)
}

func (db *DB) QueryAny(ctx context.Context, query string) ([]map[string]any, error) {
	rows, err := db.sql.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	values := make([]any, len(cols))
	ptrs := make([]any, len(cols))
	for i := range values {
		ptrs[i] = &values[i]
	}

	var out []map[string]any
	for rows.Next() {
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		row := make(map[string]any, len(cols))
		for i, col := range cols {
			row[col] = normalizeValue(values[i])
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func Header(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	buf := make([]byte, 8)
	n, err := f.Read(buf)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(buf[:n]), nil
}

func parseTime(v any) time.Time {
	switch t := v.(type) {
	case time.Time:
		return t
	case string:
		for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02 15:04:05.999999999-07:00", "2006-01-02 15:04:05"} {
			if parsed, err := time.Parse(layout, t); err == nil {
				return parsed
			}
		}
	case []byte:
		return parseTime(string(t))
	}
	return time.Time{}
}

func normalizeValue(v any) any {
	switch t := v.(type) {
	case []byte:
		return string(t)
	default:
		return t
	}
}

func isReadOnlyQuery(query string) bool {
	q := strings.TrimSpace(strings.ToLower(query))
	return strings.HasPrefix(q, "select ") || strings.HasPrefix(q, "with ") || strings.HasPrefix(q, "pragma ")
}
