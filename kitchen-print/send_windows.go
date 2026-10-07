//go:build windows

package main

import (
	"context"
	"errors"
	"runtime"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// spoolSender prints RAW bytes through Winspool. It does not change the default printer.
type spoolSender struct{}

var (
	winspool             = windows.NewLazySystemDLL("winspool.drv")
	procOpenPrinterW     = winspool.NewProc("OpenPrinterW")
	procClosePrinter     = winspool.NewProc("ClosePrinter")
	procStartDocPrinterW = winspool.NewProc("StartDocPrinterW")
	procStartPagePrinter = winspool.NewProc("StartPagePrinter")
	procWritePrinter     = winspool.NewProc("WritePrinter")
	procEndPagePrinter   = winspool.NewProc("EndPagePrinter")
	procEndDocPrinter    = winspool.NewProc("EndDocPrinter")
)

// docInfo1 matches DOC_INFO_1W. Datatype RAW sends the bytes unchanged.
type docInfo1 struct {
	docName    *uint16
	outputFile *uint16
	datatype   *uint16
}

func (spoolSender) Send(ctx context.Context, t Target, payload []byte) error {
	type opened struct {
		h   windows.Handle
		err error
	}
	ch := make(chan opened, 1)
	go func() {
		h, err := openPrinter(t.Name)
		ch <- opened{h: h, err: err}
	}()

	select {
	case <-ctx.Done():
		go func() {
			res := <-ch
			if res.err == nil {
				_ = closePrinter(res.h)
			}
		}()
		return ctx.Err()
	case res := <-ch:
		if res.err != nil {
			return res.err
		}
		if err := ctx.Err(); err != nil {
			_ = closePrinter(res.h)
			return err
		}
		err := writeRaw(ctx, res.h, payload)
		_ = closePrinter(res.h)
		return err
	}
}

func openPrinter(name string) (windows.Handle, error) {
	p, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return 0, err
	}
	var h windows.Handle
	// NULL defaults: open for printing without changing the default printer.
	if err = procOpenPrinterW.Find(); err != nil {
		return 0, err
	}
	r1, _, callErr := syscall.SyscallN(procOpenPrinterW.Addr(), uintptr(unsafe.Pointer(p)), uintptr(unsafe.Pointer(&h)), 0)
	runtime.KeepAlive(p)
	runtime.KeepAlive(&h)
	if r1 == 0 {
		return 0, callErr
	}
	return h, nil
}

func closePrinter(h windows.Handle) error {
	return callProc(procClosePrinter, uintptr(h))
}

func writeRaw(ctx context.Context, h windows.Handle, payload []byte) (err error) {
	if err = ctx.Err(); err != nil {
		return err
	}
	docName, err := windows.UTF16PtrFromString("WhatOrder")
	if err != nil {
		return err
	}
	datatype, err := windows.UTF16PtrFromString("RAW")
	if err != nil {
		return err
	}
	info := docInfo1{docName: docName, datatype: datatype}
	if err = procStartDocPrinterW.Find(); err != nil {
		return err
	}
	r1, _, callErr := syscall.SyscallN(procStartDocPrinterW.Addr(), uintptr(h), 1, uintptr(unsafe.Pointer(&info)))
	runtime.KeepAlive(&info)
	runtime.KeepAlive(docName)
	runtime.KeepAlive(datatype)
	if r1 == 0 {
		return callErr
	}
	defer func() {
		if endErr := callProc(procEndDocPrinter, uintptr(h)); err == nil {
			err = endErr
		}
	}()
	if err = ctx.Err(); err != nil {
		return err
	}

	if err = callProc(procStartPagePrinter, uintptr(h)); err != nil {
		return err
	}
	defer func() {
		if endErr := callProc(procEndPagePrinter, uintptr(h)); err == nil {
			err = endErr
		}
	}()
	if err = ctx.Err(); err != nil {
		return err
	}
	if len(payload) == 0 {
		return nil
	}
	var written uint32
	if err = procWritePrinter.Find(); err != nil {
		return err
	}
	r1, _, callErr = syscall.SyscallN(procWritePrinter.Addr(),
		uintptr(h),
		uintptr(unsafe.Pointer(&payload[0])),
		uintptr(len(payload)),
		uintptr(unsafe.Pointer(&written)),
	)
	runtime.KeepAlive(payload)
	runtime.KeepAlive(&written)
	if r1 == 0 {
		return callErr
	}
	if written != uint32(len(payload)) {
		return errors.New("short printer write")
	}
	return nil
}

func callProc(proc *windows.LazyProc, args ...uintptr) error {
	if err := proc.Find(); err != nil {
		return err
	}
	r1, _, callErr := proc.Call(args...)
	if r1 == 0 {
		return callErr
	}
	return nil
}
