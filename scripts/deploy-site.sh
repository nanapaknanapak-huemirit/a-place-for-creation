#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PAGES_KEY="${PAGES_KEY:-$HOME/.ssh/a-place-for-creation-pages}"
BRANCH="${BRANCH:-main}"

if [ ! -f "$PAGES_KEY" ]; then
  echo "Deploy key not found at $PAGES_KEY" >&2
  exit 1
fi

cd "$REPO_DIR"

if [ ! -f index.html ]; then
  echo "Missing index.html; nothing to deploy." >&2
  exit 1
fi

git add -A -- data index.html creative-guide.html assets

if git diff --cached --quiet -- data index.html creative-guide.html assets; then
  echo "No site changes to deploy."
  exit 0
fi

git -c user.name="nanapaknanapak-huemirit" \
    -c user.email="231016085+nanapaknanapak-huemirit@users.noreply.github.com" \
    commit -q -m "deploy: $(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    -- data index.html creative-guide.html assets

ORIGIN="$(git remote get-url origin)"
case "$ORIGIN" in
  https://github.com/*) REMOTE="git@github.com:${ORIGIN#https://github.com/}" ;;
  http://github.com/*) REMOTE="git@github.com:${ORIGIN#http://github.com/}" ;;
  *) REMOTE="$ORIGIN" ;;
esac

GIT_SSH_COMMAND="ssh -i '$PAGES_KEY' -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new" \
  git push "$REMOTE" "HEAD:$BRANCH"

echo "Deployed site changes to $BRANCH"
