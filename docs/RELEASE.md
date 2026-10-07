Учебный чат с каналами для браузера, Android/iOS и десктопа. Один сервер и общие аккаунты на всех устройствах.

Скачайте подходящий файл в **Assets**:

| Устройство | Файл и запуск |
|---|---|
| Android | `Relay-Chat-Android.apk`; debug-сборка для ручной установки |
| Windows | Portable `.exe` или установщик с `Setup` в имени |
| Linux | `.AppImage` (выдайте право запуска `chmod +x`) или `.deb` |
| macOS | `.dmg`; учебная сборка без Apple notarization |
| iOS simulator | `Relay-Chat-iOS-Simulator.zip`; приложение для Xcode Simulator, не для физического iPhone |
| Исходники | Автоматические архивы `Source code` и ветки репозитория |

Сервер запускается отдельно: `npm ci`, `npm run build`, `npm start`. Откройте `http://localhost:3001`; создайте аккаунт. В мобильном и десктопном приложениях укажите адрес сервера на экране входа. Телефону нужен IP компьютера/VM. Docker Compose, развёртывание по IP и нагрузочный тест описаны в [README](https://github.com/railxam2004/relay-chat).

Включены регистрация, профиль, публичные/приватные каналы, сообщения в реальном времени, ответы, изменение/удаление, непрочитанные, поиск и восстановление соединения.

Локальный нагрузочный прогон: принято и доставлено 1000 сообщений, ошибок 0. CI проверяет PostgreSQL/Redis, браузер и Docker Compose. Эти файлы скомпилированы на CI runners; запуск на физических устройствах отдельно не подтверждён.

Файл `Relay-Chat-SHA256SUMS.txt` содержит контрольные суммы. Linux: `sha256sum -c Relay-Chat-SHA256SUMS.txt`; macOS: `shasum -a 256 -c Relay-Chat-SHA256SUMS.txt`; Windows PowerShell: `Get-FileHash ИМЯ_ФАЙЛА -Algorithm SHA256`.
