#!/bin/bash
# Run real nginx configs in Docker against a stand-in upstream and assert status and Cache-Control.
# Usage: CONF_DIR=<dir with nginx-<name>.conf and www/> run.sh <cases.tsv> <name>...
#   e.g. CONF_DIR=~/.local/share/<project>/nginx run.sh cases.example.tsv prod candidate
# The configs must proxy to 127.0.0.1:3000 (upstream.py) and listen on 3001.
# Extra curl args in cases.tsv use _ for spaces inside one argument.
set -u
T=$(cd "$(dirname "$0")" && pwd); CONF_DIR=${CONF_DIR:-$T}; IMAGE=${NGINX_IMAGE:-nginx:1.30.3}; PY_IMAGE=${PY_IMAGE:-python:3.12-alpine}
UP=macro-up-$$; NG=macro-ng-$$   # per-run names so concurrent runs don't collide
trap 'docker rm -f $UP $NG >/dev/null 2>&1' EXIT
CASES=${1:?cases.tsv}; shift; [ $# -gt 0 ] || { echo "name at least one config"; exit 2; }
H=$(printf 'a%.0s' {1..64}); fail=0
check() { # name path expected-status expected-cache-control [extra curl args]
  local out st cc
  out=$(docker exec $UP curl -s -o /dev/null -D - "${@:5}" "http://127.0.0.1:3001$2")
  st=$(echo "$out" | head -1 | awk '{print $2}')
  cc=$(echo "$out" | grep -i '^cache-control:' | tr -d '\r' | cut -d' ' -f2- | paste -sd'|' -)
  if [ "$st" = "$3" ] && [ "$cc" = "$4" ]; then echo "  PASS $1: $st [$cc]"; else echo "  FAIL $1: got $st [$cc], want $3 [$4]"; fail=1; fi
}
for c in "$@"; do
  echo "== $c"
  docker rm -f $UP $NG >/dev/null 2>&1
  docker run -d --name $UP -v "$CONF_DIR/www:/www:ro" -v "$T/upstream.py:/upstream.py:ro" "$PY_IMAGE" sh -c "apk add -q curl >/dev/null; python /upstream.py" >/dev/null
  docker run -d --name $NG --network container:$UP -v "$CONF_DIR/nginx-$c.conf:/etc/nginx/nginx.conf:ro" "$IMAGE" >/dev/null
  for _ in $(seq 1 30); do docker exec $UP curl -s -o /dev/null http://127.0.0.1:3001/ 2>/dev/null && break; sleep 0.5; done
  docker exec $NG nginx -t 2>&1 | grep -q "successful" && echo "  PASS nginx -t" || { echo "  FAIL nginx -t"; docker logs $NG 2>&1 | tail -3; fail=1; }
  while IFS=$'\t' read -r -u 3 name path status cc extra; do
    [ -z "$name" ] || [ "${name:0:1}" = "#" ] && continue
    set -f; args=(); for a in $extra; do args+=("${a//_/ }"); done; set +f
    check "$name" "${path//DIGEST/$H}" "$status" "$cc" ${args[@]+"${args[@]}"}
  done 3< "$CASES"
done
exit $fail
