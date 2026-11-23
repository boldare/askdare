#!/usr/bin/env bash
# The Linux pixel baselines of `pnpm test:visual`, made in the Playwright container that CI's visual
# job runs in (.github/workflows/ci.yml), so they match CI's font rendering on any host:
#   scripts/visual-linux.sh            # writes missing and changed e2e/visual.spec.ts-snapshots/*-linux.png
#   scripts/visual-linux.sh --check    # only compares, like CI
# Needs Docker. The repository's files (tracked and untracked, minus .gitignore) are copied into a
# throwaway container and installed there, so the host's node_modules never mix with Linux ones.
# The container runs on the host's own architecture: under emulation (amd64 on Apple silicon)
# Chromium crashes. The image is the same Ubuntu, fonts and Chromium build on arm64 and amd64, and
# the visual project allows 250 differing pixels; if CI's amd64 render still differs, take the
# -actual.png files from its visual-diffs artifact.
set -euo pipefail

# Keep in step with @playwright/test in pnpm-lock.yaml and the image in ci.yml.
IMAGE='mcr.microsoft.com/playwright:v1.65.1-noble@sha256:1507cbfc550a63a6b7396791ca4f00df17beb56342d2447b3f106c306f525579'
PNPM='pnpm@12.16.1'

repo="$(cd "$(dirname "$0")/.." && pwd)"
snapshots="$repo/e2e/visual.spec.ts-snapshots"
update='--update-snapshots'
if [ "${1:-}" = '--check' ]; then update=''; fi

cd "$repo"
# COPYFILE_DISABLE keeps macOS tar from adding ._ metadata files.
git ls-files -z --cached --others --exclude-standard |
  COPYFILE_DISABLE=1 tar --null -T - -cf - |
  docker run --rm -i --ipc=host \
    -v "$snapshots:/out" \
    -e CI=1 -e NEXT_TELEMETRY_DISABLED=1 \
    "$IMAGE" bash -euo pipefail -c "
      mkdir /work && cd /work && tar -xf -
      npm install --silent --no-audit --no-fund --prefix /opt/pnpm $PNPM
      export PATH=/opt/pnpm/node_modules/.bin:\$PATH
      pnpm install --frozen-lockfile
      pnpm build
      pnpm --filter askdare-site run build
      status=0
      pnpm exec playwright test --project visual $update || status=\$?
      cp e2e/visual.spec.ts-snapshots/*-linux.png /out/ 2>/dev/null || true
      exit \$status
    "
