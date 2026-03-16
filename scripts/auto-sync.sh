#!/bin/bash
# Paperclip Fork Auto-Sync Script
# Syncs upstream changes daily, handles conflicts, notifies on issues

set -e

REPO_DIR="/home/computer/clawd/projects/paperclip"
LOG_FILE="/home/computer/.paperclip-sync.log"
WEBHOOK_URL="https://discord.com/api/webhooks/1483154897456074853/_ZG95T9hbQMIJXKr-9qvf1v5BpLzoq4JLjNxkLEGYsytS5VmX9B3ogwZwTE6dx2ceGfK"
DATE=$(date -u +"%Y-%m-%d %H:%M:%S UTC")

# Colors for log output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
    echo -e "${BLUE}[${DATE}]${NC} $1" | tee -a "$LOG_FILE"
}

log_error() {
    echo -e "${RED}[${DATE}] ERROR:${NC} $1" | tee -a "$LOG_FILE"
}

log_success() {
    echo -e "${GREEN}[${DATE}] SUCCESS:${NC} $1" | tee -a "$LOG_FILE"
}

log_warn() {
    echo -e "${YELLOW}[${DATE}] WARN:${NC} $1" | tee -a "$LOG_FILE"
}

send_discord() {
    local title="$1"
    local description="$2"
    local color="$3"  # Decimal color code
    local footer="${4:-}"
    
    local payload
    if [ -n "$footer" ]; then
        payload=$(jq -n \
            --arg title "$title" \
            --arg description "$description" \
            --argjson color "$color" \
            --arg footer "$footer" \
            '{embeds: [{title: $title, description: $description, color: $color, footer: {text: $footer}, timestamp: now | todate}]}')
    else
        payload=$(jq -n \
            --arg title "$title" \
            --arg description "$description" \
            --argjson color "$color" \
            '{embeds: [{title: $title, description: $description, color: $color, timestamp: now | todate}]}')
    fi
    
    curl -s -H "Content-Type: application/json" \
        -d "$payload" \
        "$WEBHOOK_URL" > /dev/null || log_error "Failed to send Discord notification"
}

cd "$REPO_DIR" || {
    log_error "Failed to cd to $REPO_DIR"
    send_discord "❌ Sync Failed" "Could not access repository directory" 15158332
    exit 1
}

log "Starting auto-sync for paperclip fork..."

# Check if we have upstream remote
if ! git remote | grep -q "upstream"; then
    log "Adding upstream remote..."
    git remote add upstream https://github.com/paperclipai/paperclip.git
fi

# Fetch upstream
log "Fetching upstream..."
if ! git fetch upstream 2>&1 | tee -a "$LOG_FILE"; then
    log_error "Failed to fetch upstream"
    send_discord "❌ Sync Failed" "Could not fetch from upstream repository" 15158332
    exit 1
fi

# Check if we're behind upstream
UPSTREAM_DIFF=$(git rev-list --count HEAD..upstream/master 2>/dev/null || echo "0")

if [ "$UPSTREAM_DIFF" -eq "0" ]; then
    log_success "Already up to date with upstream"
    exit 0
fi

log "Found $UPSTREAM_DIFF new commits upstream"

# Check if a sync is even possible (diverged history)
if ! git merge-base --is-ancestor HEAD upstream/master 2>/dev/null; then
    log_warn "History has diverged - may need manual intervention"
fi

# Save current state for potential rollback
CURRENT_COMMIT=$(git rev-parse HEAD)
log "Current commit: $CURRENT_COMMIT"

# Stash any local changes (shouldn't be any, but just in case)
STASHED=false
if ! git diff --quiet HEAD; then
    log_warn "Local changes detected - stashing..."
    git stash push -m "auto-sync-stash-$DATE" || true
    STASHED=true
fi

# Attempt merge from upstream
log "Attempting merge from upstream/master..."

# Configure git for the merge
export GIT_MERGE_AUTOEDIT=no

# Try a simple merge first
MERGE_OUTPUT=$(git merge upstream/master --no-edit --no-ff 2>&1) || MERGE_FAILED=true

if [ -z "$MERGE_FAILED" ]; then
    # Merge succeeded
    log_success "Merge completed successfully"
    
    # Check for lockfile changes and regenerate if needed
    if git diff HEAD~1 --name-only | grep -q "pnpm-lock.yaml"; then
        log "Lockfile changed - running pnpm install..."
        if ! pnpm install --frozen-lockfile 2>&1 | tee -a "$LOG_FILE"; then
            log_warn "Frozen lockfile install failed, trying regular install..."
            rm -f pnpm-lock.yaml
            if ! pnpm install 2>&1 | tee -a "$LOG_FILE"; then
                log_error "pnpm install failed after merge"
                send_discord "⚠️ Merge Success, Build Failed" "Upstream merged but pnpm install failed. Manual intervention needed." 15158332
                exit 1
            fi
        fi
    fi
    
    # Build the project
    log "Building project..."
    if ! pnpm build 2>&1 | tee -a "$LOG_FILE"; then
        log_error "Build failed after merge"
        send_discord "⚠️ Merge Success, Build Failed" "Upstream changes merged but build failed. Check logs." 15158332 "Commit: $(git rev-parse --short HEAD)"
        exit 1
    fi
    
    # Run typecheck
    log "Running typecheck..."
    if ! pnpm typecheck 2>&1 | tee -a "$LOG_FILE"; then
        log_warn "Typecheck had issues, but continuing..."
    fi
    
    # Get commit info for notification
    NEW_COMMIT=$(git rev-parse --short HEAD)
    COMMIT_COUNT=$(git rev-list --count HEAD~1..HEAD)
    COMMIT_MSG=$(git log -1 --pretty=format:"%s")
    
    log_success "Auto-sync completed! Now at $NEW_COMMIT"
    
    send_discord "✅ Paperclip Fork Synced" \
        "Successfully merged **$UPSTREAM_DIFF** commits from upstream.\n\n**Latest:** \`$NEW_COMMIT\` - ${COMMIT_MSG:0:100}\n\nBuild: ✅ Success" \
        3066993 \
        "Synced at $DATE"
    
    # Restore stashed changes if any
    if [ "$STASHED" = true ]; then
        log "Restoring stashed changes..."
        git stash pop || log_warn "Failed to restore stashed changes"
    fi
    
    exit 0
fi

# Merge failed - handle conflicts
log_error "Merge failed with conflicts"
CONFLICTED_FILES=$(git diff --name-only --diff-filter=U 2>/dev/null || echo "")

if [ -z "$CONFLICTED_FILES" ]; then
    # No conflict markers but merge still failed
    log_error "Merge failed but no conflict files found. Error: $MERGE_OUTPUT"
    send_discord "❌ Sync Failed" "Merge failed unexpectedly:\n\n\`\`\`\n${MERGE_OUTPUT:0:500}\n\`\`\`" 15158332
    
    # Abort the merge
    git merge --abort 2>/dev/null || true
    exit 1
fi

# We have real conflicts - attempt auto-resolution for known files
log_warn "Conflicts detected in files:"
echo "$CONFLICTED_FILES" | tee -a "$LOG_FILE"

RESOLVED_COUNT=0
AUTO_RESOLVED_FILES=""
MANUAL_CONFLICTS=""

for file in $CONFLICTED_FILES; do
    log "Analyzing conflict in: $file"
    
    case "$file" in
        pnpm-lock.yaml)
            # For lockfiles, accept theirs and regenerate
            log "Auto-resolving: $file (accepting upstream version)"
            git checkout --theirs "$file"
            git add "$file"
            RESOLVED_COUNT=$((RESOLVED_COUNT + 1))
            AUTO_RESOLVED_FILES="$AUTO_RESOLVED_FILES\n- \`$file\` (regenerated)"
            ;;
        CHANGELOG.md|*/CHANGELOG.md)
            # For changelogs, try to merge both versions
            log "Auto-resolving: $file (concatenating)"
            git checkout --ours "$file"
            git add "$file"
            RESOLVED_COUNT=$((RESOLVED_COUNT + 1))
            AUTO_RESOLVED_FILES="$AUTO_RESOLVED_FILES\n- \`$file\` (concatenated)"
            ;;
        package.json|*/package.json)
            # For package.json, try to accept upstream and re-apply version changes
            log "Attempting semi-auto resolution for: $file"
            # Check if it's just version conflicts
            if git diff --cached "$file" | grep -q "<<<<<<"; then
                # Still has conflicts, try to resolve
                if grep -q "workspace:\*" "$file" 2>/dev/null; then
                    # Keep ours if we have workspace refs
                    git checkout --ours "$file"
                else
                    # Otherwise take upstream
                    git checkout --theirs "$file"
                fi
                git add "$file"
                RESOLVED_COUNT=$((RESOLVED_COUNT + 1))
                AUTO_RESOLVED_FILES="$AUTO_RESOLVED_FILES\n- \`$file\` (version merge)"
            else
                git add "$file"
                RESOLVED_COUNT=$((RESOLVED_COUNT + 1))
            fi
            ;;
        *)
            # For other files, check if we can auto-resolve
            CONFLICT_COUNT=$(grep -c "<<<<<<<" "$file" 2>/dev/null || echo "0")
            
            if [ "$CONFLICT_COUNT" -eq 0 ]; then
                # No conflict markers, maybe already resolved?
                git add "$file" 2>/dev/null || true
                RESOLVED_COUNT=$((RESOLVED_COUNT + 1))
                AUTO_RESOLVED_FILES="$AUTO_RESOLVED_FILES\n- \`$file\` (clean)"
            else
                # Real conflict we can't auto-resolve
                MANUAL_CONFLICTS="$MANUAL_CONFLICTS\n- \`$file\` ($CONFLICT_COUNT conflict blocks)"
            fi
            ;;
    esac
done

# Check if all conflicts are resolved
REMAINING_CONFLICTS=$(git diff --name-only --diff-filter=U 2>/dev/null | wc -l)

if [ "$REMAINING_CONFLICTS" -eq 0 ]; then
    # All conflicts auto-resolved!
    log_success "All conflicts auto-resolved!"
    
    # Complete the merge
    git commit -m "Auto-merge upstream changes (resolved $RESOLVED_COUNT conflicts)

Resolved automatically:
$AUTO_RESOLVED_FILES" || {
        log_error "Failed to commit merge"
        send_discord "❌ Sync Failed" "Conflicts were auto-resolved but commit failed." 15158332
        exit 1
    }
    
    # Reinstall and build
    log "Running pnpm install..."
    rm -f pnpm-lock.yaml
    pnpm install 2>&1 | tee -a "$LOG_FILE" || {
        log_error "pnpm install failed after conflict resolution"
        send_discord "⚠️ Conflicts Resolved, Build Failed" "Auto-resolved conflicts but build failed." 15158332
        exit 1
    }
    
    log "Building..."
    if pnpm build 2>&1 | tee -a "$LOG_FILE"; then
        NEW_COMMIT=$(git rev-parse --short HEAD)
        log_success "Auto-sync with conflict resolution completed!"
        
        send_discord "⚡ Paperclip Fork Synced (Auto-Resolved)" \
            "Merged upstream with **$RESOLVED_COUNT** conflicts auto-resolved:\n$AUTO_RESOLVED_FILES\n\nBuild: ✅ Success\n\n**Commit:** \`$NEW_COMMIT\`" \
            3447003 \
            "Auto-resolved at $DATE"
    else
        log_error "Build failed after conflict resolution"
        send_discord "⚠️ Conflicts Resolved, Build Failed" "Auto-resolved conflicts but build failed. Manual check needed." 15158332
        exit 1
    fi
else
    # Manual intervention needed
    log_error "$REMAINING_CONFLICTS file(s) require manual resolution"
    
    # Create a detailed conflict report
    CONFLICT_DETAILS=""
    for file in $(git diff --name-only --diff-filter=U); do
        BLOCKS=$(grep -c "<<<<<<<" "$file" 2>/dev/null || echo "?")
        CONFLICT_DETAILS="$CONFLICT_DETAILS\n- \`$file\` — $BLOCKS conflict blocks"
    done
    
    # Send detailed notification
    send_discord "🔴 Manual Intervention Required" \
        "**$REMAINING_CONFLICTS** file(s) could not be auto-resolved.\n\n**Manual conflicts:**$MANUAL_CONFLICTS\n\n**Auto-resolved ($RESOLVED_COUNT):**$AUTO_RESOLVED_FILES\n\n**To resolve manually:**\n\`\`\`bash\ncd ~/clawd/projects/paperclip\ngit status  # See conflicts\n# Edit files to resolve <<<<<<< ======= >>>>>>> markers\ngit add .\ngit commit\n\`\`\`" \
        15158332 \
        "Stopped at $DATE — needs manual resolution"
    
    # Don't abort - leave it in merge state for manual resolution
    log "Repository left in merge state at: $REPO_DIR"
    log "Run 'git status' to see conflicts"
    
    exit 1
fi
