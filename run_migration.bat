@echo off
title Timecop SQLite Migration Utility
echo Booting Timecop database migration tool...
echo.
py -3 "%~dp0scripts\migrate_db.py"
if %errorlevel% neq 0 (
  python "%~dp0scripts\migrate_db.py"
)
echo.
pause
