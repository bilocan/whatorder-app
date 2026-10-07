//go:build !windows

package main

import (
	"context"
	"errors"
)

type spoolSender struct{}

func (spoolSender) Send(context.Context, Target, []byte) error {
	return errors.New("windows printer sender is not in this binary")
}
