#!/data/data/com.termux/files/usr/bin/sh
# Starts the always-on server when the phone boots (Termux:Boot).
# Install: mkdir -p ~/.termux/boot && cp scripts/termux-boot.sh ~/.termux/boot/alife && chmod +x ~/.termux/boot/alife
# Logs go to ~/alife-server.log. Adjust ALIFE_DIR if the project lives elsewhere.
ALIFE_DIR="$HOME/artificial-life"

termux-wake-lock
cd "$ALIFE_DIR" || exit 1
# A capped speed keeps the phone cool; raise it if temperatures allow.
ALIFE_MAX_SPEED=30 nohup node dist-server/main.js >> "$HOME/alife-server.log" 2>&1 &
