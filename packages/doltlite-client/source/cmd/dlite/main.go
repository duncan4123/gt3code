package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/sfncore/t3code/packages/doltlite-client/client"
)

func main() {
	log.SetFlags(0)
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	switch os.Args[1] {
	case "info":
		runInfo(os.Args[2:])
	case "log":
		runLog(os.Args[2:])
	case "tables":
		runTables(os.Args[2:])
	case "query":
		runQuery(os.Args[2:])
	case "exec":
		runExec(os.Args[2:])
	case "script":
		runScript(os.Args[2:])
	default:
		usage()
		os.Exit(2)
	}
}

func runInfo(args []string) {
	fs := flag.NewFlagSet("info", flag.ExitOnError)
	jsonOut := fs.Bool("json", false, "output JSON")
	_ = fs.Parse(normalizeFlagArgs(args))
	dbPath := singleDBArg(fs)
	header, err := client.Header(dbPath)
	must(err)
	if *jsonOut {
		writeJSON(map[string]any{"path": dbPath, "header": header})
		return
	}
	fmt.Printf("path: %s\nheader: %s\n", dbPath, header)
}

func runLog(args []string) {
	fs := flag.NewFlagSet("log", flag.ExitOnError)
	limit := fs.Int("limit", 30, "limit commits, 0 = all")
	jsonOut := fs.Bool("json", false, "output JSON")
	_ = fs.Parse(normalizeFlagArgs(args))
	db := open(singleDBArg(fs))
	defer db.Close()
	commits, err := db.Log(context.Background(), *limit)
	must(err)
	if *jsonOut {
		writeJSON(map[string]any{"count": len(commits), "commits": commits})
		return
	}
	for _, commit := range commits {
		date := "(unknown date)"
		if !commit.Date.IsZero() {
			date = commit.Date.Format("2006-01-02 15:04:05")
		}
		author := strings.TrimSpace(commit.Committer)
		if commit.Email != "" {
			author += " <" + commit.Email + ">"
		}
		fmt.Printf("%s | %s | %s | %s\n", short(commit.Hash), date, author, commit.Message)
	}
}

func runTables(args []string) {
	fs := flag.NewFlagSet("tables", flag.ExitOnError)
	jsonOut := fs.Bool("json", false, "output JSON")
	_ = fs.Parse(normalizeFlagArgs(args))
	db := open(singleDBArg(fs))
	defer db.Close()
	tables, err := db.Tables(context.Background())
	must(err)
	if *jsonOut {
		writeJSON(map[string]any{"count": len(tables), "tables": tables})
		return
	}
	for _, table := range tables {
		fmt.Println(table)
	}
}

func runQuery(args []string) {
	fs := flag.NewFlagSet("query", flag.ExitOnError)
	jsonOut := fs.Bool("json", false, "output JSON")
	_ = fs.Parse(normalizeFlagArgs(args))
	if fs.NArg() < 2 {
		log.Fatal("usage: dlite query <db> <sql>")
	}
	db := open(fs.Arg(0))
	defer db.Close()
	rows, err := db.Query(context.Background(), strings.Join(fs.Args()[1:], " "))
	must(err)
	if *jsonOut {
		writeJSON(rows)
		return
	}
	for _, row := range rows {
		b, _ := json.Marshal(row)
		fmt.Println(string(b))
	}
}

func runExec(args []string) {
	fs := flag.NewFlagSet("exec", flag.ExitOnError)
	jsonOut := fs.Bool("json", false, "output JSON")
	_ = fs.Parse(normalizeFlagArgs(args))
	if fs.NArg() < 2 {
		log.Fatal("usage: dlite exec <db> <sql>")
	}
	db := open(fs.Arg(0))
	defer db.Close()
	result, err := db.Exec(context.Background(), strings.Join(fs.Args()[1:], " "))
	must(err)
	if *jsonOut {
		writeJSON(result)
		return
	}
	fmt.Printf("rows affected: %d\n", result.RowsAffected)
}

func runScript(args []string) {
	fs := flag.NewFlagSet("script", flag.ExitOnError)
	jsonOut := fs.Bool("json", false, "output JSON")
	_ = fs.Parse(normalizeFlagArgs(args))
	if fs.NArg() != 2 {
		log.Fatal("usage: dlite script <db> <sql-file>")
	}
	content, err := os.ReadFile(filepath.Clean(fs.Arg(1)))
	must(err)
	db := open(fs.Arg(0))
	defer db.Close()

	type statementResult struct {
		Statement string             `json:"statement"`
		Rows      []map[string]any   `json:"rows,omitempty"`
		Exec      *client.ExecResult `json:"exec,omitempty"`
	}
	var results []statementResult
	for _, statement := range splitSQLStatements(string(content)) {
		if statement == "" {
			continue
		}
		item := statementResult{Statement: statement}
		if statementReturnsRows(statement) && !statementShouldExec(statement) {
			rows, err := db.QueryAny(context.Background(), statement)
			must(err)
			item.Rows = rows
			if !*jsonOut {
				fmt.Printf("> %s\n", statement)
				for _, row := range rows {
					b, _ := json.Marshal(row)
					fmt.Println(string(b))
				}
			}
		} else {
			result, err := db.Exec(context.Background(), statement)
			must(err)
			item.Exec = &result
			if !*jsonOut {
				fmt.Printf("> %s\nrows affected: %d\n", statement, result.RowsAffected)
			}
		}
		results = append(results, item)
	}
	if *jsonOut {
		writeJSON(results)
	}
}

func open(path string) *client.DB {
	db, err := client.Open(context.Background(), path)
	must(err)
	return db
}

func singleDBArg(fs *flag.FlagSet) string {
	if fs.NArg() != 1 {
		log.Fatalf("usage: dlite %s <db>", fs.Name())
	}
	return fs.Arg(0)
}

func writeJSON(v any) {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	must(enc.Encode(v))
}

func short(hash string) string {
	if len(hash) <= 12 {
		return hash
	}
	return hash[:12]
}

func must(err error) {
	if err != nil {
		log.Fatal(err)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: dlite <info|log|tables|query|exec|script> ...")
}

func normalizeFlagArgs(args []string) []string {
	var flags []string
	var positional []string
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "--" {
			positional = append(positional, args[i+1:]...)
			break
		}
		if strings.HasPrefix(arg, "-") {
			flags = append(flags, arg)
			if !strings.Contains(arg, "=") && i+1 < len(args) && !strings.HasPrefix(args[i+1], "-") && flagNeedsValue(arg) {
				i++
				flags = append(flags, args[i])
			}
			continue
		}
		positional = append(positional, arg)
	}
	return append(flags, positional...)
}

func flagNeedsValue(flag string) bool {
	switch flag {
	case "--limit", "-limit":
		return true
	default:
		return false
	}
}

func statementReturnsRows(statement string) bool {
	trimmed := strings.TrimSpace(strings.ToLower(statement))
	return strings.HasPrefix(trimmed, "select ") || strings.HasPrefix(trimmed, "with ") || strings.HasPrefix(trimmed, "pragma ")
}

func statementShouldExec(statement string) bool {
	trimmed := strings.TrimSpace(strings.ToLower(statement))
	if !strings.HasPrefix(trimmed, "select ") {
		return false
	}
	for _, fn := range []string{
		"dolt_add(",
		"dolt_branch(",
		"dolt_checkout(",
		"dolt_cherry_pick(",
		"dolt_conflicts_resolve(",
		"dolt_gc(",
		"dolt_merge(",
		"dolt_pull(",
		"dolt_push(",
		"dolt_rebase(",
		"dolt_remote(",
		"dolt_reset(",
		"dolt_revert(",
		"dolt_tag(",
	} {
		if strings.Contains(trimmed, fn) {
			return true
		}
	}
	return false
}

func splitSQLStatements(script string) []string {
	var statements []string
	var current strings.Builder
	var quote rune
	escaped := false
	for _, ch := range script {
		current.WriteRune(ch)
		if quote != 0 {
			if escaped {
				escaped = false
				continue
			}
			if ch == '\\' {
				escaped = true
				continue
			}
			if ch == quote {
				quote = 0
			}
			continue
		}
		if ch == '\'' || ch == '"' || ch == '`' {
			quote = ch
			continue
		}
		if ch == ';' {
			statement := strings.TrimSpace(strings.TrimSuffix(current.String(), ";"))
			if statement != "" {
				statements = append(statements, statement)
			}
			current.Reset()
		}
	}
	tail := strings.TrimSpace(current.String())
	if tail != "" {
		statements = append(statements, tail)
	}
	return statements
}
