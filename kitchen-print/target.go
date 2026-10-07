package main

import (
	"errors"
	"net"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Target is a Windows printer name or an IPv4 raw socket.
type Target struct {
	Kind string
	Name string
	Host string
	Port int
}

// ParseTarget trims value. windows names are 1 to 220 characters.
// ip is an IPv4 address with an optional port (default 9100, range 1 to 65535).
func ParseTarget(kind, value string) (Target, error) {
	value = strings.TrimSpace(value)
	switch kind {
	case "windows":
		n := utf8.RuneCountInString(value)
		if n < 1 || n > 220 {
			return Target{}, errors.New("invalid printer name")
		}
		return Target{Kind: "windows", Name: value}, nil
	case "ip":
		host, port, err := parseIPv4(value)
		if err != nil {
			return Target{}, err
		}
		return Target{Kind: "ip", Host: host, Port: port}, nil
	default:
		return Target{}, errors.New("invalid target")
	}
}

func parseIPv4(value string) (string, int, error) {
	host := value
	port := 9100
	if h, p, err := net.SplitHostPort(value); err == nil {
		host = h
		n, convErr := strconv.Atoi(p)
		if convErr != nil || n < 1 || n > 65535 {
			return "", 0, errors.New("invalid address")
		}
		port = n
	} else if strings.Contains(value, ":") {
		return "", 0, errors.New("invalid address")
	}
	if strings.Contains(host, ":") {
		return "", 0, errors.New("invalid address")
	}
	ip4 := net.ParseIP(host).To4()
	if ip4 == nil {
		return "", 0, errors.New("invalid address")
	}
	return ip4.String(), port, nil
}
