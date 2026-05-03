require('dotenv').config();
const { getDb } = require('./src/firebase/client');

(async () => {
  const db = getDb();
  const snap = await db.collection('member_lobbying')
    .where('politician_slug', '==', 'donald-trump')
    .where('category', '==', 'lobbying_filing')
    .limit(1)
    .get();

  // fallback: just get any trump doc
  const snap2 = snap.empty
    ? await db.collection('member_lobbying').where('politician_slug', '==', 'donald-trump').limit(1).get()
    : snap;

  if (snap2.empty) { console.log('No docs found'); process.exit(0); }
  const doc = snap2.docs[0];
  console.log('Document ID:', doc.id);
  console.log('Fields:');
  const data = doc.data();
  for (const [k, v] of Object.entries(data)) {
    console.log(`  ${k}: ${JSON.stringify(v)}`);
  }
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
