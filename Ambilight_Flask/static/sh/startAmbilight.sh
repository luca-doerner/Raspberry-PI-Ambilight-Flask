#!/bin/bash

# options:
    # -f to run the program in foreground
    # -s or -q to supress additional startup information
    # -c to supress colored output

config="$(dirname "$(realpath "$0")")/../config.json"

export FLASK_BASE_PATH=$(jq -r ".base_path" "$config")

#settings
PYTHON_FILE=$FLASK_BASE_PATH/Ambilight_Flask/static/python/ambilight.py
NOHUP_OUT=$FLASK_BASE_PATH/Ambilight_Flask/logs/ambilight-nohup.out
VENV=$FLASK_BASE_PATH/venv/bin/activate

# option variables
FOREGROUND=false
SILENT=false
COLORS=true
DEBUG=""

#echo function to stderr
echoerr() { echo -e "$@" 1>&2; }

source $VENV

# get options
while getopts fsqcd opt
do
    case $opt in
       f) FOREGROUND=true;;
       s) SILENT=true;;
       q) SILENT=true;;
       c) COLORS=false;;
       d) DEBUG=--debug;;
   esac
done

# set colors (or not)
RED=$( $COLORS && echo "\033[0;31m" || echo "" )
YELLOW=$( $COLORS && echo "\033[0;33m" || echo "" )
GREEN=$( $COLORS && echo "\033[0;32m" || echo "" )
NC=$( $COLORS && echo "\033[0m" || echo "" ) # No Color

if [ ! -f $PYTHON_FILE ]
then
    echoerr "${RED}Error: ${NC}Given PYTHON_FILE ($PYTHON_FILE) is missing!"
    exit 1
fi 


if [ $FOREGROUND = true ]
then
    python3 $PYTHON_FILE $DEBUG
else
    nohup python3 $PYTHON_FILE $DEBUG > ${NOHUP_OUT} &
    sleep 1
    if [ $SILENT = false ]
    then
        echo "Waiting for Ambilight to start (timeout in 60 seconds)..."
        sleep 2
        PID=$(pgrep -f $PYTHON_FILE)
        STARTED=$(grep "Started.*" ${NOHUP_OUT})
        SHUTDOWN=$(grep "Fehler: HDMI-Capture-Device 1 nicht gefunden" ${NOHUP_OUT})
        i=0
        while [[ -z $STARTED && -z $SHUTDOWN && ${i} -lt 19 ]]
        do
            echo "Waiting for Ambilight to start (timeout in $((60-3*(i+1))) seconds)..."
            sleep 3
            STARTED=$(grep "Started.*" ${NOHUP_OUT})
            SHUTDOWN=$(grep 'Shutdown completed\|Application run failed' ${NOHUP_OUT})
            i=$((i+1))
        done

        if [ -n "$SHUTDOWN" ]
        then # start failed
            echoerr "${RED}Error: ${NC}Application ${PYTHON_FILE} shutdown, please make sure, no other instance of this application is running and check ${NOHUP_OUT} !"
            exit 1
        fi

        if [ -n "$STARTED" ]
        then # start successful
            START_TIME=$(echo ${STARTED} | grep -o '[0-9]*\.[0-9]* seconds')
            echo -e "${GREEN}Done: ${NC}Successfully started ${PYTHON_FILE} (pid: ${PID}) in background (${START_TIME})! Output is written to ${NOHUP_OUT}"
        else # timeout
            echoerr "${YELLOW}Warning: ${NC}Application ${PYTHON_FILE} could not be started within 60 seconds, which is unusual, please check ${NOHUP_OUT} !"
            exit 1
        fi
    fi
    exit
fi