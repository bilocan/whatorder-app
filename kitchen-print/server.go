package main

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

// Sender delivers one encoded slip. Send returns when ctx is done and does not write after that.
type Sender interface {
	Send(ctx context.Context, t Target, payload []byte) error
}

var allowedOrigins = map[string]struct{}{
	"https://dashboard.whatorder.at":      {},
	"https://dashboard-test.whatorder.at": {},
	"https://pre.whatorder.at":            {},
	"http://localhost:5173":               {},
	"http://127.0.0.1:5173":               {},
}

func originAllowed(origin string) bool {
	_, ok := allowedOrigins[origin]
	return ok
}

func newHandler(sender Sender, timeout time.Duration) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/print" {
			http.NotFound(w, r)
			return
		}
		origin := r.Header.Get("Origin")
		if !originAllowed(origin) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		if r.Method == http.MethodOptions {
			setCORS(w, origin)
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPost {
			http.Error(w, "method", http.StatusMethodNotAllowed)
			return
		}
		setCORS(w, origin)
		if !strings.Contains(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "content type"})
			return
		}
		var body struct {
			Target string `json:"target"`
			Value  string `json:"value"`
			Slip   Slip   `json:"slip"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad json"})
			return
		}
		target, err := ParseTarget(body.Target, body.Value)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		payload, err := EncodeSlip(body.Slip)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), timeout)
		defer cancel()
		errc := make(chan error, 1)
		go func() { errc <- sender.Send(ctx, target, payload) }()
		select {
		case err := <-errc:
			if err != nil {
				writeJSON(w, 500, map[string]string{"error": err.Error()})
				return
			}
			writeJSON(w, 200, map[string]bool{"ok": true})
		case <-ctx.Done():
			writeJSON(w, 500, map[string]string{"error": "print timed out"})
		}
	})
}

func setCORS(w http.ResponseWriter, origin string) {
	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Set("Access-Control-Allow-Methods", "POST")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.Header().Set("Access-Control-Allow-Private-Network", "true")
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
