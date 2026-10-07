package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestDisallowedOriginDoesNotLog(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("LOCALAPPDATA", dir)

	s := &fakeSender{}
	h := logJobs(newHandler(s, time.Second))
	body := []byte(`{"target":"windows","value":"EPSON","slip":{"code":"EVILCODE","customerPhone":"+43123","lines":[{"label":"Tea","amount":"1"}]}}`)
	req := httptest.NewRequest(http.MethodPost, "/print", bytes.NewReader(body))
	req.Header.Set("Origin", "https://evil.example")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status %d", rr.Code)
	}
	if s.calls != 0 {
		t.Fatal("sender was called")
	}
	logPath := filepath.Join(dir, "WhatOrder", "kitchen-print.log")
	if data, err := os.ReadFile(logPath); err == nil {
		t.Fatalf("log line written: %s", data)
	} else if !os.IsNotExist(err) {
		t.Fatal(err)
	}
}
