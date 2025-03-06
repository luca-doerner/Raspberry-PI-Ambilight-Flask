COUNT=$(pgrep -fc "test.py")

if [ ${COUNT} -gt 1 ]
then
    pkill -f "test.py"
fi