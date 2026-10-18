SKIPUNZIP=0

# Keep the muted list when the module is updated (or renamed from Vibrator Controller)
MODID="$(grep '^id=' "$MODPATH/module.prop" | cut -d= -f2)"
for cand in \
  "/data/adb/modules/$MODID/apps.txt" \
  "/data/adb/modules_update/$MODID/apps.txt" \
  "/data/adb/modules/vibratorcontroller/apps.txt" \
  "/data/adb/modules_update/vibratorcontroller/apps.txt"
do
  if [ -s "$cand" ]; then
    cp -f "$cand" "$MODPATH/apps.txt"
    ui_print "- Existing muted list kept"
    break
  fi
done

ui_print "- Open the module's WebUI to choose apps"
