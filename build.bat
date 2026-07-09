@echo off
chcp 65001 >nul
setlocal EnableExtensions

echo ============================================
echo   Explorer - сборка production-версии
echo ============================================
echo.

cd /d "%~dp0"

echo Проверяю Node.js...
where node >nul 2>nul
if errorlevel 1 goto :no_node
node -v
echo.

if exist "node_modules" goto :deps_ok
echo Зависимости не установлены - ставлю через npm install...
call npm install
if errorlevel 1 goto :install_failed
echo.

:deps_ok
echo Собираю проект...
call npm run build
if errorlevel 1 goto :build_failed

echo.
echo Готово! Результат - в папке dist
echo Можно открыть dist\index.html локально или залить папку на статический хостинг.
echo.
pause
exit /b 0

:no_node
echo.
echo [ОШИБКА] Node.js не найден в PATH.
echo Установите Node.js 18 или новее отсюда: https://nodejs.org
echo.
pause
exit /b 1

:install_failed
echo.
echo [ОШИБКА] npm install не прошёл. Смотрите текст ошибки выше.
echo.
pause
exit /b 1

:build_failed
echo.
echo [ОШИБКА] Сборка не прошла. Смотрите текст ошибки выше.
echo.
pause
exit /b 1
