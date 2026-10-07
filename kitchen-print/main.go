package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type routingSender struct{}

func (routingSender) Send(ctx context.Context, t Target, payload []byte) error {
	return routeSender(t).Send(ctx, t, payload)
}

func routeSender(t Target) Sender {
	switch t.Kind {
	case "ip":
		return ipSender{}
	case "windows":
		return spoolSender{}
	default:
		return unsupportedSender{}
	}
}

type unsupportedSender struct{}

func (unsupportedSender) Send(context.Context, Target, []byte) error {
	return errors.New("invalid target")
}

func main() {
	handler := logJobs(newHandler(routingSender{}, 8*time.Second))
	if err := http.ListenAndServe("127.0.0.1:17341", handler); err != nil {
		_ = appendJobLog(time.Now().UTC(), "", "", err.Error())
		os.Exit(1)
	}
}

const maxPrintBody = 64 << 10

func logJobs(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/print" || r.Method != http.MethodPost || !originAllowed(r.Header.Get("Origin")) {
			next.ServeHTTP(w, r)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxPrintBody)
		body, err := io.ReadAll(r.Body)
		_ = r.Body.Close()
		if err != nil {
			body = nil
		}
		r.Body = io.NopCloser(bytes.NewReader(body))
		code, kind := decodedJob(body)
		rec := &logResponse{ResponseWriter: w}
		next.ServeHTTP(rec, r)
		_ = appendJobLog(time.Now().UTC(), code, kind, jobOutcome(rec.status, rec.body.Bytes()))
	})
}

func decodedJob(body []byte) (code, kind string) {
	var decoded struct {
		Target string `json:"target"`
		Slip   Slip   `json:"slip"`
	}
	if err := json.Unmarshal(body, &decoded); err != nil {
		return "", ""
	}
	return decoded.Slip.Code, decoded.Target
}

func jobOutcome(status int, body []byte) string {
	var resp struct {
		OK    bool   `json:"ok"`
		Error string `json:"error"`
	}
	_ = json.Unmarshal(body, &resp)
	if status == http.StatusOK && resp.OK {
		return "ok"
	}
	if resp.Error != "" {
		return resp.Error
	}
	return "error"
}

func truncateRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

var logMu sync.Mutex

func appendJobLog(when time.Time, code, kind, outcome string) error {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		return errors.New("LOCALAPPDATA is unset")
	}
	dir := filepath.Join(base, "WhatOrder")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	logMu.Lock()
	defer logMu.Unlock()
	f, err := os.OpenFile(filepath.Join(dir, "kitchen-print.log"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	flat := strings.NewReplacer("\r", " ", "\n", " ")
	code = truncateRunes(flat.Replace(code), 64)
	kind = truncateRunes(flat.Replace(kind), 64)
	_, err = fmt.Fprintf(f, "%s %s %s %s\n", when.UTC().Format(time.RFC3339), code, kind, flat.Replace(outcome))
	return err
}

type logResponse struct {
	http.ResponseWriter
	status int
	body   bytes.Buffer
}

func (w *logResponse) WriteHeader(code int) {
	if w.status == 0 {
		w.status = code
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *logResponse) Write(p []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	w.body.Write(p)
	return w.ResponseWriter.Write(p)
}
