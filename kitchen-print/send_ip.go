package main

import (
	"context"
	"net"
	"strconv"
	"time"
)

type ipSender struct{}

// Send dials the printer and writes the slip. A cancelled context after dial
// closes the socket and does not write. The context deadline is applied as a
// write deadline and cancellation closes the connection, so a blocked Write
// cannot keep sending after the caller has responded.
func (ipSender) Send(ctx context.Context, t Target, payload []byte) error {
	addr := net.JoinHostPort(t.Host, strconv.Itoa(t.Port))
	conn, err := (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, "tcp", addr)
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		conn.Close()
		return err
	}
	if deadline, ok := ctx.Deadline(); ok {
		if err := conn.SetWriteDeadline(deadline); err != nil {
			conn.Close()
			return err
		}
	}
	done := make(chan struct{})
	watcherExited := make(chan struct{})
	go func() {
		defer close(watcherExited)
		select {
		case <-ctx.Done():
			conn.Close()
		case <-done:
		}
	}()
	_, werr := conn.Write(payload)
	close(done)
	<-watcherExited
	cerr := conn.Close()
	if werr != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return ctxErr
		}
		return werr
	}
	return cerr
}
