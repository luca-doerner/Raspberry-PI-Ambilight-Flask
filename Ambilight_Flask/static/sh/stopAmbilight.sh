#!/bin/bash

#settings
FILE_NAME="${FLASK_BASE_PATH}/Ambilight_Flask/static/python/ambilight.py"
PATTERN="${FILE_NAME}"
AUS="${FLASK_BASE_PATH}/Ambilight_Flask/static/python/aus.py"
PID=$(pgrep -f -d ',' ${PATTERN})
COUNT=$(pgrep -fc ${PATTERN})
VENV="${FLASK_BASE_PATH}/venv/bin/activate"

COLORS=true

export FLASK_BASE_PATH=$FLASK_BASE_PATH

#echo function to stderr
echoerr() { echo -e "$@" 1>&2; }

source $VENV

# supress colors if -c is used
while getopts c opt
do
    case $opt in
       c) COLORS=false;;
   esac
done

# no instance
if [ ${COUNT} -eq 0 ]
then
    echo Could not find any running instances of ${PATTERN}
    python3 $AUS
    exit
fi

# one instance
if [ ${COUNT} -eq 1 ]
then
    echo Killing instance of ${PATTERN} with pid ${PID}.
    pkill -f ${PATTERN}
    python3 $AUS
fi

# multiple instances
if [ ${COUNT} -gt 1 ]
then
    echo Killing ${COUNT} instances of ${PATTERN} with pids \[${PID}\].
    pkill -f ${PATTERN}
    python3 $AUS
fi

# set colors (or not)
RED=$( $COLORS && echo "\033[0;31m" || echo "" )
GREEN=$( $COLORS && echo "\033[0;32m" || echo "" )
NC=$( $COLORS && echo "\033[0m" || echo "" ) # No Color

# check if really all terminated (or timeout of ~20s)
i=0
while [[ ${COUNT} -gt 0 && ${i} -lt 7 ]] 
do
    echo "Waiting for programs to exit (timeout in $((21-3*i)) seconds)..."
    sleep 3
    COUNT=$(pgrep -fc ${PATTERN})
    i=$((i+1))
done

if [ ${COUNT} -eq 0 ] 
then
    echo -e ${GREEN}Done: ${NC}Successfully stopped all instances of ${PATTERN}!
else
    echoerr ${RED}Error: ${NC}Timed out - There may still be instances of ${PATTERN} running! Try again or kill program manually.
fi
