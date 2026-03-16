# Paperclip Fork Recovery Runbook

**Scope:** This document covers recovery procedures for our Paperclip fork at `github.com/Computer8004/paperclip`

**Last Updated:** 2026-03-16

---

## Quick Reference: Emergency Contacts & Access

| Resource | Location | Access |
|----------|----------|--------|
| **Repository** | `~/clawd/projects/paperclip` | Local dev machine |
| **Config** | `~/.paperclip/instances/default/config.json` | Instance settings |
| **Database** | Embedded PostgreSQL on port 54329 | Direct psql access |
| **Logs** | `~/.paperclip/instances/default/logs/` | Server logs |
| **Backups** | `~/.paperclip/instances/default/data/backups/` | Auto backups |
| **Hermes (me!)** | Agent ID: `d08bc900-e08d-44be-89fc-a32bd604118a` | Out-of-band recovery |

---

## Recovery Scenarios

### 1. Server Won't Start

#### Symptoms
- `curl http://localhost:3100/api/health` fails
- Connection refused errors
- Server crashes on startup

#### Diagnosis Steps
```bash
# 1. Check if server process is running
ps aux | grep "paperclip\|tsx.*server" | grep -v grep

# 2. Check recent logs
tail -100 ~/.paperclip/instances/default/logs/server.log

# 3. Check for port conflicts
lsof -i :3100
ss -tlnp | grep 3100

# 4. Check database status
PGPASSWORD=paperclip pg_isready -h 127.0.0.1 -p 54329
```

#### Recovery Commands
```bash
# Hard restart (kills all paperclip processes)
pkill -f "paperclip\|tsx.*server" && sleep 3

# Start fresh
cd ~/clawd/projects/paperclip
pnpm dev:server > ~/paperclip-fork.log 2>&1 &

# Wait and verify
sleep 5
curl http://localhost:3100/api/health
```

#### If Database Won't Start
```bash
# Check embedded postgres logs
ls ~/.paperclip/instances/default/db/log/

# Nuclear option: Reset database (DATA LOSS!)
# Only use if backups are available or data is disposable
rm -rf ~/.paperclip/instances/default/db
cd ~/clawd/projects/paperclip && pnpm db:migrate
```

---

### 2. Database Corruption

#### Symptoms
- Migration failures
- "corrupted" or "invalid" errors
- Data integrity errors

#### Recovery Steps

**Step 1: Check backups**
```bash
ls -la ~/.paperclip/instances/default/data/backups/
# Backups are created hourly, kept for 30 days
```

**Step 2: Restore from backup**
```bash
# Stop server
pkill -f paperclip

# Restore database (replace YYYYMMDD_HHMMSS with actual backup)
BACKUP_NAME="backup_20260316_120000.sql"
PGPASSWORD=paperclip psql -h 127.0.0.1 -p 54329 -U paperclip -d paperclip \
  < ~/.paperclip/instances/default/data/backups/$BACKUP_NAME

# Restart
pnpm dev:server
```

**Step 3: If no backup works**
```bash
# Complete reset (LAST RESORT - ALL DATA LOST)
rm -rf ~/.paperclip/instances/default/
cd ~/clawd/projects/paperclip
pnpm dev:server  # Will re-onboard
```

---

### 3. Build Failures

#### Symptoms
- `pnpm build` fails
- TypeScript errors
- Module not found errors

#### Recovery Commands
```bash
cd ~/clawd/projects/paperclip

# Clean install
rm -rf node_modules pnpm-lock.yaml
pnpm install

# Rebuild all packages
pnpm build

# If still failing, try individual packages
pnpm --filter @paperclipai/db build
pnpm --filter @paperclipai/server build
pnpm --filter @paperclipai/ui build
```

#### Common Build Issues

**Issue: TypeScript errors after merge**
```bash
# Regenerate types
pnpm --filter @paperclipai/db generate
pnpm build
```

**Issue: UI build fails**
```bash
cd ui
rm -rf node_modules dist
pnpm install
pnpm build
```

---

### 4. Configuration Issues

#### Reset Config to Defaults
```bash
# Backup current config
cp ~/.paperclip/instances/default/config.json \
   ~/.paperclip/instances/default/config.json.backup.$(date +%Y%m%d)

# Edit or reset
vim ~/.paperclip/instances/default/config.json

# Or re-onboard (keeps data, resets auth)
curl -X POST http://localhost:3100/api/onboard/reset
```

---

### 5. Out-of-Band Recovery via Hermes (Me!)

**When to use:**
- Server completely inaccessible
- Database locked
- Critical production issue
- Need human-level intervention

**My Capabilities:**
1. Direct database access via psql
2. File system access to repo
3. Git operations
4. Server restart
5. Manual issue resolution

**How to Activate Me:**
```bash
# Ensure I'm properly configured
# Check my agent record:
PGPASSWORD=paperclip psql -h 127.0.0.1 -p 54329 -U paperclip -d paperclip -c "
  SELECT name, status, adapter_type, budget_monthly_cents 
  FROM agents WHERE name = 'Hermes';"

# If I'm paused/unavailable, manually reactivate:
PGPASSWORD=paperclip psql -h 127.0.0.1 -p 54329 -U paperclip -d paperclip -c "
  UPDATE agents SET status = 'idle' WHERE name = 'Hermes';"
```

**Manual Assignment:**
If automatic assignment isn't working, assign me an issue directly:
```bash
PGPASSWORD=paperclip psql -h 127.0.0.1 -p 54329 -U paperclip -d paperclip -c "
  UPDATE issues 
  SET assignee_agent_id = 'd08bc900-e08d-44be-89fc-a32bd604118a',
      status = 'in_progress'
  WHERE id = 'YOUR_ISSUE_ID';"
```

---

## Development Workflow Recovery

### Sync with Upstream Failed
```bash
cd ~/clawd/projects/paperclip

# Check status
git status
git log --oneline -5

# If merge conflict:
git merge --abort  # or resolve manually
git fetch upstream
git rebase upstream/master

# If all else fails: force reset to upstream
git fetch upstream
git reset --hard upstream/master
# Note: This loses local changes!
```

### Rebuild After Major Changes
```bash
cd ~/clawd/projects/paperclip

# Full clean rebuild
rm -rf node_modules pnpm-lock.yaml
pnpm install
pnpm db:migrate
pnpm build

# Restart
pkill -f paperclip
pnpm dev:server
```

---

## Monitoring & Alerting

### Key Metrics to Watch

| Metric | Check Command | Threshold |
|--------|---------------|-----------|
| **Server uptime** | `curl http://localhost:3100/api/health` | Should return 200 |
| **Database size** | `du -sh ~/.paperclip/instances/default/db` | Alert if >10GB |
| **Backup age** | `ls -lt ~/.paperclip/instances/default/data/backups/ | head -1` | Alert if >2 hours |
| **Disk space** | `df -h ~` | Alert if >90% full |

### Automated Checks (Add to cron)
```bash
#!/bin/bash
# /home/computer/.local/bin/check-paperclip.sh

if ! curl -sf http://localhost:3100/api/health > /dev/null; then
  echo "Paperclip is down! Attempting restart..."
  pkill -f paperclip
  sleep 2
  cd ~/clawd/projects/paperclip && pnpm dev:server > /dev/null 2>&1 &
fi
```

---

## Emergency Contacts & Escalation

| Issue | First Contact | Escalation |
|-------|---------------|------------|
| Server down | Auto-restart script | Hermes (me) |
| Data corruption | Restore from backup | Taylor (human) |
| Build failure | Clean rebuild | Hermes (me) |
| Security incident | Hermes (me) | Taylor (human) |
| Upstream merge conflict | Auto-sync script | Hermes (me) |

---

## Post-Incident Actions

After any recovery:

1. **Document what happened** in activity log or issue
2. **Update this runbook** if new scenarios discovered
3. **Verify backups** are still working
4. **Check all agents** are healthy
5. **Review cost budgets** - recovery can be expensive

---

## Revision History

| Date | Author | Changes |
|------|--------|---------|
| 2026-03-16 | Hermes | Initial runbook creation |

---

**Questions?** Tag @Hermes in any issue or reach me through Paperclip assignments.
