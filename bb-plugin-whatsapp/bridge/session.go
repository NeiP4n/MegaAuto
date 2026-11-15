package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
)

// SessionInfo represents a public snapshot of a WhatsApp session/account
type SessionInfo struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Phone         string `json:"phone"`
	Status        string `json:"status"` // "connected" | "needs_scan" | "connecting" | "disconnected" | "logged_out"
	Connected     bool   `json:"connected"`
	QR            string `json:"qr"`
	IsActive      bool   `json:"is_active"`
	Error         string `json:"error"`
	Pairing       bool   `json:"pairing"`
	Syncing       bool   `json:"syncing"`
	AppearOffline bool   `json:"appear_offline"`
	ClaimHolder   string `json:"claim_holder,omitempty"`
	ClaimExpires  string `json:"claim_expires_at,omitempty"`
}

type SessionMeta struct {
	ActiveID string            `json:"active_id"`
	Sessions []SessionMetaItem `json:"sessions"`
}

type SessionMetaItem struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Session holds the runtime state and databases for a single WhatsApp account
type Session struct {
	ID           string
	Name         string
	StoreDir     string
	Client       *whatsmeow.Client
	Container    *sqlstore.Container
	MessageStore *MessageStore
	QRCode       string
	qrLock       sync.RWMutex
	logger       waLog.Logger
	dbLog        waLog.Logger

	nameRefreshMu   sync.Mutex
	lastNameRefresh time.Time

	loggedOut atomic.Bool
	lastErr   atomic.Value // string

	// pairing is true from QR generation until Connected (or QR timeout);
	// syncing is true from the first Connected after a fresh pairing until
	// the first history sync lands or a 3-minute grace expires. Restarting
	// the client in either window kills the pair mid-flight - WhatsApp then
	// reports the device as logged out.
	pairing atomic.Bool
	syncing atomic.Bool
	// appearOffline mirrors privacy.json: after every connect the client
	// announces PresenceUnavailable, so contacts don't see online/last seen.
	appearOffline atomic.Bool
	// connGen cancels stale connect-retry goroutines when the client is
	// torn down (restart/stop/delete) so an old loop cannot resurrect a
	// dead client.
	connGen atomic.Uint64

	sendGuard *sendGuard
}

func (s *Session) setErr(msg string) {
	s.lastErr.Store(msg)
}

func (s *Session) Err() string {
	if v := s.lastErr.Load(); v != nil {
		return v.(string)
	}
	return ""
}

// maybeRefreshChatNames resolves missing chat names in the background, at most
// once per minute, so polling clients do not spawn a goroutine per request.
func (s *Session) maybeRefreshChatNames() {
	if s.MessageStore == nil {
		return
	}
	s.nameRefreshMu.Lock()
	if time.Since(s.lastNameRefresh) < time.Minute {
		s.nameRefreshMu.Unlock()
		return
	}
	s.lastNameRefresh = time.Now()
	s.nameRefreshMu.Unlock()
	go s.MessageStore.RefreshChatNames(s.Client, nil)
}

func (s *Session) GetQR() string {
	s.qrLock.RLock()
	defer s.qrLock.RUnlock()
	return s.QRCode
}

func (s *Session) SetQR(code string) {
	s.qrLock.Lock()
	defer s.qrLock.Unlock()
	s.QRCode = code
}

func (s *Session) GetInfo(isActive bool) SessionInfo {
	status := "disconnected"
	phone := ""
	isAuth := s.Client != nil && s.Client.Store != nil && s.Client.Store.ID != nil
	if isAuth {
		phone = s.Client.Store.ID.User
	}
	if s.loggedOut.Load() {
		status = "logged_out"
	} else if isAuth && s.Client.IsConnected() {
		status = "connected"
	} else if s.GetQR() != "" {
		status = "needs_scan"
	} else if s.Client != nil {
		status = "connecting"
	}

	name := s.Name
	if name == "" || name == "Main Account" || strings.HasPrefix(name, "Account ") {
		if phone != "" {
			name = "+" + phone
		}
	}

	return SessionInfo{
		ID:            s.ID,
		Name:          name,
		Phone:         phone,
		Status:        status,
		Connected:     isAuth && s.Client.IsConnected(),
		QR:            s.GetQR(),
		Pairing:       s.pairing.Load(),
		Syncing:       s.syncing.Load(),
		AppearOffline: s.appearOffline.Load(),
		IsActive:      isActive,
		Error:         s.Err(),
	}
}

// SessionManager coordinates multiple WhatsApp accounts/sessions
type SessionManager struct {
	claims *claimRegistry
	sessions map[string]*Session
	activeID string
	mu       sync.RWMutex
	metaPath string
	logger   waLog.Logger
	dbLog    waLog.Logger
}

func NewSessionManager(logger waLog.Logger, dbLog waLog.Logger) (*SessionManager, error) {
	if err := os.MkdirAll("store/sessions", 0755); err != nil {
		return nil, fmt.Errorf("failed to create store directory: %v", err)
	}
	// Store-dir lock: the TCP port is already the first single-instance
	// guard, but two bridges on different ports sharing this store dir would
	// still connect the same WhatsApp device keys twice - the StreamReplaced
	// fight ends with WhatsApp force-logging the account out. Refuse to
	// start over a live owner's lock; take over a stale one.
	if err := acquireStoreLock(logger); err != nil {
		return nil, err
	}

	sm := &SessionManager{
		sessions: make(map[string]*Session),
		claims:   newClaimRegistry(),
		activeID: "default",
		metaPath: "store/sessions.json",
		logger:   logger,
		dbLog:    dbLog,
	}

	meta := sm.loadMeta()
	if len(meta.Sessions) == 0 {
		meta.Sessions = append(meta.Sessions, SessionMetaItem{
			ID:   "default",
			Name: "Main Account",
		})
		meta.ActiveID = "default"
	}

	sm.activeID = meta.ActiveID
	if sm.activeID == "" {
		sm.activeID = meta.Sessions[0].ID
	}

	// Initialize all persisted sessions
	for _, item := range meta.Sessions {
		sess, err := sm.initSession(item.ID, item.Name)
		if err != nil {
			logger.Errorf("Failed to initialize session %s (%s): %v", item.ID, item.Name, err)
			continue
		}
		sm.sessions[item.ID] = sess
		sm.startSession(sess)
	}

	// Ensure default session exists
	if _, exists := sm.sessions["default"]; !exists && len(sm.sessions) == 0 {
		sess, err := sm.initSession("default", "Main Account")
		if err == nil {
			sm.sessions["default"] = sess
			sm.activeID = "default"
			sm.startSession(sess)
		}
	}

	sm.saveMeta()
	return sm, nil
}

func (sm *SessionManager) loadMeta() SessionMeta {
	var meta SessionMeta
	data, err := os.ReadFile(sm.metaPath)
	if err == nil {
		_ = json.Unmarshal(data, &meta)
	}
	return meta
}

func (sm *SessionManager) saveMeta() {
	ids := make([]string, 0, len(sm.sessions))
	for id := range sm.sessions {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	var items []SessionMetaItem
	for _, id := range ids {
		items = append(items, SessionMetaItem{
			ID:   id,
			Name: sm.sessions[id].Name,
		})
	}
	meta := SessionMeta{
		ActiveID: sm.activeID,
		Sessions: items,
	}
	data, err := json.MarshalIndent(meta, "", "  ")
	if err == nil {
		_ = os.WriteFile(sm.metaPath, data, 0644)
	}
}

func (sm *SessionManager) initSession(id, name string) (*Session, error) {
	var storeDir string
	if id == "default" {
		storeDir = "store"
	} else {
		storeDir = filepath.Join("store", "sessions", id)
		if err := os.MkdirAll(storeDir, 0755); err != nil {
			return nil, err
		}
	}

	waDBPath := filepath.Join(storeDir, "whatsapp.db")
	msgDBPath := filepath.Join(storeDir, "messages.db")

	container, err := sqlstore.New(context.Background(), "sqlite3", fmt.Sprintf("file:%s?_foreign_keys=on", waDBPath), sm.dbLog)
	if err != nil {
		return nil, fmt.Errorf("failed to open session whatsapp db: %v", err)
	}

	deviceStore, err := container.GetFirstDevice(context.Background())
	if err != nil {
		if err == sql.ErrNoRows {
			deviceStore = container.NewDevice()
		} else {
			container.Close()
			return nil, fmt.Errorf("failed to get session device: %v", err)
		}
	}

	msgStore, err := NewMessageStoreAtPath(msgDBPath)
	if err != nil {
		container.Close()
		return nil, fmt.Errorf("failed to open session message store: %v", err)
	}

	clientLogger := waLog.Stdout(fmt.Sprintf("Client-%s", id), "INFO", true)
	client := whatsmeow.NewClient(deviceStore, clientLogger)

	privacy := loadPrivacy(storeDir)

	sess := &Session{
		ID:           id,
		Name:         name,
		StoreDir:     storeDir,
		Client:       client,
		Container:    container,
		MessageStore: msgStore,
		sendGuard:    newSendGuard(storeDir),
		logger:       clientLogger,
		dbLog:        sm.dbLog,
	}
	sess.appearOffline.Store(privacy.AppearOffline)

	return sess, nil
}

func (sm *SessionManager) startSession(s *Session) {
	if s.Client == nil {
		return
	}

	// Register event handlers
	s.Client.AddEventHandler(func(evt interface{}) {
		switch v := evt.(type) {
		case *events.Message:
			handleMessage(s.Client, s.MessageStore, v, s.logger)
		case *events.HistorySync:
			s.logger.Infof("Session %s received history sync blob", s.ID)
			handleHistorySync(s.Client, s.MessageStore, v, s.logger)
			s.syncing.Store(false)
		case *events.PairSuccess:
			s.logger.Infof("Session %s pair success (phone %s, platform %s) - initial sync starting, this can take several minutes", s.ID, v.ID.User, v.Platform)
		case *events.PairError:
			s.pairing.Store(false)
			s.logger.Errorf("Session %s pair error: %v", s.ID, v.Error)
			s.setErr(fmt.Sprintf("Pairing failed: %v. Press retry for a fresh QR code.", v.Error))
		case *events.Disconnected:
			s.logger.Infof("Session %s disconnected from WhatsApp", s.ID)
		case *events.Connected:
			wasPairing := s.pairing.Swap(false)
			s.logger.Infof("Session %s connected to WhatsApp (after_pairing=%v)", s.ID, wasPairing)
			s.SetQR("")
			if wasPairing {
				// Fresh pairing: history sync lands over the next minutes.
				// Mark syncing so nothing restarts the client mid-sync.
				s.syncing.Store(true)
				go func() {
					time.Sleep(3 * time.Minute)
					s.syncing.Store(false)
				}()
			}
			go s.MessageStore.RefreshChatNames(s.Client, s.logger)
			if s.appearOffline.Load() {
				go s.applyPresence()
			}
			sm.saveMeta()
		case *events.LoggedOut:
			s.logger.Warnf("Session %s logged out (on_connect=%v reason=%v), re-pairing required", s.ID, v.OnConnect, v.Reason)
			s.SetQR("")
			s.loggedOut.Store(true)
			s.pairing.Store(false)
			s.syncing.Store(false)
			s.setErr(fmt.Sprintf("WhatsApp logged this account out (reason=%v, on_connect=%v). Re-pair it with a fresh QR code.", v.Reason, v.OnConnect))
			// Drop the dead device credentials so a session restart goes
			// straight to pairing instead of reconnecting into another 401.
			if s.Client.Store != nil && s.Client.Store.ID != nil {
				if err := s.Client.Store.Delete(context.Background()); err != nil {
					s.logger.Errorf("Session %s: failed to clear logged-out device: %v", s.ID, err)
				}
			}
			s.Client.Disconnect()
		case *events.StreamReplaced:
			// Another process connected with this session's device keys - a
			// second bridge instance. Step back instead of fighting over the
			// stream, which ends in WhatsApp force-logging the account out.
			s.logger.Errorf("Session %s: stream replaced by another bridge instance; disconnecting this copy", s.ID)
			s.setErr("Another bridge instance is using this account. Close the other one and press retry.")
			s.Client.Disconnect()
		}
	})

	// Connect asynchronously
	go func() {
		ctx := context.Background()
		if s.Client.Store.ID == nil {
			// Needs pairing. If Connect fails before any QR arrives the
			// channel is dead; clear state so the UI can offer a retry
			// (RestartSession) instead of spinning "Requesting QR" forever.
			s.pairing.Store(true)
			qrChan, _ := s.Client.GetQRChannel(ctx)
			err := s.Client.Connect()
			if err != nil {
				s.pairing.Store(false)
				s.SetQR("")
				s.logger.Errorf("Session %s connect error: %v", s.ID, err)
				return
			}
			for evt := range qrChan {
				switch evt.Event {
				case "code":
					s.SetQR(evt.Code)
					s.logger.Infof("Session %s pairing QR code generated", s.ID)
				case "success":
					s.SetQR("")
					s.logger.Infof("Session %s paired successfully!", s.ID)
				case "timeout", "err":
					// QR codes expired unscanned; require an explicit retry so
					// the UI never displays a dead QR or spins forever.
					s.pairing.Store(false)
					s.SetQR("")
					s.logger.Warnf("Session %s QR channel ended (%s), retry required", s.ID, evt.Event)
				}
			}
		} else {
			// Already paired: retry the initial Connect with backoff. A
			// single failed attempt must not leave the account offline until
			// the next bridge restart. The loop dies when the client is torn
			// down (restart/stop/delete bumps connGen), so a stale goroutine
			// can never resurrect an old client.
			gen := s.connGen.Load()
			backoff := 2 * time.Second
			for attempt := 1; ; attempt++ {
				if s.connGen.Load() != gen {
					s.logger.Infof("Session %s connect loop cancelled (client replaced)", s.ID)
					return
				}
				err := s.Client.Connect()
				if err == nil {
					break
				}
				s.logger.Errorf("Session %s reconnect error (attempt %d): %v", s.ID, attempt, err)
				time.Sleep(backoff)
				if backoff < 30*time.Second {
					backoff *= 2
				}
			}
			s.SetQR("")
			s.logger.Infof("Session %s restored existing WhatsApp connection", s.ID)
		}
	}()
}

func (sm *SessionManager) GetActiveSession() *Session {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	if s, ok := sm.sessions[sm.activeID]; ok {
		return s
	}
	// Fallback to first available
	for _, s := range sm.sessions {
		return s
	}
	return nil
}

// LookupSession resolves an explicit session id without falling back to the
// active session. An empty id still means the active session. Use this on
// write paths so a stale id can never send from the wrong account.
func (sm *SessionManager) LookupSession(id string) *Session {
	if id == "" {
		return sm.GetActiveSession()
	}
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	return sm.sessions[id]
}

func (sm *SessionManager) GetSession(id string) *Session {
	if id == "" {
		return sm.GetActiveSession()
	}
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	if s, ok := sm.sessions[id]; ok {
		return s
	}
	return sm.GetActiveSession()
}

func (sm *SessionManager) ListSessions() []SessionInfo {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	ordered := make([]*Session, 0, len(sm.sessions))
	for _, s := range sm.sessions {
		ordered = append(ordered, s)
	}
	sort.Slice(ordered, func(i, j int) bool {
		if ordered[i].ID == "default" {
			return true
		}
		if ordered[j].ID == "default" {
			return false
		}
		return ordered[i].ID < ordered[j].ID
	})

	var list []SessionInfo
	for _, s := range ordered {
		info := s.GetInfo(s.ID == sm.activeID)
		if c, ok := sm.claims.Of(s.ID); ok {
			info.ClaimHolder = c.Holder
			info.ClaimExpires = c.ExpiresAt.Format(time.RFC3339)
		}
		list = append(list, info)
	}
	return list
}

func (sm *SessionManager) SetActive(id string) error {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	if _, ok := sm.sessions[id]; !ok {
		return fmt.Errorf("session not found: %s", id)
	}
	sm.activeID = id
	sm.saveMeta()
	return nil
}

func (sm *SessionManager) CreateSession(name string) (SessionInfo, error) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	var id string
	for {
		id = fmt.Sprintf("session_%d_%04d", time.Now().Unix(), rand.Intn(10000))
		if _, taken := sm.sessions[id]; !taken {
			break
		}
	}
	if name == "" {
		name = fmt.Sprintf("Account %d", len(sm.sessions)+1)
	}

	sess, err := sm.initSession(id, name)
	if err != nil {
		return SessionInfo{}, err
	}

	sm.sessions[id] = sess
	// Do NOT switch the active account here: creating a session must never
	// disturb the account the user is currently looking at. Clients switch
	// explicitly via /api/sessions/switch.
	sm.startSession(sess)
	sm.saveMeta()

	return sess.GetInfo(sess.ID == sm.activeID), nil
}

// RestartSession tears down and re-creates a session's client in place, used
// to retry pairing after the QR channel timed out or to recover a stuck
// connection. Store directories and the session id are preserved, so an
// already-paired account keeps its credentials.
func (sm *SessionManager) RestartSession(id string) (SessionInfo, error) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	sess, ok := sm.sessions[id]
	if !ok {
		return SessionInfo{}, fmt.Errorf("session not found: %s", id)
	}

	// Never tear down a client while a pairing or the initial history sync
	// is in flight: that is exactly what turns "logging in..." on the phone
	// into "Account logged out".
	if sess.pairing.Load() {
		return SessionInfo{}, fmt.Errorf("pairing is in progress - wait for it to finish (the phone can take several minutes to sync) instead of restarting")
	}
	if sess.syncing.Load() {
		return SessionInfo{}, fmt.Errorf("initial history sync is in progress - wait a few minutes instead of restarting")
	}

	sess.connGen.Add(1)
	sess.loggedOut.Store(false)
	sess.setErr("")
	if sess.Client != nil {
		sess.Client.Disconnect()
	}
	if sess.Container != nil {
		sess.Container.Close()
	}
	if sess.MessageStore != nil {
		sess.MessageStore.Close()
	}

	fresh, err := sm.initSession(sess.ID, sess.Name)
	if err != nil {
		delete(sm.sessions, id)
		return SessionInfo{}, err
	}
	sm.sessions[id] = fresh
	sm.startSession(fresh)
	sm.saveMeta()
	return fresh.GetInfo(id == sm.activeID), nil
}

func (sm *SessionManager) DeleteSession(id string) error {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if len(sm.sessions) <= 1 {
		return fmt.Errorf("cannot delete the only remaining session")
	}

	sess, ok := sm.sessions[id]
	if !ok {
		return fmt.Errorf("session not found: %s", id)
	}

	// Disconnect and close
	sess.connGen.Add(1)
	if sess.Client != nil {
		sess.Client.Disconnect()
	}
	if sess.Container != nil {
		sess.Container.Close()
	}
	if sess.MessageStore != nil {
		sess.MessageStore.Close()
	}

	// Remove from map
	delete(sm.sessions, id)

	// If active was deleted, choose next
	if sm.activeID == id {
		for nextID := range sm.sessions {
			sm.activeID = nextID
			break
		}
	}

	// Remove session directory if not default
	if id != "default" {
		_ = os.RemoveAll(sess.StoreDir)
	}

	sm.saveMeta()
	return nil
}

func (sm *SessionManager) CloseAll() {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	for _, s := range sm.sessions {
		if s.Client != nil {
			s.Client.Disconnect()
		}
		if s.Container != nil {
			s.Container.Close()
		}
		if s.MessageStore != nil {
			s.MessageStore.Close()
		}
	}
	releaseStoreLock()
}

// acquireStoreLock takes exclusive ownership of the store directory for this
// process. A live owner's lock makes startup fail; a stale one (owner PID no
// longer exists) is replaced.
func acquireStoreLock(logger waLog.Logger) error {
	lockPath := "store/bridge.lock"
	if data, err := os.ReadFile(lockPath); err == nil {
		var pid int
		if _, err := fmt.Sscanf(string(data), "%d", &pid); err == nil && pid != os.Getpid() && pid > 0 {
			if p, err := os.FindProcess(pid); err == nil && p.Signal(syscall.Signal(0)) == nil {
				return fmt.Errorf("another bridge instance (PID %d) already owns this session store - refusing to start a second copy, which would fight over the WhatsApp device keys and get the account logged out; close the other instance first", pid)
			}
			logger.Warnf("Replacing stale store lock from a dead bridge process (PID %d)", pid)
		}
	}
	if err := os.WriteFile(lockPath, []byte(fmt.Sprintf("%d\n", os.Getpid())), 0644); err != nil {
		return fmt.Errorf("failed to write store lock: %v", err)
	}
	return nil
}

func releaseStoreLock() {
	os.Remove("store/bridge.lock")
}
