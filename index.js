const http = require('http');
const { MongoClient } = require('mongodb');
const { google } = require('googleapis');

// Configuration (variables d'environnement, voir .env.example)
const {
  MONGO_URI = 'mongodb://localhost:27017',
  DB_NAME = 'contactsDB',
  COLLECTION_NAME = 'contacts',
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  REDIRECT_PORT = '3000',
} = process.env;

const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}`;
const SCOPES = ['https://www.googleapis.com/auth/contacts.readonly'];

function getOAuth2Client() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error('GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET doivent être définis.');
  }
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT_URI);
}

// Démarre un petit serveur local qui reçoit le code d'autorisation de Google
function waitForAuthCode(oAuth2Client) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      if (!code && !error) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(code ? 'Autorisation reçue, vous pouvez fermer cet onglet.' : `Erreur : ${error}`);
      server.close();
      code ? resolve(code) : reject(new Error(`Autorisation refusée : ${error}`));
    });
    server.on('error', reject);
    server.listen(Number(REDIRECT_PORT), () => {
      const authUrl = oAuth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES });
      console.log('Autorisez cette application en visitant cette URL :', authUrl);
    });
  });
}

// Récupère tous les contacts Google (avec pagination)
async function getGoogleContacts(oAuth2Client) {
  const service = google.people({ version: 'v1', auth: oAuth2Client });
  const contacts = [];
  let pageToken;

  do {
    const res = await service.people.connections.list({
      resourceName: 'people/me',
      personFields: 'names,emailAddresses,phoneNumbers,organizations,addresses',
      pageSize: 1000,
      pageToken,
    });
    for (const c of res.data.connections || []) {
      contacts.push({
        resourceName: c.resourceName,
        name: c.names?.[0]?.displayName || '',
        email: c.emailAddresses?.[0]?.value || '',
        phone: c.phoneNumbers?.[0]?.value || '',
        organization: c.organizations?.[0]?.name || '',
        country: c.addresses?.[0]?.country || '',
      });
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return contacts;
}

// Enregistre (upsert) les contacts : relancer le programme ne crée pas de doublons
async function saveContactsToMongoDB(contacts) {
  if (contacts.length === 0) {
    console.log('Aucun contact à sauvegarder.');
    return;
  }
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const collection = client.db(DB_NAME).collection(COLLECTION_NAME);
    const result = await collection.bulkWrite(
      contacts.map(contact => ({
        updateOne: {
          filter: { resourceName: contact.resourceName },
          update: { $set: contact },
          upsert: true,
        },
      }))
    );
    console.log(`Contacts sauvegardés dans MongoDB : ${result.upsertedCount} ajoutés, ${result.modifiedCount} mis à jour.`);
  } finally {
    await client.close();
  }
}

async function main() {
  const oAuth2Client = getOAuth2Client();
  const code = await waitForAuthCode(oAuth2Client);
  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);

  const contacts = await getGoogleContacts(oAuth2Client);
  console.log(`${contacts.length} contacts récupérés.`);
  await saveContactsToMongoDB(contacts);
  console.log('Processus terminé');
}

main().catch(err => {
  console.error('Erreur :', err.message);
  process.exit(1);
});
