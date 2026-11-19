const admin = require('firebase-admin');
const fs = require('fs');
const https = require('https');
const path = require('path');

const serviceAccountPath = path.resolve(__dirname, '../serviceAccountKey.json');
if (!fs.existsSync(serviceAccountPath)) {
  console.error('serviceAccountKey.json not found!');
  process.exit(1);
}

const serviceAccount = require(serviceAccountPath);
const projectId = serviceAccount.project_id;
const rulesPath = path.resolve(__dirname, '../firestore.rules');
const rulesContent = fs.readFileSync(rulesPath, 'utf8');

async function deployRules() {
  const tokenObj = await admin.credential.cert(serviceAccount).getAccessToken();
  const token = tokenObj.access_token;

  console.log('Deploying ruleset to Firebase project:', projectId);

  // 1. Create Ruleset
  const createRulesetPayload = JSON.stringify({
    source: {
      files: [
        {
          name: 'firestore.rules',
          content: rulesContent,
        },
      ],
    },
  });

  const rulesetRes = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'firebaserules.googleapis.com',
        path: `/v1/projects/${projectId}/rulesets`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(createRulesetPayload),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ statusCode: res.statusCode, data }));
      }
    );
    req.on('error', reject);
    req.write(createRulesetPayload);
    req.end();
  });

  if (rulesetRes.statusCode !== 200) {
    console.error('Failed to create ruleset:', rulesetRes.data);
    process.exit(1);
  }

  const parsedRuleset = JSON.parse(rulesetRes.data);
  const rulesetName = parsedRuleset.name;
  console.log('Created ruleset:', rulesetName);

  // 2. Release Ruleset to cloud.firestore
  const releasePayload = JSON.stringify({
    release: {
      name: `projects/${projectId}/releases/cloud.firestore`,
      rulesetName: rulesetName,
    },
  });

  const releaseRes = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'firebaserules.googleapis.com',
        path: `/v1/projects/${projectId}/releases/cloud.firestore`,
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(releasePayload),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ statusCode: res.statusCode, data }));
      }
    );
    req.on('error', reject);
    req.write(releasePayload);
    req.end();
  });

  if (releaseRes.statusCode !== 200) {
    console.error('Failed to release ruleset:', releaseRes.data);
    process.exit(1);
  }

  console.log('Successfully published firestore.rules to Firebase!');
}

deployRules().catch((err) => {
  console.error('Error deploying rules:', err);
  process.exit(1);
});
