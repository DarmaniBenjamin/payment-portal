// Prints a new random 32-byte encryption key (base64) for ENCRYPTION_KEY in .env
import crypto from 'node:crypto';
console.log(crypto.randomBytes(32).toString('base64'));
