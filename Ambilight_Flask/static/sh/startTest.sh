echoerr() { echo -e "$@" 1>&2; }

source /workspaces/Raspberry-PI-Ambilight-Flask/venv/bin/activate
nohup python3 /workspaces/Raspberry-PI-Ambilight-Flask/Ambilight_Flask/static/python/test.py > /workspaces/Raspberry-PI-Ambilight-Flask/Ambilight_Flask/test-nohup.out &