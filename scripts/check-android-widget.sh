#!/usr/bin/env bash
set -euo pipefail

# This runner owns a fresh emulator. It uses only generated fixture records and
# never launches the WebView, signs into Supabase, or invokes an AI provider.
widget_package='io.github.shalloweryin.semesterschedule'
widget_evidence='widget-validation'
mkdir -p "$widget_evidence"
adb shell settings put global http_proxy 127.0.0.1:9
adb install android/app/build/outputs/apk/debug/app-debug.apk
adb install -t android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell appops set "$widget_package" SYSTEM_ALERT_WINDOW allow
adb shell am instrument -w -r \
  -e class io.github.shalloweryin.semesterschedule.WidgetScrollingTest \
  "$widget_package.test/androidx.test.runner.AndroidJUnitRunner" | tee "$widget_evidence/instrumentation.log"

for widget_image in widget-scroll-initial.png widget-scroll-later.png widget-scroll-failure.png; do
  if adb shell run-as "$widget_package" test -f "cache/$widget_image"; then
    adb exec-out run-as "$widget_package" cat "cache/$widget_image" > "$widget_evidence/$widget_image"
  fi
done

# Android's command can exit zero even when a JUnit assertion fails.
grep -Fq 'OK (1 test)' "$widget_evidence/instrumentation.log"
