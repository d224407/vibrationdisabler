#!/system/bin/sh
MODDIR=${0%/*}
APPS_FILE="$MODDIR/apps.txt"

while [ "$(getprop sys.boot_completed)" != "1" ]; do
    sleep 1
done
sleep 5

if [ -f "$APPS_FILE" ]; then
    while IFS= read -r app || [ -n "$app" ]; do
        app=$(printf '%s' "$app" | tr -d '\r')
        [ -n "$app" ] && cmd appops set "$app" VIBRATE ignore 2>/dev/null
    done < "$APPS_FILE"
fi

exit 0
