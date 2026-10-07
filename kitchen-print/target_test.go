package main

import (
	"strings"
	"testing"
)

func TestParseTarget(t *testing.T) {
	got, err := ParseTarget("windows", "EPSON TM-T20II")
	if err != nil {
		t.Fatal(err)
	}
	if got.Kind != "windows" || got.Name != "EPSON TM-T20II" {
		t.Fatalf("%+v", got)
	}

	trimmed, err := ParseTarget("windows", "  EPSON TM-T20II  ")
	if err != nil {
		t.Fatal(err)
	}
	if trimmed.Name != "EPSON TM-T20II" {
		t.Fatalf("trim %+v", trimmed)
	}

	if _, err := ParseTarget("windows", strings.Repeat("a", 220)); err != nil {
		t.Fatal(err)
	}
	if _, err := ParseTarget("windows", ""); err == nil {
		t.Fatal("blank name")
	}
	if _, err := ParseTarget("windows", "   "); err == nil {
		t.Fatal("blank name")
	}
	if _, err := ParseTarget("windows", strings.Repeat("a", 221)); err == nil {
		t.Fatal("221-character name")
	}

	ip, err := ParseTarget("ip", "192.168.1.50")
	if err != nil {
		t.Fatal(err)
	}
	if ip.Kind != "ip" || ip.Host != "192.168.1.50" || ip.Port != 9100 {
		t.Fatalf("%+v", ip)
	}

	custom, err := ParseTarget("ip", "192.168.1.50:9101")
	if err != nil {
		t.Fatal(err)
	}
	if custom.Host != "192.168.1.50" || custom.Port != 9101 {
		t.Fatalf("%+v", custom)
	}

	for _, bad := range []string{"10.0.0.1:0", "printer.local", "192.168.1.50:99999"} {
		if _, err := ParseTarget("ip", bad); err == nil {
			t.Fatalf("accepted %q", bad)
		}
	}
	if _, err := ParseTarget("usb", "EPSON TM-T20II"); err == nil {
		t.Fatal("unknown kind")
	}
}
