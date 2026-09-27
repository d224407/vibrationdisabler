#!/system/bin/sh
MODDIR=${0%/*}
APPS_FILE="$MODDIR/apps.txt"

if [ -f "$APPS_FILE" ]; then
    while IFS= read -r app || [ -n "$app" ]; do
        app=$(printf '%s' "$app" | tr -d '\r')
        [ -n "$app" ] && cmd appops set "$app" VIBRATE allow 2>/dev/null
    done < "$APPS_FILE"
fi

rm -f "$APPS_FILE"
exit 0
