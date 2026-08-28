import { getUserByEmail, resetUserPassword } from '../src/db.js';
import { hashPassword, verifyPassword } from '../src/auth/crypto.js';

const email = process.argv[2];
const newPassword = process.argv[3];
if (!email || !newPassword) {
  console.log('Usage: node scripts/reset-password.js <email> <newPassword>');
  console.log('  newPassword must be at least 8 characters.');
  process.exit(1);
}
if (newPassword.length < 8) {
  console.log('❌ Password must be at least 8 characters');
  process.exit(1);
}

const user = getUserByEmail(email);
if (!user) {
  console.log('User not found:', email);
  process.exit(1);
}

resetUserPassword(user.email, hashPassword(newPassword));

// Verify the write took effect before reporting success.
const updated = getUserByEmail(user.email);
if (updated && verifyPassword(newPassword, updated.password_hash)) {
  console.log(`✅ Password reset for ${user.email}. You can now log in with the new password.`);
} else {
  console.log('❌ Reset failed verification');
  process.exit(1);
}
