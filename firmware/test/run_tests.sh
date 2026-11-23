#!/bin/sh
# Builds and runs the firmware logic tests on a PC (Linux/macOS, Git Bash, WSL).
# Uses $CXX if set, else g++ / clang++ / "zig c++".
set -e
cd "$(dirname "$0")"
SKETCH=../SmartTacticalArmor
if [ -z "$CXX" ]; then
  if command -v g++ >/dev/null 2>&1; then CXX=g++
  elif command -v clang++ >/dev/null 2>&1; then CXX=clang++
  elif command -v zig >/dev/null 2>&1; then CXX="zig c++"
  else echo "No C++ compiler found (install g++, clang++ or zig)"; exit 2; fi
fi
mkdir -p build
$CXX -std=c++17 -Wall -Wextra -I"$SKETCH" \
  test_logic.cpp \
  "$SKETCH/src/motion/MotionAnalyzer.cpp" \
  "$SKETCH/src/motion/FallDetector.cpp" \
  "$SKETCH/src/alerts/AlertManager.cpp" \
  "$SKETCH/src/vitals/PulseOximeter.cpp" \
  -o build/test_logic
./build/test_logic
