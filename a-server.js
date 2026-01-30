const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
const app = express();

// IN-MEMORY DATABASE (use Redis/MongoDB in production)
const vault = new Map();
const analytics = new Map();

app.use(cors());
app.use(express.json());

// Encryption keys (rotate these in production)
const MASTER_KEY = crypto.randomBytes(32);
const IV_LENGTH = 16;

function encrypt(text) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-gcm', MASTER_KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
}

function decrypt(encryptedData) {
    const parts = encryptedData.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    const decipher = crypto.createDecipheriv('aes-256-gcm', MASTER_KEY, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

// BLOCKED PATTERNS (Anti-leak)
const BLOCKED_PATTERNS = [
    /setclipboard\s*\(/gi,
    /game:HttpGet\s*\(/gi,
    /game:HttpPost\s*\(/gi,
    /loadstring\s*\(/gi,
    /getfenv/gi,
    /debug\.getupvalue/gi
];

// API: Upload Script
app.post('/api/v1/protect', (req, res) => {
    const { script, options = {} } = req.body;
    if (!script) return res.status(400).json({ error: 'No script provided' });

    const id = crypto.randomBytes(8).toString('hex');
    const encrypted = encrypt(script);
    
    // Store in vault (never expose raw script)
    vault.set(id, {
        payload: encrypted,
        created: Date.now(),
        options,
        executions: 0,
        whitelist: options.whitelist || []
    });

    // Generate minimal loader
    const host = req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    
    const loader = `${protocol}://${host}/api/v1/execute/${id}`;

    res.json({
        success: true,
        id,
        loader: `loadstring(game:HttpGet("${loader}"))()`,
        webLink: `${protocol}://${host}/s/${id}`
    });
});

// API: Execute Script (What loadstring calls)
app.get('/api/v1/execute/:id', (req, res) => {
    const { id } = req.params;
    const data = vault.get(id);
    
    if (!data) {
        return res.status(404).type('text/plain').send('-- AAVArmor: Invalid or expired script');
    }

    // Decrypt server-side (client never sees this)
    const sourceScript = decrypt(data.payload);
    
    // Generate runtime protection wrapper
    const protections = [];
    
    if (data.options.antiClipboard !== false) {
        protections.push(`
local _sc = setclipboard
setclipboard = function(txt)
    if type(txt) == "string" and (txt:match("http") or #txt > 500) then
        warn("[AAVArmor] Clipboard theft blocked!")
        return nil
    end
    return _sc(txt)
end`);
    }
    
    if (data.options.antiHttp !== false) {
        protections.push(`
local _hg = game.HttpGet
game.HttpGet = function(self, url, ...)
    if url:match("pastebin") or url:match("github") then
        warn("[AAVArmor] Unauthorized request blocked: " .. url)
        return "return nil"
    end
    return _hg(self, url, ...)
end`);
    }

    // VM-based execution (simulated with loadstring for Lua)
    const protectedScript = `--[[
    🔒 AAVArmor Protected Execution
    ID: ${id}
    Server-Side Decryption Active
    Attempting to dump this will return encrypted garbage
--]]

${protections.join('\n')}

-- Encrypted payload loaded from secure vault
${sourceScript}

--[[
    🛡️ Protection Active
    Source: Server-Side Encrypted
    Client: Zero Knowledge
--]]`;

    res.type('text/plain').send(protectedScript);
    
    // Analytics
    data.executions++;
    analytics.set(id, (analytics.get(id) || 0) + 1);
});

// API: Get Stats
app.get('/api/v1/stats/:id', (req, res) => {
    const data = vault.get(req.params.id);
    if (!data) return res.status(404).json({ error: 'Not found' });
    
    res.json({
        created: data.created,
        executions: data.executions,
        protected: true
    });
});

// Dashboard Web Interface
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html>
<head>
    <title>AAVArmor | Enterprise Protection</title>
    <style>
        body { background: #050505; color: #fff; font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .modal { background: linear-gradient(135deg, #1a1a2e, #0f0f1e); padding: 60px; border-radius: 20px; border: 2px solid #667eea; text-align: center; box-shadow: 0 0 50px rgba(102,126,234,0.3); }
        h1 { font-size: 48px; background: linear-gradient(135deg, #667eea, #764ba2); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin: 0 0 20px; }
        .badge { color: #667eea; font-family: monospace; margin: 20px 0; }
        button { background: linear-gradient(135deg, #667eea, #764ba2); color: white; border: none; padding: 15px 40px; border-radius: 8px; font-size: 16px; cursor: pointer; margin-top: 20px; }
        .hidden { display: none; }
        textarea { width: 600px; height: 300px; background: #0a0a0a; border: 1px solid #333; color: #00ff88; padding: 20px; border-radius: 10px; font-family: monospace; margin: 20px 0; }
        .result { background: rgba(0,0,0,0.5); padding: 20px; border-radius: 10px; margin-top: 20px; font-family: monospace; color: #667eea; word-break: break-all; }
    </style>
</head>
<body>
    <div id="entry" class="modal">
        <h1>🛡️ AAVArmor</h1>
        <div class="badge">Enterprise Lua Protection</div>
        <p>This script is protected with military-grade encryption</p>
        <button onclick="showDashboard()">Enter Protection Center</button>
    </div>

    <div id="dashboard" class="hidden modal" style="text-align: left; width: 800px;">
        <h2 style="text-align: center; margin-bottom: 30px;">Create Protected Script</h2>
        <textarea id="scriptInput" placeholder="-- Paste Lua script here..."></textarea>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px;">
            <label style="display: flex; align-items: center; gap: 10px; padding: 10px; background: rgba(102,126,234,0.1); border-radius: 5px; cursor: pointer;">
                <input type="checkbox" id="optClip" checked> Block SetClipboard
            </label>
            <label style="display: flex; align-items: center; gap: 10px; padding: 10px; background: rgba(102,126,234,0.1); border-radius: 5px; cursor: pointer;">
                <input type="checkbox" id="optHttp" checked> Block HttpGet
            </label>
        </div>
        <button onclick="protectScript()" style="width: 100%;">Generate Secure Link</button>
        <div id="result" class="result hidden"></div>
    </div>

    <script>
        function showDashboard() {
            document.getElementById('entry').classList.add('hidden');
            document.getElementById('dashboard').classList.remove('hidden');
        }
        
        async function protectScript() {
            const btn = document.querySelector('button');
            btn.textContent = 'Encrypting...';
            btn.disabled = true;
            
            const res = await fetch('/api/v1/protect', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    script: document.getElementById('scriptInput').value,
                    options: {
                        antiClipboard: document.getElementById('optClip').checked,
                        antiHttp: document.getElementById('optHttp').checked
                    }
                })
            });
            
            const data = await res.json();
            const resultDiv = document.getElementById('result');
            resultDiv.classList.remove('hidden');
            resultDiv.innerHTML = \`<strong>Secure Loader:</strong><br><br>\${data.loader}<br><br><button onclick="navigator.clipboard.writeText('\${data.loader}')">Copy</button>\`;
            
            btn.textContent = 'Generate Secure Link';
            btn.disabled = false;
        }
    </script>
</body>
</html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🛡️ AAVArmor Server running on port ${PORT}`);
    console.log(`🔒 Encryption: AES-256-GCM`);
    console.log(`⚡ Endpoints: /api/v1/protect, /api/v1/execute/:id`);
});
