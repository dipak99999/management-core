#!/usr/bin/env bash
# Kill every service (:4101-4110) + every frontend (:3100-3107) started by
# start-all-services.sh / start-all-frontends.sh. `pkill -f "opennext-erp/apps"`
# doesn't work — the Bash launcher forks a detached `node ... next-server`
# child that doesn't inherit the /apps path in its argv. Fastest reliable
# kill is `lsof -tiTCP:$port` per port + kill -9.
set -u

killed=0
for port in 4101 4102 4103 4104 4105 4106 4109 4110 3100 3101 3102 3103 3104 3105 3106 3107; do
  pid=$(lsof -tiTCP:$port -sTCP:LISTEN 2>/dev/null)
  if [ -n "$pid" ]; then
    echo "  :$port PID $pid → kill -9"
    kill -9 $pid 2>/dev/null || true
    killed=$((killed + 1))
  fi
done
if [ $killed -eq 0 ]; then
  echo "nothing to kill"
else
  echo "killed $killed process(es)"
fi
