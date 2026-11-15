package main

import (
	"archive/zip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBackupRestoreRoundtrip(t *testing.T) {
	dir := t.TempDir()
	oldWd, _ := os.Getwd()
	defer os.Chdir(oldWd)
	os.Chdir(dir)

	sess := &Session{ID: "s1", StoreDir: "store/sessions/s1"}
	os.MkdirAll(sess.StoreDir, 0755)
	os.WriteFile(filepath.Join(sess.StoreDir, "whatsapp.db"), []byte("device-creds"), 0644)
	os.WriteFile(filepath.Join(sess.StoreDir, "messages.db"), []byte("messages"), 0644)
	os.WriteFile(filepath.Join(sess.StoreDir, "messages.db-wal"), []byte("skipme"), 0644)

	path, err := backupSessionStore(sess)
	if err != nil {
		t.Fatalf("backup: %v", err)
	}
	// WAL skipped
	zr, _ := zip.OpenReader(path)
	defer zr.Close()
	for _, f := range zr.File {
		if strings.HasSuffix(f.Name, "-wal") {
			t.Fatalf("WAL file should not be backed up")
		}
	}

	os.WriteFile(filepath.Join(sess.StoreDir, "whatsapp.db"), []byte("corrupted"), 0644)
	if err := restoreSessionStore(sess, path); err != nil {
		t.Fatalf("restore: %v", err)
	}
	got, _ := os.ReadFile(filepath.Join(sess.StoreDir, "whatsapp.db"))
	if string(got) != "device-creds" {
		t.Fatalf("restore content mismatch: %q", got)
	}
}

func TestRestoreRejectsOutsidePath(t *testing.T) {
	dir := t.TempDir()
	oldWd, _ := os.Getwd()
	defer os.Chdir(oldWd)
	os.Chdir(dir)

	sess := &Session{ID: "s1", StoreDir: "store/sessions/s1"}
	os.MkdirAll(sess.StoreDir, 0755)
	os.MkdirAll("store/backups", 0755)

	// A zip outside the backups dir.
	evil, _ := os.Create("evil.zip")
	zw := zip.NewWriter(evil)
	w, _ := zw.Create("../../pwned")
	w.Write([]byte("x"))
	zw.Close()
	evil.Close()

	if err := restoreSessionStore(sess, "evil.zip"); err == nil || !strings.Contains(err.Error(), "backups") {
		t.Fatalf("outside-path zip accepted: %v", err)
	}

	// A zip inside backups with a traversal entry.
	evil2, _ := os.Create("store/backups/evil.zip")
	zw2 := zip.NewWriter(evil2)
	w2, _ := zw2.Create("../../pwned")
	w2.Write([]byte("x"))
	zw2.Close()
	evil2.Close()

	if err := restoreSessionStore(sess, "store/backups/evil.zip"); err == nil || !strings.Contains(err.Error(), "unsafe") {
		t.Fatalf("traversal zip accepted: %v", err)
	}
}
