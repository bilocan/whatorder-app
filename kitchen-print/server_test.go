package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestForeignOriginDoesNotPrint(t *testing.T) {
	s := &fakeSender{}
	h := newHandler(s, time.Second)
	req := httptest.NewRequest(http.MethodPost, "/print", bytes.NewReader(sampleBody(t)))
	req.Header.Set("Origin", "https://evil.example")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if s.calls != 0 {
		t.Fatal("sender was called")
	}
	if rr.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal(rr.Header().Get("Access-Control-Allow-Origin"))
	}
}

func TestAllowedPostSetsCORSAndSends(t *testing.T) {
	s := &fakeSender{}
	h := newHandler(s, time.Second)
	req := httptest.NewRequest(http.MethodPost, "/print", bytes.NewReader(sampleBody(t)))
	req.Header.Set("Origin", "https://dashboard.whatorder.at")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("status %d body %s", rr.Code, rr.Body.Bytes())
	}
	if got := rr.Header().Get("Access-Control-Allow-Origin"); got != "https://dashboard.whatorder.at" {
		t.Fatal(got)
	}
	if rr.Header().Get("Access-Control-Allow-Private-Network") != "true" {
		t.Fatal("missing private network header")
	}
	if s.calls != 1 || s.last.Kind != "windows" || s.last.Name != "EPSON TM-T20II" {
		t.Fatalf("sender %+v calls %d", s.last, s.calls)
	}
	if !bytes.HasPrefix(s.payload, []byte{0x1B, 0x40}) {
		t.Fatalf("payload %x", s.payload)
	}
	if !strings.Contains(rr.Header().Get("Access-Control-Allow-Methods"), "POST") {
		t.Fatal(rr.Header().Get("Access-Control-Allow-Methods"))
	}
	if !strings.Contains(strings.ToLower(rr.Header().Get("Access-Control-Allow-Headers")), "content-type") {
		t.Fatal(rr.Header().Get("Access-Control-Allow-Headers"))
	}
}

func TestOptionsAllowsContentType(t *testing.T) {
	s := &fakeSender{}
	h := newHandler(s, time.Second)
	req := httptest.NewRequest(http.MethodOptions, "/print", nil)
	req.Header.Set("Origin", "https://pre.whatorder.at")
	req.Header.Set("Access-Control-Request-Method", "POST")
	req.Header.Set("Access-Control-Request-Headers", "content-type")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != 204 {
		t.Fatal(rr.Code)
	}
	if !strings.Contains(rr.Header().Get("Access-Control-Allow-Methods"), "POST") {
		t.Fatal(rr.Header().Get("Access-Control-Allow-Methods"))
	}
	if !strings.Contains(strings.ToLower(rr.Header().Get("Access-Control-Allow-Headers")), "content-type") {
		t.Fatal(rr.Header().Get("Access-Control-Allow-Headers"))
	}
	if rr.Header().Get("Access-Control-Allow-Private-Network") != "true" {
		t.Fatal("preflight private network")
	}
	if got := rr.Header().Get("Access-Control-Allow-Origin"); got != "https://pre.whatorder.at" {
		t.Fatal(got)
	}
	if s.calls != 0 {
		t.Fatal("sender was called")
	}
}

func TestDeadlineDoesNotWrite(t *testing.T) {
	s := &blockingSender{}
	h := newHandler(s, 40*time.Millisecond)
	req := httptest.NewRequest(http.MethodPost, "/print", bytes.NewReader(sampleBody(t)))
	req.Header.Set("Origin", "https://dashboard-test.whatorder.at")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != 500 {
		t.Fatal(rr.Code)
	}
	var body struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil || body.Error == "" {
		t.Fatalf("body %s", rr.Body.Bytes())
	}
	if s.wrote {
		t.Fatal("wrote after the deadline")
	}
}

func TestEmptyCodeReturns400(t *testing.T) {
	s := &fakeSender{}
	h := newHandler(s, time.Second)
	body := []byte(`{"target":"windows","value":"EPSON TM-T20II","slip":{"code":"","lines":[{"label":"1x Tea","amount":"€1.00"}]}}`)
	req := httptest.NewRequest(http.MethodPost, "/print", bytes.NewReader(body))
	req.Header.Set("Origin", "https://dashboard.whatorder.at")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != 400 {
		t.Fatalf("status %d body %s", rr.Code, rr.Body.Bytes())
	}
	var resp struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil || resp.Error == "" {
		t.Fatalf("body %s", rr.Body.Bytes())
	}
	if s.calls != 0 {
		t.Fatal("sender was called")
	}
}

func TestOtherPathDoesNotPrint(t *testing.T) {
	s := &fakeSender{}
	h := newHandler(s, time.Second)
	req := httptest.NewRequest(http.MethodPost, "/other", bytes.NewReader(sampleBody(t)))
	req.Header.Set("Origin", "https://dashboard.whatorder.at")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != 404 {
		t.Fatal(rr.Code)
	}
	if s.calls != 0 {
		t.Fatal("sender was called")
	}
}

func TestLocalhostOriginsPrint(t *testing.T) {
	for _, origin := range []string{"http://localhost:5173", "http://127.0.0.1:5173"} {
		s := &fakeSender{}
		h := newHandler(s, time.Second)
		req := httptest.NewRequest(http.MethodPost, "/print", bytes.NewReader(sampleBody(t)))
		req.Header.Set("Origin", origin)
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		if rr.Code != 200 || s.calls != 1 {
			t.Fatalf("%s status %d calls %d body %s", origin, rr.Code, s.calls, rr.Body.Bytes())
		}
		if got := rr.Header().Get("Access-Control-Allow-Origin"); got != origin {
			t.Fatalf("%s got %s", origin, got)
		}
	}
}

func sampleBody(t *testing.T) []byte {
	t.Helper()
	return []byte(`{"target":"windows","value":"EPSON TM-T20II","slip":{"code":"A1","lines":[{"label":"1x Tea","amount":"€1.00"}]}}`)
}

type fakeSender struct {
	calls   int
	last    Target
	payload []byte
}

func (f *fakeSender) Send(_ context.Context, t Target, payload []byte) error {
	f.calls++
	f.last = t
	f.payload = append([]byte(nil), payload...)
	return nil
}

type blockingSender struct{ wrote bool }

func (b *blockingSender) Send(ctx context.Context, _ Target, _ []byte) error {
	<-ctx.Done()
	return ctx.Err()
}
