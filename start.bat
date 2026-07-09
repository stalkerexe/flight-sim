@echo off
chcp 65001 >nul
setlocal EnableExtensions

echo ============================================
echo   Explorer - Post-Apocalyptic Flight Sim
echo ============================================
echo.

cd /d "%~dp0"
echo Рабочая папка: %cd%
echo.

echo Шаг 1 из 3: проверяю Node.js...
where node >nul 2>nul
if errorlevel 1 goto :no_node
node -v
echo Node.js найден, идём дальше.
echo.

echo Шаг 2 из 3: проверяю зависимости проекта...
if exist "node_modules" goto :deps_ok

echo Папки node_modules нет - ставлю зависимости через npm install.
echo Это может занять минуту-две, подождите...
echo.
call npm install
if errorlevel 1 goto :install_failed
echo.
echo Зависимости установлены успешно.
echo.
goto :deps_done

:deps_ok
echo Зависимости уже установлены, пропускаю этот шаг.
echo.

:deps_done
echo Шаг 3 из 3: запускаю dev-сервер...
echo Браузер откроется сам, как только сервер поднимется.
echo Если не откроется - ссылка появится в строке "Local:" ниже, откройте её вручную.
echo Чтобы остановить сервер - закройте это окно или нажмите Ctrl+C.
echo.

call npm run dev

echo.
echo Dev-сервер остановлен ^(или не смог запуститься - смотрите текст выше^).
pause
exit /b 0

:no_node
echo.
echo [ОШИБКА] Node.js не найден в PATH.
echo Установите Node.js 18 или новее отсюда: https://nodejs.org
echo и запустите этот файл ещё раз.
echo.
pause
exit /b 1

:install_failed
echo.
echo [ОШИБКА] npm install не прошёл. Причина - в тексте ошибки выше.
echo Частые причины: нет интернета, антивирус блокирует npm, испорченный кэш npm.
echo.
pause
exit /b 1
