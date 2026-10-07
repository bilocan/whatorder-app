package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestEncodeSlipKeepsAmountAndCuts(t *testing.T) {
	raw, err := EncodeSlip(Slip{
		Code:           "0XG2YS",
		RestaurantName: "Bär",
		Lines:          []Line{{Label: strings.Repeat("A", 50), Amount: "€15.90"}},
		TotalLabel:     "Summe",
		TotalAmount:    "€15.90",
		Payment:        "Bar",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !bytesHasPrefix(raw, []byte{0x1B, 0x40}) {
		t.Fatalf("missing init ESC @: %x", raw[:4])
	}
	if !bytesContains(raw, []byte{0x1B, 0x74, 0x13}) {
		t.Fatal("missing ESC t 19")
	}
	if !bytesContains(raw, []byte{0x1B, 0x4D, 0x00}) {
		t.Fatal("missing Font A")
	}
	if !bytesContains(raw, []byte{0xD5, '1', '5', '.', '9', '0'}) {
		t.Fatal("euro amount was shortened or not PC858")
	}
	if !bytesContains(raw, []byte{0x84}) { // ä in Bär
		t.Fatal("missing PC858 ä")
	}
	wantTail := []byte{0x0A, 0x0A, 0x0A, 0x0A, 0x1D, 0x56, 0x42, 0x00}
	if !bytesHasSuffix(raw, wantTail) {
		t.Fatalf("tail = %x", raw[len(raw)-8:])
	}
	first := firstTextLine(raw)
	if len(first) != 48 {
		t.Fatalf("first item line columns = %d", len(first))
	}
	if !bytesHasSuffix(first, []byte{0xD5, '1', '5', '.', '9', '0'}) {
		t.Fatalf("amount not at end of first line: %x", first)
	}
}

func TestEncodeSlipReplacesTurkish(t *testing.T) {
	raw, err := EncodeSlip(Slip{
		Code:  "A1",
		Lines: []Line{{Label: "1× ş", Amount: "€1.00"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if bytesContains(raw, []byte("ş")) {
		t.Fatal("ş must not be sent as UTF-8")
	}
	if !bytesContains(raw, []byte{'?'}) {
		t.Fatal("expected ? replacement")
	}
}

func TestEncodeSlipRejectsEmpty(t *testing.T) {
	if _, err := EncodeSlip(Slip{Lines: []Line{{Label: "x", Amount: "€1.00"}}}); err == nil {
		t.Fatal("empty code")
	}
	if _, err := EncodeSlip(Slip{Code: "A1"}); err == nil {
		t.Fatal("missing lines")
	}
}

func bytesHasPrefix(b, prefix []byte) bool {
	return len(b) >= len(prefix) && bytes.Equal(b[:len(prefix)], prefix)
}
func bytesHasSuffix(b, suffix []byte) bool {
	return len(b) >= len(suffix) && bytes.Equal(b[len(b)-len(suffix):], suffix)
}
func bytesContains(b, sub []byte) bool { return bytes.Contains(b, sub) }

func firstTextLine(raw []byte) []byte {
	const needle = "\xD515.90"
	i := bytes.Index(raw, []byte(needle))
	if i < 0 {
		return nil
	}
	start := bytes.LastIndex(raw[:i], []byte{0x0A}) + 1
	end := i + len(needle)
	return raw[start:end]
}
