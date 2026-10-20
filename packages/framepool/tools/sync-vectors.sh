#!/usr/bin/env bash
# Copy exp-mempool-l2s's conformance vectors, byte for byte, at a commit, and list their SHA-256.
#
# Usage: tools/sync-vectors.sh <exp-mempool-l2s checkout> <commit>
#
# The vectors are exp-mempool-l2s's (github.com/4w44h9jckz-boop/exp-mempool-l2s, `conformance/vectors/`)
# and are never edited here: a vector this package disagrees with is settled in
# exp-mempool-l2s and copied again (exp-mempool-l2s decision record 0035).
set -euo pipefail
spec=$1
commit=$(git -C "$spec" rev-parse "$2")
here=$(cd "$(dirname "$0")/.." && pwd)
rm -rf "$here/test/vectors"
mkdir -p "$here/test/vectors"
git -C "$spec" archive "$commit" conformance/vectors | tar -x -C "$here/test/vectors" --strip-components=2
(cd "$here/test/vectors" && find . -name '*.json' | LC_ALL=C sort | sed 's|^\./||' | xargs sha256sum) > "$here/test/vectors.sha256"
echo "$commit" > "$here/test/vectors.commit"
echo "copied $(wc -l < "$here/test/vectors.sha256") vector files from exp-mempool-l2s at $commit"
