@echo off
chcp 65001 >nul
title RRPG AI Studio
node.exe "%~dp0app\scripts\open-studio.mjs"
if errorlevel 1 pause
