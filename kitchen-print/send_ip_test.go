package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"strconv"
	"testing"
	"time"
)

func TestIPSendWritesPayload(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()

	got := make(chan []byte, 1)
	errc := make(chan error, 1)
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			errc <- err
			return
		}
		defer conn.Close()
		buf, err := io.ReadAll(conn)
		if err != nil {
			errc <- err
			return
		}
		got <- buf
	}()

	host, portStr, err := net.SplitHostPort(ln.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(portStr)
	if err != nil {
		t.Fatal(err)
	}

	payload := []byte{0x1B, 0x40}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := (ipSender{}).Send(ctx, Target{Kind: "ip", Host: host, Port: port}, payload); err != nil {
		t.Fatal(err)
	}

	select {
	case buf := <-got:
		if !bytes.Equal(buf, payload) {
			t.Fatalf("got %x", buf)
		}
	case err := <-errc:
		t.Fatal(err)
	case <-time.After(2 * time.Second):
		t.Fatal("listener timed out")
	}
}

func TestIPCancelledContextWritesNothing(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	cancel()

	start := time.Now()
	err := (ipSender{}).Send(ctx, Target{Kind: "ip", Host: "127.0.0.1", Port: 1}, []byte{0x1B, 0x40})
	elapsed := time.Since(start)
	if elapsed >= time.Second {
		t.Fatalf("returned after %s", elapsed)
	}
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("got %v", err)
	}
}
