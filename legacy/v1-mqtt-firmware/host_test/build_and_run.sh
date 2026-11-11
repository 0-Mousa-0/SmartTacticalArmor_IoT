#!/bin/sh
# Compiles the firmware on a PC against mock libraries and runs the alert-logic scenarios.
# Needs g++ (Linux/macOS, or Windows with MSYS2/WSL).
cd "$(dirname "$0")"
echo "== Stage 1: board + IMU only (config.h defaults) =="
g++ -std=gnu++17 -Wall -Wno-unused-parameter -Wno-unused-function -Imock -I../SmartTacticalArmor -x c++ sim_stage1.cpp -o sim_stage1 && ./sim_stage1
echo "== Full system: all sensors enabled =="
g++ -std=gnu++17 -Wall -Wno-unused-parameter -DHAS_PPG=1 -DHAS_SKIN_TEMP=1 -DHAS_GPS=1 -DHAS_GEIGER=1 -DHAS_BATTERY=1 -DIMU_ON_QWIIC=1 \
    -Imock -I../SmartTacticalArmor -x c++ sim_full.cpp -o sim_full && ./sim_full
