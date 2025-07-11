const { makeid } = require('./gen-id');
const express = require('express');
const fs = require('fs');
const pino = require("pino");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  Browsers,
  makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');

const { upload } = require('./mega');

const router = express.Router();

function removeFile(filePath) {
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { recursive: true, force: true });
  }
}

router.get('/', async (req, res) => {
  const id = makeid();
  let number = req.query.number;

  if (!number) {
    return res.status(400).json({ error: 'Missing phone number.' });
  }

  async function startPairing() {
    const { state, saveCreds } = await useMultiFileAuthState(`./temp/${id}`);
    try {
      const sock = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        },
        printQRInTerminal: false,
        generateHighQualityLinkPreview: true,
        logger: pino({ level: 'silent' }),
        syncFullHistory: false,
        browser: Browsers.macOS('Safari')
      });

      if (!sock.authState.creds.registered) {
        await delay(1500);
        number = number.replace(/[^0-9]/g, '');
        const code = await sock.requestPairingCode(number);

        // ✅ Return code immediately to bot
        if (!res.headersSent) {
          res.json({ code });
        }
      }

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async (s) => {
        const { connection, lastDisconnect } = s;

        if (connection === 'open') {
          await delay(5000);
          const rf = `./temp/${id}/creds.json`;

          const generateRandomText = () => {
            const prefix = "3EB";
            const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
            let text = prefix;
            for (let i = prefix.length; i < 22; i++) {
              text += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return text;
          };

          try {
            const megaUrl = await upload(fs.createReadStream(rf), `${sock.user.id}.json`);
            const sessionId = "DEV_LITE-MD~" + megaUrl.replace("https://mega.nz/file/", "");

            const msg = await sock.sendMessage(sock.user.id, { text: sessionId });

            const desc = `*Hey there, DEV_LITE-MD User!* 👋🏻

Thanks for using *DEV_LITE-MD* — your session has been successfully created!

🔐 *Session ID:* Sent above  
⚠️ *Keep it safe!* Do NOT share this ID with anyone.

——————

✅ *Stay Updated:*  
https://whatsapp.com/channel/0029VbAzvMIHVvTioxfF192d

💻 *Source Code:*  
https://github.com/Jeliostarr/DEV_LITE-MD

> *© Powered by Dev Space* ✌🏻`;

            await sock.sendMessage(sock.user.id, {
              text: desc,
              contextInfo: {
                externalAdReply: {
                  title: "DEV_LITE-MD",
                  thumbnailUrl: "https://files.catbox.moe/bqs70b.jpg",
                  sourceUrl: "https://whatsapp.com/channel/0029VbAzvMIHVvTioxfF192d",
                  mediaType: 1,
                  renderLargerThumbnail: true
                }
              }
            }, { quoted: msg });

          } catch (e) {
            await sock.sendMessage(sock.user.id, { text: `❌ Error uploading session.\n\n${e}` });
          }

          await delay(10);
          sock.ws.close();
          removeFile(`./temp/${id}`);
          process.exit();
        } else if (connection === 'close' && lastDisconnect?.error?.output?.statusCode !== 401) {
          await delay(10);
          startPairing();
        }
      });

    } catch (err) {
      console.error("❗ Pairing failed:", err);
      removeFile(`./temp/${id}`);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Pairing error occurred.' });
      }
    }
  }

  await startPairing();

  // Fallback: ensure something is returned
  if (!res.headersSent) {
    res.status(500).json({ error: 'Unhandled failure.' });
  }
});

module.exports = router;
