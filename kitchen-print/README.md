# kitchen-print

Local program that prints a kitchen bon to a named Windows printer or a printer IP. It listens on `127.0.0.1:17341` only.

## Build on Linux

```
cd kitchen-print
GOOS=windows GOARCH=amd64 go build -ldflags "-H windowsgui" -o kitchen-print.exe .
```

## Kitchen PC

Copy `kitchen-print.exe` onto the kitchen PC. Put a shortcut in `shell:startup`. The shortcut target is the exe path. No other flags.

The Epson stays a normal Windows printer. It does not need to be the default.

## Chrome

In the kitchen Chrome profile, allow local network access for `https://dashboard.whatorder.at`, `https://dashboard-test.whatorder.at`, and `https://pre.whatorder.at`. A `--kiosk` window can hide that prompt. If it was never granted, the board says the program is not running.

## Confirm

Print one bon. The payment line is above the cut. A second tap during the first job does not print a second slip.

Each job appends one line to `%LOCALAPPDATA%\WhatOrder\kitchen-print.log`: UTC time, order code, target kind, and `ok` or the error text.
