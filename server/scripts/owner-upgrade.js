import { getUserByEmail, updateUserPlan } from '../src/db.js';

const email = process.argv[2];
const days = Number(process.argv[3]) || 0;
if (!email) {
  console.log('Usage: node scripts/owner-upgrade.js <email> [days]');
  console.log('  days      Optional number of days. Omit or 0 for lifetime PRO.');
  process.exit(1);
}

const user = getUserByEmail(email);
if (!user) {
  console.log('User not found:', email);
  process.exit(1);
}

const expiresAt = days > 0 ? Date.now() + days * 86400000 : null;
updateUserPlan(user.id, 'pro', expiresAt);
console.log(`✅ ${email} is now PRO${days > 0 ? ` for ${days} days` : ' (lifetime)'}`);
