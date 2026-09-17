require('dotenv').config();
const admin = require('firebase-admin');
const logger = require('../utils/logger');

let firebaseApp = null;

/**
 * Inisialisasi Firebase Admin SDK
 * Mendukung mode MOCK untuk development tanpa credentials Firebase
 */
function initializeFirebase() {
  if (firebaseApp) return firebaseApp;

  const isMock = process.env.NODE_ENV === 'development' &&
    (!process.env.FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID === 'your-firebase-project-id');

  if (isMock) {
    logger.warn('[Firebase] Running in MOCK mode — push notifications tidak akan terkirim');
    return null;
  }

  try {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      }),
    });
    logger.info('[Firebase] Admin SDK initialized successfully');
    return firebaseApp;
  } catch (error) {
    logger.error('[Firebase] Failed to initialize:', error.message);
    return null;
  }
}

const app = initializeFirebase();

module.exports = {
  firebaseApp: app,
  messaging: app ? admin.messaging(app) : null,
  isMockMode: !app,
};
