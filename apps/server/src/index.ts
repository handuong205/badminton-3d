import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ROOM_NAME, SERVER_PORT } from '@badminton/shared/protocol';
import { DuelRoom } from './duelRoom';

/**
 * Game server: chỉ lo phòng đấu realtime (WebSocket).
 * Tài khoản, lịch sử, bảng xếp hạng sẽ nằm ở API Python FastAPI riêng (đã chốt ở phần kiến trúc).
 */
const port = Number(process.env.PORT ?? SERVER_PORT);
const server = new Server({ transport: new WebSocketTransport() });
server.define(ROOM_NAME, DuelRoom);
await server.listen(port);
console.log(`Game server đang chạy: ws://localhost:${port}`);