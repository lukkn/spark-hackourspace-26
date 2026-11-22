// Firebase web config for project "spark-pets-hackourspace".
// These values are public identifiers, not secrets: access is controlled by
// firestore.rules and the kiosk's Firebase Auth login.
export const firebaseConfig = {
  apiKey: 'AIzaSyAXMzvx1tH33rv5lNH8LbylFEcbBhJeQuQ',
  authDomain: 'spark-pets-hackourspace.firebaseapp.com',
  projectId: 'spark-pets-hackourspace',
  storageBucket: 'spark-pets-hackourspace.firebasestorage.app',
  messagingSenderId: '510818142545',
  appId: '1:510818142545:web:7ec7004ccaa4fa1130eb70',
};

// The single Firebase Auth user every kiosk signs in as. Its password is the
// kiosk password (set in Firebase console > Authentication > Users).
export const KIOSK_EMAIL = 'kiosk@spark-pets.app';
