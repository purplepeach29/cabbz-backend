import path from 'path';
import { cert, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

const serviceAccountPath =
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? path.join(__dirname, '..', '..', 'firebase-service-account.json');

// eslint-disable-next-line @typescript-eslint/no-var-requires
const serviceAccount = require(serviceAccountPath);

const app = initializeApp({ credential: cert(serviceAccount) });
const messaging = getMessaging(app);

export async function sendPush(
  token: string | null | undefined,
  notification: { title: string; body: string },
  data: Record<string, string> = {},
) {
  if (!token) return;
  try {
    await messaging.send({ token, notification, data });
  } catch (err) {
    console.error('FCM send failed:', err instanceof Error ? err.message : err);
  }
}
