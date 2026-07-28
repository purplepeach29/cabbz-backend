import 'dotenv/config';
import { createServer } from 'http';
import { app } from './app';
import { initSocket } from './realtime/socket';

const port = Number(process.env.PORT ?? 4000);

const httpServer = createServer(app);
initSocket(httpServer);

httpServer.listen(port, () => {
  console.log(`cabbz-backend listening on :${port} (HTTP + Socket.io)`);
});
