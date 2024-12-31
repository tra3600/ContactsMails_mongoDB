const { MongoClient } = require('mongodb');
const { google } = require('googleapis');
const readline = require('readline');

// Configurations
const MONGO_URI = 'your_mongodb_uri'; // Remplacez par votre URI MongoDB
const DB_NAME = 'contactsDB';
const COLLECTION_NAME = 'contacts';

// Fonction pour obtenir un OAuth2Client Google
function getOAuth2Client() {
  const oAuth2Client = new google.auth.OAuth2(
    'your_client_id', // Remplacez par votre Client ID
    'your_client_secret', // Remplacez par votre Client Secret
    'http://localhost' // Redirection URI
  );

  return oAuth2Client;
}

// Fonction pour récupérer les contacts Google
async function getGoogleContacts(oAuth2Client) {
  const service = google.people({ version: 'v1', auth: oAuth2Client });
  const res = await service.people.connections.list({
    resourceName: 'people/me',
    personFields: 'names,emailAddresses,phoneNumbers,organizations,addresses',
  });

  return res.data.connections.map(contact => ({
    name: contact.names ? contact.names[0].displayName : '',
    email: contact.emailAddresses ? contact.emailAddresses[0].value : '',
    phone: contact.phoneNumbers ? contact.phoneNumbers[0].value : '',
    organization: contact.organizations ? contact.organizations[0].name : '',
    country: contact.addresses ? contact.addresses[0].country : '',
  }));
}

// Fonction pour sauvegarder les contacts dans MongoDB
async function saveContactsToMongoDB(contacts) {
  const client = new MongoClient(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);

    await collection.insertMany(contacts);
    console.log('Contacts sauvegardés dans MongoDB');
  } finally {
    await client.close();
  }
}

// Fonction principale
async function main() {
  const oAuth2Client = getOAuth2Client();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question('Entrez le code d\'authentification Google: ', async (code) => {
    rl.close();
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);

    const contacts = await getGoogleContacts(oAuth2Client);
    await saveContactsToMongoDB(contacts);

    console.log('Processus terminé');
  });

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/contacts.readonly'],
  });

  console.log('Autorisez cette application en visitant cette URL:', authUrl);
}

main().catch(console.error);