package beads

import (
	"context"
	"crypto/rand"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/mattn/go-sqlite3"
)

var doltliteIdentifier = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)

const doltliteDriverName = "sqlite3_doltlite"

func init() {
	sql.Register(doltliteDriverName, &sqlite3.SQLiteDriver{
		ConnectHook: func(conn *sqlite3.SQLiteConn) error {
			return conn.RegisterFunc("UUID", newDoltliteUUID, true)
		},
	})
}

func openDoltliteSQL(ctx context.Context, dir, database, branch string) (*sql.DB, error) {
	dsn, err := doltliteDSN(dir, database)
	if err != nil {
		return nil, err
	}
	db, err := sql.Open(doltliteDriverName, dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxIdleTime(0)
	db.SetConnMaxLifetime(0)
	if err := db.PingContext(ctx); err != nil {
		closeErr := db.Close()
		if closeErr != nil {
			return nil, fmt.Errorf("%w; close: %v", err, closeErr)
		}
		return nil, err
	}
	if branch = strings.TrimSpace(branch); branch != "" {
		if _, err := db.ExecContext(ctx, "SELECT dolt_checkout(?)", branch); err != nil {
			closeErr := db.Close()
			if closeErr != nil {
				return nil, fmt.Errorf("%w; close: %v", err, closeErr)
			}
			return nil, fmt.Errorf("doltlite: checkout branch %s: %w", branch, err)
		}
	}
	return db, nil
}

func doltliteDSN(dir, database string) (string, error) {
	database = strings.TrimSpace(database)
	if database == "" {
		database = "beads"
	}
	if !doltliteIdentifier.MatchString(database) {
		return "", fmt.Errorf("doltlite: invalid database name: %q", database)
	}
	path := filepath.Join(dir, database+".db")
	if os.PathSeparator == '\\' {
		path = strings.ReplaceAll(path, `\`, `/`)
	}
	return fmt.Sprintf("%s?_busy_timeout=10000", path), nil
}

func newDoltliteUUID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16]), nil
}
