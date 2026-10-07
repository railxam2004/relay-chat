# HTTP API и Socket.IO

База: `/api`. JSON, `Content-Type: application/json`. Для защищённых методов: `Authorization: Bearer TOKEN`. Ошибки возвращаются как `{ "error": "Понятное сообщение" }` с HTTP 400/401/403/404/409/429/500.

| Метод и маршрут | Данные / назначение |
|---|---|
| `GET /health` | Состояние базы и инфраструктуры |
| `GET /metrics` | Принятые сообщения, дубли, подключения, ошибки поиска, uptime |
| `POST /auth/register` | `{username, displayName, password}` → `{token, expiresAt, user}` |
| `POST /auth/login` | `{username, password}` → сессия |
| `POST /auth/logout` | Отзыв текущей сессии, 204 |
| `GET /me` | Свой профиль |
| `PATCH /me` | `{displayName, bio}` |
| `GET /channels` | Каналы участника, счётчики, последнее сообщение |
| `GET /channels/discover?q=...` | До 100 публичных каналов, joined/memberCount |
| `POST /channels` | `{name, description, kind: "public"\|"private"}` |
| `POST /channels/:id/join` | Вступить в публичный канал |
| `POST /channels/join-invite` | `{code}` → вступить по приглашению |
| `GET /channels/:id/invite` | `{code}`; для владельца, либо системного публичного канала |
| `POST /channels/:id/leave` | Покинуть канал; владелец получает 409 |
| `POST /channels/:id/read` | `{messageId: "123"}` |
| `GET /channels/:id/messages?limit=50&before=123` | Более ранняя история → `{messages, hasMore}` |
| `GET /channels/:id/messages?limit=50&after=123` | Новые сообщения после курсора |
| `POST /channels/:id/messages` | `{body, clientId: UUID, replyToId?: "123"}` → Message, 201 или 200 при повторе |
| `PATCH /messages/:id` | `{body}`; только автор |
| `DELETE /messages/:id` | Только автор, мягкое удаление, 204 |
| `GET /search?q=...&channelId=UUID` | `{messages, engine}`; channelId можно не задавать для всех своих каналов |

Невалидный UUID/ID даёт 400; несуществующая либо недоступная переписка не раскрывает текст. `before` и `after` нельзя сочетать. Сообщение 1–4000 символов после trim; логин 3–32 латинских символа/цифры/`_`; пароль 8–128 символов.

Пример отправки (замените канал и токен):

```bash
curl -X POST http://localhost:3001/api/channels/00000000-0000-4000-8000-000000000001/messages \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer TOKEN' \
  -d '{"body":"Привет","clientId":"00000000-0000-4000-8000-000000000010"}'
```

`Message`: строковый `id`, `channelId`, `clientId`, `body`, ISO-датa `createdAt`, `editedAt/deletedAt` либо null, `author:{id,username,displayName,color}`, `reply:{id,body,author}` либо null. У удалённого сообщения body пустой; клиент показывает «Сообщение удалено».

## Realtime

Подключение:

```js
import { io } from 'socket.io-client';
const socket = io('http://localhost:3001', { auth: { token: TOKEN } });
socket.on('ready', () => console.log('Подписки готовы'));
socket.on('message.created', message => console.log(message));
```

После `ready` сервер подписал клиента на все его каналы. REST-вступление/выход обновляет комнаты всех сессий этого пользователя.

| Событие сервера | Payload |
|---|---|
| `ready` | Подписки готовы; клиент обновляет историю после reconnect |
| `message.created` | Message |
| `message.updated` | Message после изменения или удаления |
| `channels.changed` | Перечитать список каналов |
| `channel.members` | `{channelId}` |
| `channel.read` | `{channelId}`; только устройства этого аккаунта |
| `user.updated` | Публичный профиль |
| `typing` | `{channelId, typing, user}` |

Событие клиента: `typing` → `{channelId, typing:true/false}`. Сервер проверяет участие и ограничивает частоту. Отправка сообщения идёт через HTTP; Socket.IO отвечает за доставку событий. При авторизации без валидной сессии возникает `connect_error: UNAUTHORIZED`.
