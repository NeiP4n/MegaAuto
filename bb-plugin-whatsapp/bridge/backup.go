package main

// Session store backup/restore. A backup zips the session's store dir
// (whatsapp.db device credentials, messages.db, send_quota.json) into
// <store>/backups/ so an account pairing survives a reinstall or a
// logged-out device. Restore only accepts zips that look like our own
// backups and rejects path traversal entries.

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func backupsDir() string {
	return filepath.Join("store", "backups")
}

// backupSessionStore zips the session store dir into store/backups and
// returns the backup file path.
func backupSessionStore(sess *Session) (string, error) {
	if sess.StoreDir == "" {
		return "", fmt.Errorf("session has no store dir")
	}
	if err := os.MkdirAll(backupsDir(), 0755); err != nil {
		return "", err
	}
	name := fmt.Sprintf("%s-%s.zip", sess.ID, time.Now().Format("20060102-150405"))
	outPath := filepath.Join(backupsDir(), name)

	out, err := os.Create(outPath)
	if err != nil {
		return "", err
	}
	defer out.Close()

	zw := zip.NewWriter(out)
	defer zw.Close()

	err = filepath.Walk(sess.StoreDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return err
		}
		// Skip sqlite journals/locks - a live db checkpoint may be mid-write;
		// the main db file is what matters.
		if strings.HasSuffix(path, "-wal") || strings.HasSuffix(path, "-shm") || strings.HasSuffix(path, "-journal") {
			return nil
		}
		rel, err := filepath.Rel(sess.StoreDir, path)
		if err != nil {
			return err
		}
		fh, err := zw.Create(rel)
		if err != nil {
			return err
		}
		in, err := os.Open(path)
		if err != nil {
			return err
		}
		defer in.Close()
		_, err = io.Copy(fh, in)
		return err
	})
	if err != nil {
		os.Remove(outPath)
		return "", err
	}
	if err := zw.Close(); err != nil {
		os.Remove(outPath)
		return "", err
	}
	return outPath, nil
}

// restoreSessionStore unpacks a backup zip over the session store dir.
// The session must be restartable; the caller restarts it afterwards.
func restoreSessionStore(sess *Session, zipPath string) error {
	// Constrain to our backups dir: no arbitrary file paths.
	clean := filepath.Clean(zipPath)
	absBackups, err := filepath.Abs(backupsDir())
	if err != nil {
		return err
	}
	absZip, err := filepath.Abs(clean)
	if err != nil {
		return err
	}
	if !strings.HasPrefix(absZip, absBackups+string(os.PathSeparator)) {
		return fmt.Errorf("backup file must live in %s", backupsDir())
	}

	zr, err := zip.OpenReader(absZip)
	if err != nil {
		return fmt.Errorf("cannot open backup: %v", err)
	}
	defer zr.Close()

	// Validate before touching the store: every entry must be a plain file
	// with a safe relative name.
	for _, f := range zr.File {
		name := filepath.Clean(f.Name)
		if f.FileInfo().IsDir() || strings.HasPrefix(name, "..") || filepath.IsAbs(name) || strings.ContainsRune(name, 0) {
			return fmt.Errorf("backup contains unsafe entry %q", f.Name)
		}
	}

	if sess.Client != nil {
		sess.Client.Disconnect()
	}
	if sess.Container != nil {
		sess.Container.Close()
	}
	if sess.MessageStore != nil {
		sess.MessageStore.Close()
	}

	for _, f := range zr.File {
		target := filepath.Join(sess.StoreDir, filepath.Clean(f.Name))
		if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			return err
		}
		rc, err := f.Open()
		if err != nil {
			return err
		}
		out, err := os.Create(target)
		if err != nil {
			rc.Close()
			return err
		}
		_, err = io.Copy(out, rc)
		out.Close()
		rc.Close()
		if err != nil {
			return err
		}
	}
	return nil
}
