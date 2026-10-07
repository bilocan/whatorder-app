package main

import (
	"bytes"
	"errors"
	"strings"

	"golang.org/x/text/encoding/charmap"
)

// Line is one priced row on the kitchen bon.
type Line struct {
	Label  string `json:"label"`
	Amount string `json:"amount"`
}

// Slip matches the dashboard OrderBelegPrintInput JSON.
type Slip struct {
	Code              string   `json:"code"`
	RestaurantName    string   `json:"restaurantName"`
	RestaurantAddress string   `json:"restaurantAddress"`
	RestaurantPhone   string   `json:"restaurantPhone"`
	CustomerName      string   `json:"customerName"`
	CustomerPhone     string   `json:"customerPhone"`
	OrderedAt         string   `json:"orderedAt"`
	Fulfillment       string   `json:"fulfillment"`
	Address           string   `json:"address"`
	Lines             []Line   `json:"lines"`
	Adjustments       []string `json:"adjustments"`
	TotalLabel        string   `json:"totalLabel"`
	TotalAmount       string   `json:"totalAmount"`
	Notes             string   `json:"notes"`
	Payment           string   `json:"payment"`
}

const slipColumns = 48

// EncodeSlip renders the bon as ESC/POS bytes for an 80 mm Epson.
// An empty code, or missing or empty lines, returns an error and no bytes.
func EncodeSlip(s Slip) ([]byte, error) {
	if s.Code == "" {
		return nil, errors.New("code is empty")
	}
	if len(s.Lines) == 0 {
		return nil, errors.New("lines are missing")
	}

	var text []string
	text = appendWrapped(text, s.RestaurantName)
	text = appendWrapped(text, s.RestaurantAddress)
	text = appendWrapped(text, s.RestaurantPhone)
	text = appendWrapped(text, "#"+s.Code)
	text = appendWrapped(text, s.CustomerName)
	text = appendWrapped(text, s.CustomerPhone)
	text = appendWrapped(text, s.OrderedAt)
	text = appendWrapped(text, s.Fulfillment)
	text = appendWrapped(text, s.Address)
	for _, line := range s.Lines {
		text = append(text, itemRow(line.Label, line.Amount, slipColumns)...)
	}
	for _, adj := range s.Adjustments {
		text = appendWrapped(text, adj)
	}
	if s.TotalLabel != "" || s.TotalAmount != "" {
		text = append(text, itemRow(s.TotalLabel, s.TotalAmount, slipColumns)...)
	}
	text = appendWrapped(text, s.Notes)
	text = appendWrapped(text, s.Payment)

	var buf bytes.Buffer
	buf.Write([]byte{0x1B, 0x40})       // ESC @
	buf.Write([]byte{0x1B, 0x74, 0x13}) // ESC t 19 (PC858)
	buf.Write([]byte{0x1B, 0x4D, 0x00}) // ESC M 0 (Font A)
	for _, line := range text {
		buf.Write(toPC858(line))
		buf.WriteByte('\n')
	}
	buf.Write([]byte{'\n', '\n', '\n', '\n'})
	buf.Write([]byte{0x1D, 0x56, 0x42, 0x00}) // GS V 66 0
	return buf.Bytes(), nil
}

func appendWrapped(lines []string, s string) []string {
	if s == "" {
		return lines
	}
	return append(lines, wrapColumns(s, slipColumns)...)
}

// toPC858 encodes one rune at a time. A rune that errors or is not one byte becomes '?'.
func toPC858(s string) []byte {
	enc := charmap.CodePage858.NewEncoder()
	dst := make([]byte, 8)
	out := make([]byte, 0, len(s))
	for _, r := range s {
		enc.Reset()
		n, _, err := enc.Transform(dst, []byte(string(r)), true)
		if err != nil || n != 1 {
			out = append(out, '?')
			continue
		}
		out = append(out, dst[0])
	}
	return out
}

// wrapColumns breaks s before the PC858 column count would pass width.
func wrapColumns(s string, width int) []string {
	if s == "" || width <= 0 {
		return nil
	}
	var lines []string
	var b strings.Builder
	cols := 0
	for _, r := range s {
		w := len(toPC858(string(r)))
		if cols > 0 && cols+w > width {
			lines = append(lines, b.String())
			b.Reset()
			cols = 0
		}
		b.WriteRune(r)
		cols += w
	}
	if b.Len() > 0 {
		lines = append(lines, b.String())
	}
	return lines
}

// itemRow keeps the full amount on the first line and wraps the label after it.
func itemRow(label, amount string, width int) []string {
	amtCols := len(toPC858(amount))
	if amtCols >= width {
		lines := []string{amount}
		if label != "" {
			lines = append(lines, wrapColumns(label, width)...)
		}
		return lines
	}
	budget := width - amtCols - 1
	var b strings.Builder
	used := 0
	rest := ""
	for i, r := range label {
		w := len(toPC858(string(r)))
		if used+w > budget {
			rest = label[i:]
			break
		}
		b.WriteRune(r)
		used += w
	}
	first := b.String() + strings.Repeat(" ", budget-used) + " " + amount
	lines := []string{first}
	if rest != "" {
		lines = append(lines, wrapColumns(rest, width)...)
	}
	return lines
}
