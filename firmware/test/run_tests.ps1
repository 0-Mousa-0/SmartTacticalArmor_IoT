# Builds and runs the firmware logic tests on Windows.
# Needs a C++17 compiler on PATH: g++ (MSYS2/MinGW), clang++, or zig (zig c++).
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$sketch = '..\SmartTacticalArmor'
$sources = @('test_logic.cpp', "$sketch\src\motion\MotionAnalyzer.cpp", "$sketch\src\motion\FallDetector.cpp", "$sketch\src\alerts\AlertManager.cpp")
New-Item -ItemType Directory -Force build | Out-Null

if (Get-Command g++ -ErrorAction SilentlyContinue) { & g++ -std=c++17 -Wall -Wextra "-I$sketch" @sources -o build\test_logic.exe }
elseif (Get-Command clang++ -ErrorAction SilentlyContinue) { & clang++ -std=c++17 -Wall -Wextra "-I$sketch" @sources -o build\test_logic.exe }
elseif (Get-Command zig -ErrorAction SilentlyContinue) { & zig c++ -std=c++17 -Wall -Wextra "-I$sketch" @sources -o build\test_logic.exe }
else { Write-Error 'No C++ compiler found (install MSYS2 g++, LLVM clang++ or zig).' }

& .\build\test_logic.exe
exit $LASTEXITCODE
