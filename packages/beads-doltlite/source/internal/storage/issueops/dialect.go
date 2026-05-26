package issueops

// SQLDialect captures the small expression differences between Dolt/MySQL SQL
// and SQLite-compatible engines such as doltlite.
type SQLDialect int

const (
	SQLDialectDolt SQLDialect = iota
	SQLDialectSQLite
)

func (d SQLDialect) CurrentTimestamp() string {
	if d == SQLDialectSQLite {
		return "CURRENT_TIMESTAMP"
	}
	return "UTC_TIMESTAMP()"
}

func (d SQLDialect) RecentCreatedAtExpr() string {
	if d == SQLDialectSQLite {
		return "strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-48 hours')"
	}
	return "DATE_SUB(NOW(), INTERVAL 48 HOUR)"
}

func (d SQLDialect) ChildIDLikeExpr() string {
	if d == SQLDialectSQLite {
		return "id LIKE (? || '.%')"
	}
	return "id LIKE CONCAT(?, '.%')"
}

func (d SQLDialect) MetadataEqualsExpr() string {
	if d == SQLDialectSQLite {
		return "REPLACE(REPLACE(REPLACE(metadata, ' ', ''), '\n', ''), '\t', '') LIKE ?"
	}
	return "JSON_UNQUOTE(JSON_EXTRACT(metadata, ?)) = ?"
}

func (d SQLDialect) MetadataExistsExpr() string {
	if d == SQLDialectSQLite {
		return "REPLACE(REPLACE(REPLACE(metadata, ' ', ''), '\n', ''), '\t', '') LIKE ?"
	}
	return "JSON_EXTRACT(metadata, ?) IS NOT NULL"
}

func (d SQLDialect) JSONArrayAggExpr(expr string) string {
	if d == SQLDialectSQLite {
		return "json_group_array(" + expr + ")"
	}
	return "JSON_ARRAYAGG(" + expr + ")"
}

func (d SQLDialect) DependencyJSONObjectExpr() string {
	if d == SQLDialectSQLite {
		return `json_object(
	'issue_id', issue_id,
	'depends_on_id', COALESCE(depends_on_issue_id, depends_on_wisp_id, depends_on_external),
	'type', type,
	'created_at', strftime('%Y-%m-%dT%H:%M:%SZ', created_at),
	'created_by', created_by,
	'metadata', metadata,
	'thread_id', thread_id
)`
	}
	return readyWorkDepJSONObject
}
