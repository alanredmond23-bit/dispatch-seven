#!/bin/bash
# Watches Claude logs for the post-compact re-emit drop bug and auto-restarts Claude app.

LOG="$HOME/Library/Logs/Claude/main.log"
WATCHDOG_LOG="$HOME/Library/Logs/Claude/dispatch_watchdog.log"
COOLDOWN=120  # seconds between restarts — avoids restart loops
LAST_RESTART=0

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$WATCHDOG_LOG"
}

restart_claude() {
    local now
    now=$(date +%s)
    local since=$(( now - LAST_RESTART ))

    if [[ $since -lt $COOLDOWN ]]; then
        log "Restart skipped — cooldown (${since}s < ${COOLDOWN}s)"
        return
    fi

    LAST_RESTART=$now
    log "DROP DETECTED — restarting Claude app to create fresh Dispatch session"
    pkill -x Claude 2>/dev/null
    sleep 2
    open -a Claude
    log "Claude relaunched — new Dispatch session will be created"
}

log "Dispatch watchdog started (PID=$$, monitoring $LOG)"

# Tail the log file and watch for the drop pattern
tail -F "$LOG" 2>/dev/null | while read -r line; do
    if echo "$line" | grep -q "Dropping user echo with empty inboundUserMessages FIFO"; then
        log "CAUGHT: $line"
        restart_claude
    fi
done
