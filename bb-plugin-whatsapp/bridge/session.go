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
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
)

// SessionInfo represents a public snapshot of a WhatsApp session/account
type SessionInfo struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Phone     string `json:"phone"`
	Status    string `json:"status"` // "connected" | "needs_scan" | "connecting" | "disconnected" | "logged_out"
	Connected bool   `json:"connected"`
	QR        string `json:"qr"`
	IsActive  bool   `json:"is_active"`
	Error     string `json:"error"`
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
		ID:        s.ID,
		Name:      name,
		Phone:     phone,
		Status:    status,
		Connected: isAuth && s.Client.IsConnected(),
		QR:        s.GetQR(),
		IsActive:  isActive,
		Error:     s.Err(),
	}
}

// SessionManager coordinates multiple WhatsApp accounts/sessions
type SessionManager struct {
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

	sm := &SessionManager{
		sessions: make(map[string]*Session),
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

	sess := &Session{
		ID:           id,
		Name:         name,
		StoreDir:     storeDir,
		Client:       client,
		Container:    container,
		MessageStore: msgStore,
		logger:       clientLogger,
		dbLog:        sm.dbLog,
	}

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
			handleHistorySync(s.Client, s.MessageStore, v, s.logger)
		case *events.Connected:
			s.logger.Infof("Session %s connected to WhatsApp", s.ID)
			s.SetQR("")
			go s.MessageStore.RefreshChatNames(s.Client, s.logger)
			sm.saveMeta()
		case *events.LoggedOut:
			s.logger.Warnf("Session %s logged out (on_connect=%v reason=%v), re-pairing required", s.ID, v.OnConnect, v.Reason)
			s.SetQR("")
			s.loggedOut.Store(true)
			s.setErr("WhatsApp logged this account out. Re-pair it with a fresh QR code.")
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
			qrChan, _ := s.Client.GetQRChannel(ctx)
			err := s.Client.Connect()
			if err != nil {
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
					s.SetQR("")
					s.logger.Warnf("Session %s QR channel ended (%s), retry required", s.ID, evt.Event)
				}
			}
		} else {
			// Already paired: retry the initial Connect with backoff. A
			// single failed attempt must not leave the account offline until
			// the next bridge restart.
			backoff := 2 * time.Second
			for attempt := 1; ; attempt++ {
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
		list = append(list, s.GetInfo(s.ID == sm.activeID))
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
}
