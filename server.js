// server.js - Backend Proxy
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const app = express();

app.use(cors());
app.use(express.json());

// Roblox API endpoints
const ROBLOX_API = 'https://users.roblox.com/v1/users';
const AVATAR_API = 'https://avatar.roblox.com/v1/users';

// Get user ID from username
app.get('/api/user/:username/outfits', async (req, res) => {
    try {
        const { username } = req.params;
        
        // 1. Get User ID
        const userRes = await axios.post(`${ROBLOX_API}/usernames/users`, {
            usernames: [username],
            excludeBannedUsers: true
        });
        
        if (!userRes.data.data.length) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const userId = userRes.data.data[0].id;
        
        // 2. Get Current Avatar
        const avatarRes = await axios.get(`${AVATAR_API}/${userId}/currently-wearing`);
        const avatarUrl = `https://tr.rbxcdn.com/30DAY-Avatar-${userId}-Png/352/352/Avatar/Png/noFilter`;
        
        // 3. Get Saved Outfits (requires auth cookie in production)
        // Note: Roblox requires .ROBLOSECURITY cookie to access saved outfits
        // This is a simplified example - real implementation needs authentication
        
        const outfitsRes = await axios.get(`${AVATAR_API}/${userId}/outfits`, {
            params: { page: 1, itemsPerPage: 20 }
        }).catch(() => ({ data: { data: [] } }));
        
        res.json({
            userId,
            username: userRes.data.data[0].name,
            displayName: userRes.data.data[0].displayName,
            avatarUrl,
            outfits: outfitsRes.data.data.map(outfit => ({
                id: outfit.id,
                name: outfit.name,
                thumbnail: `https://tr.rbxcdn.com/30DAY-Outfit-${outfit.id}-Png/352/352/Outfit/Png/noFilter`,
                date: new Date(outfit.updated).toLocaleDateString()
            }))
        });
        
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch user data' });
    }
});

app.listen(3000, () => console.log('Proxy server running on port 3000'));
